import { Box3, Euler, Quaternion, Vector3 } from 'three'
import { surfaceHeight } from './flower-rest'
import { DESK } from '../../game/desk-layout'
import { cuttingEye, deskView, propRotation } from './desk-space'
import { BASE_Y, MOUTH_Y } from '../../content/catalog'
import type { Arrangement, FlowerState, Quat, Vec3 } from '../../game/types'
export const CORE_VIEW={eye:[0,1.23,.76] as [number,number,number],target:[0,.93,-.025] as [number,number,number],fov:47}
export const OBSERVE=[-.155,.94,.115] as [number,number,number]
export const SCISSORS_REST=[.205,BASE_Y+.012,.025] as [number,number,number]
export const SCISSORS_HELD=[.17,1.055,.14] as [number,number,number]
export function heldScissors(s:Arrangement,cutting=false):Vec3{
  if(!s.tools)return SCISSORS_HELD
  const width=window.innerWidth,height=window.innerHeight,{eye,pitch,fov}=deskView(width,height)
  const depth=cutting&&width<height?.82:.71,half=depth*Math.tan(fov*Math.PI/360)
  return new Vector3(half*Math.min(1.65,width/height)*(cutting&&width<height?.48:.42),half*.06,-depth).applyAxisAngle(new Vector3(1,0,0),pitch).add(cutting?cuttingEye:eye).toArray() as Vec3
}
const up=new Vector3(0,1,0)
export type HeldFlowerFrame={bounds:Box3;outline:readonly Vector3[];editing:boolean;overDesk:boolean;lift?:number;closeZoom?:number}
export function heldInsertionPose(f:FlowerState,vaseRotation:Quaternion,turned?:Quaternion){
  if(!turned)return {...f.pose}
  const relative=vaseRotation.clone().invert().multiply(turned)
  const axis=up.clone().applyQuaternion(relative)
  const tilt=Math.acos(Math.max(-1,Math.min(1,axis.y)))*180/Math.PI
  const heading=tilt>.05?Math.atan2(axis.z,axis.x):new Euler().setFromQuaternion(relative,'YXZ').y
  return {...f.pose,tilt,yaw:(heading*180/Math.PI+360)%360}
}
export function coreFlowerPose(f:FlowerState,s:Arrangement,held:boolean,turn:Quat=[0,0,0,1],zoom=0,frame?:HeldFlowerFrame) {
  const quaternion=new Quaternion(...turn)
  if(held&&s.tools){
    const width=window.innerWidth,height=window.innerHeight
    const view=deskView(width,height),tangent=Math.tan(view.fov*Math.PI/360)
    const eye=frame?.overDesk?cuttingEye:view.eye
    const pivot=frame?.bounds.getCenter(new Vector3())??new Vector3(0,f.length/2,0)
    const half=frame?.bounds.getSize(new Vector3()).multiplyScalar(.5)??new Vector3(.04,f.length/2,.04)
    const aperture=tangent*(frame?.editing ? .63 : .69)
    // Maintain the same viewing distance through a turn until the sides need clearance.
    let distance=half.length()*Math.hypot(1,1/aperture)*(frame?.overDesk?1:1-zoom*2.4)
    const corner=new Vector3(),cameraX=new Vector3(1,0,0)
    for(const x of [-half.x,half.x])for(const y of [-half.y,half.y])for(const z of [-half.z,half.z]){
      corner.set(x,y,z).applyQuaternion(quaternion).applyAxisAngle(cameraX,-view.pitch)
      distance=Math.max(distance,corner.z+Math.abs(corner.x)/(.91*tangent*width/height))
    }
    // Aim the visible silhouette, including off-centre plumes, within the work area.
    // Perspective gives near and far branches slightly different screen motion.
    const targetY=frame?.editing ? -.08*tangent : -.025*tangent
    if(frame?.overDesk){
      let reach=0
      for(const point of frame.outline)reach=Math.max(reach,corner.copy(point).sub(pivot).applyQuaternion(quaternion).z)
      distance=Math.max(distance,(eye.z+reach-DESK.front+.035)/(Math.cos(view.pitch)-targetY*Math.sin(view.pitch)))
    }
    const center=new Vector3(0,targetY*distance,-distance)
    if(frame){
      const bounds=new Box3(),midpoint=new Vector3()
      for(let pass=0;pass<2;pass++){
        bounds.makeEmpty()
        for(const point of frame.outline){
          corner.copy(point).sub(pivot).applyQuaternion(quaternion).applyAxisAngle(cameraX,-view.pitch).add(center)
          bounds.expandByPoint(corner.multiplyScalar(-1/corner.z))
        }
        bounds.getCenter(midpoint)
        center.x-=midpoint.x*distance
        center.y+=(targetY-midpoint.y)*distance
      }
      if(frame.overDesk&&width<height){
        const widthRoom=1.66*tangent*width/height/Math.max(.001,bounds.max.x-bounds.min.x)
        frame.closeZoom=Math.max(1,Math.min(1.35,.19/(f.stockLength??f.length),widthRoom))
      }else frame.closeZoom=1
    }
    center.applyAxisAngle(cameraX,view.pitch).add(eye)
    const position=center.sub(pivot.applyQuaternion(quaternion))
    if(frame?.overDesk){
      // Keep the surface in the same shot as the cut, even for a very short stem.
      let lift=-Infinity
      for(const p of frame.outline){
        corner.copy(p).applyQuaternion(quaternion).add(position)
        lift=Math.max(lift,surfaceHeight(corner.x,corner.z)+.025-corner.y)
      }
      frame.lift=Math.max(0,lift);position.y+=frame.lift
    }
    return {position,quaternion}
  }
  if(held)return {position:new Vector3(OBSERVE[0],OBSERVE[1],OBSERVE[2]+zoom),quaternion}
  if(f.location==='cup'&&s.tools){
    const [x,y,z]=s.tools.cup
    const angle=f.kind==='yellow'?.089:f.kind==='white'?-.348:.069
    const lean=f.kind==='yellow'?.284:f.kind==='white'?.361:.30
    const q=propRotation(s,'cup')
    const seat=f.kind==='yellow'?[-.015,.0146,.008]:f.kind==='white'?[.018,.0146,-.004]:[-.008,.0146,-.006]
    const originalStem=(f.id==='f-1'&&f.kind==='yellow')||(f.id==='f-2'&&f.kind==='white')||(f.id==='f-3'&&f.kind==='grass')
    if (!originalStem) {
      const azimuth=f.slot*2.39996+.72
      const seatAngle=new Euler(.26*Math.cos(azimuth),azimuth,.26*Math.sin(azimuth),'ZXY')
      const base=new Vector3(.009*Math.sin(azimuth),.0146,.009*Math.cos(azimuth))
      return {position:base.applyQuaternion(q).add(new Vector3(x,y,z)),quaternion:q.multiply(new Quaternion().setFromEuler(seatAngle))}
    }
    return {position:new Vector3(...seat).applyQuaternion(q).add(new Vector3(x,y,z)),quaternion:q.multiply(new Quaternion().setFromEuler(new Euler(lean,0,-angle)))}
  }
  if(f.location==='vase'){
    if(s.tools){
      const q=propRotation(s,'vase'),tilt=f.pose.tilt*Math.PI/180,yaw=f.pose.yaw*Math.PI/180
      const direction=new Vector3(Math.sin(tilt)*Math.cos(yaw),Math.cos(tilt),Math.sin(tilt)*Math.sin(yaw))
      const base=new Vector3(f.pose.x,.179,f.pose.z).addScaledVector(direction,-f.pose.depth)
      return {position:base.applyQuaternion(q).add(new Vector3(s.vase.x,s.tools.vaseY,s.vase.z-.025)),
        quaternion:q.multiply(new Quaternion().setFromUnitVectors(up,direction)).multiply(new Quaternion().setFromAxisAngle(up,yaw))}
    }
    const a=s.vase.yaw*Math.PI/180,yaw=(f.pose.yaw+s.vase.yaw)*Math.PI/180,tilt=f.pose.tilt*Math.PI/180
    const direction=new Vector3(Math.sin(tilt)*Math.cos(yaw),Math.cos(tilt),Math.sin(tilt)*Math.sin(yaw))
    return {position:new Vector3(s.vase.x+f.pose.x*Math.cos(a)-f.pose.z*Math.sin(a),MOUTH_Y,s.vase.z-.025+f.pose.x*Math.sin(a)+f.pose.z*Math.cos(a)).addScaledVector(direction,-f.pose.depth),quaternion:new Quaternion().setFromUnitVectors(up,direction).multiply(new Quaternion().setFromAxisAngle(up,yaw))}
  }
  // Camera is on +Z. Unturned table flowers point away, with cut ends nearest the player.
  return {position:new Vector3(...(f.table??(s.tools?[-.46+(f.slot%3)*.10,BASE_Y,.27-Math.floor(f.slot/3)*.075]:[-.23+(f.slot%4)*.065,BASE_Y+.018,-.13]))),quaternion:f.tableRotation?new Quaternion(...f.tableRotation):new Quaternion().setFromEuler(new Euler(s.tools?-Math.PI/2:1.48,0,-.22+(f.slot%3)*.12))}
}
