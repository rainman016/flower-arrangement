import { Box3, Euler, Matrix4, Object3D, PerspectiveCamera, Plane, Quaternion, Ray, Vector3 } from 'three'
import { BOX, DESK, inBox } from '../../game/desk-layout'
import type { Arrangement, Vec3 } from '../../game/types'

const X=new Vector3(1,0,0),Y=new Vector3(0,1,0)
// Leave the front edge of the desk in frame so a severed side shoot can be seen landing.
export const cuttingEye=new Vector3(0,1.065,.68)
export function deskView(width:number,height:number){
  const aspect=width/Math.max(1,height),fov=aspect<.85?60:47,pitch=-23*Math.PI/180
  const target=new Vector3(0,.96,-.065),back=new Vector3(0,-Math.sin(pitch),Math.cos(pitch))
  const tangent=Math.tan(fov*Math.PI/360)
  let distance=1.04
  for(const z of [DESK.front,DESK.back]){
    const offset=new Vector3(.6,DESK.top,z).sub(target).applyAxisAngle(X,-pitch)
    distance=Math.max(distance,offset.z+Math.abs(offset.x)/(.93*aspect*tangent),offset.z+Math.abs(offset.y)/(.87*tangent))
  }
  return {eye:target.addScaledVector(back,distance),pitch,fov}
}
export function propRotation(s:Arrangement,prop:'vase'|'scissors'|'cup'){
  const q=s.tools?.rotations?.[prop]
  return q?new Quaternion(...q):new Quaternion().setFromAxisAngle(Y,prop==='vase'?-s.vase.yaw*Math.PI/180:0)
}
export function localBounds(root:Object3D){
  root.updateWorldMatrix(true,true)
  const inverse=root.matrixWorld.clone().invert(),bounds=new Box3()
  root.traverse(o=>{
    if(!('geometry' in o)||!o.visible||!('material' in o))return
    const mesh=o as import('three').Mesh
    if(!Array.isArray(mesh.material)&&mesh.material.transparent&&mesh.material.opacity===0)return
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox()
    if(mesh.geometry.boundingBox)bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)))
  })
  return bounds
}
export function startGrab(root:Object3D,point:Vector3,camera:PerspectiveCamera){
  const bounds=localBounds(root),local=root.worldToLocal(point.clone()),center=bounds.getCenter(new Vector3())
  const forward=camera.getWorldDirection(new Vector3());forward.y=0;forward.normalize()
  const plane=new Plane().setFromNormalAndCoplanarPoint(forward,point)
  return {bounds,local,center,forward,plane,origin:root.position.clone(),rotation:root.quaternion.clone(),turned:false,depthChanged:false}
}
export type Grab=ReturnType<typeof startGrab>
export function moveGrab(root:Object3D,g:Grab,ray:Ray,depth=0){
  if(depth){g.plane.constant-=depth;g.depthChanged=true}
  const p=ray.intersectPlane(g.plane,new Vector3())
  if(!p)return
  const gripOffset=g.local.clone().applyQuaternion(root.quaternion)
  root.position.copy(p).sub(gripOffset)
  const box=g.bounds.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(root.quaternion))
  const floor=DESK.top+.001-box.min.y
  if(root.position.y<floor){
    // Continue towards the player when the vertical grab plane runs into the desk.
    // The projected grab point stays on the mouse ray at the new working depth.
    const point=depth?null:ray.intersectPlane(new Plane(Y,-(floor+gripOffset.y)),new Vector3())
    if(point){
      root.position.copy(point).sub(gripOffset)
      g.plane.setFromNormalAndCoplanarPoint(g.forward,point)
    }
    root.position.y=floor
  }
  root.updateMatrixWorld(true)
}
export function beginTableCarry(root:Object3D,grip:Vector3,ray:Ray,height:number,pickedY:number){
  const plane=new Plane(Y,-pickedY)
  const pointer=ray.intersectPlane(plane,new Vector3())??root.position.clone()
  const offset=root.position.clone().sub(pointer)
  return {plane,offset,grip,height,depth:0,withinDesk:true}
}
export type TableCarry=ReturnType<typeof beginTableCarry>
export function moveOnTable(root:Object3D,bounds:Box3,carry:TableCarry,ray:Ray,depth=0){
  const target=ray.intersectPlane(carry.plane,new Vector3())
  if(!target){carry.withinDesk=false;return}
  target.add(carry.offset)
  const b=bounds.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(root.quaternion))
  if(depth){
    const z=Math.max(DESK.back-b.min.z,Math.min(DESK.front-b.max.z,root.position.z+depth))
    carry.depth=z-target.z
  }
  carry.withinDesk=target.x>=DESK.left&&target.x<=DESK.right&&target.z+carry.depth>=DESK.back&&target.z+carry.depth<=DESK.front
  const x=Math.max(DESK.left-b.min.x,Math.min(DESK.right-b.max.x,target.x))
  root.position.set(x,carry.height,Math.max(DESK.back-b.min.z,Math.min(DESK.front-b.max.z,target.z+carry.depth)))
  root.updateMatrixWorld(true)
}
export function turnGrab(root:Object3D,g:Grab,camera:PerspectiveCamera,dx:number,dy:number,roll=0){
  const pivot=root.localToWorld(g.center.clone())
  const q=new Quaternion().setFromEuler(new Euler(dy*.012,dx*.012,roll,'YXZ'))
  const view=camera.getWorldQuaternion(new Quaternion())
  root.quaternion.premultiply(view.clone().multiply(q).multiply(view.invert())).normalize()
  root.position.copy(pivot).sub(g.center.clone().applyQuaternion(root.quaternion))
  root.updateMatrixWorld(true);g.turned=true
}
export function restOnDesk(root:Object3D,bounds:Box3,at:Vector3):Vec3{
  const b=bounds.clone().applyMatrix4(new Matrix4().makeRotationFromQuaternion(root.quaternion))
  const x=Math.max(DESK.left-b.min.x,Math.min(DESK.right-b.max.x,at.x)),z=Math.max(DESK.back-b.min.z,Math.min(DESK.front-b.max.z,at.z))
  const inside=x+b.min.x>=-BOX.halfX+.012&&x+b.max.x<=BOX.halfX-.012&&z+b.min.z>=BOX.z-BOX.halfZ+.012&&z+b.max.z<=BOX.z+BOX.halfZ-.012
  const overlaps=x+b.max.x>-BOX.halfX&&x+b.min.x<BOX.halfX&&z+b.max.z>BOX.z-BOX.halfZ&&z+b.min.z<BOX.z+BOX.halfZ
  return [x,(inside?BOX.base:overlaps?BOX.rim:DESK.top)+.001-b.min.y,z]
}
export function deskHit(ray:Ray){
  const tray=ray.intersectPlane(new Plane(Y,-BOX.base),new Vector3())
  if(tray&&inBox(tray.x,tray.z))return tray
  const p=ray.intersectPlane(new Plane(Y,-DESK.top),new Vector3())
  return p&&p.x>=DESK.left-.012&&p.x<=DESK.right+.012&&p.z>=DESK.back-.012&&p.z<=DESK.front+.012?p:null
}

