import { useEffect, useMemo, useRef } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { Bone, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useObjectPose } from '../motion/SceneMotion'

type Mode='flower'|'cup'|'scissors'
const xAxis=new Vector3(1,0,0)
function orientation(forward:Vector3,palm:Vector3){
  const y=forward.normalize(),x=y.clone().cross(palm).normalize(),z=x.clone().cross(y).normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z))
}

/** Independent skinned hand. The source cache and shared geometry remain untouched. */
export default function Grip({kit,mode,tool,height=.045}:{kit:Object3D;mode:Mode;tool?:Object3D;height?:number}){
  const holder=useRef<Group>(null)
  const scene=useThree(s=>s.scene)
  const hand=useMemo(()=>{
    const side=mode==='flower'?'left':'right',prefix=side==='left'?'L_':'R_'
    const source=kit.getObjectByName('hand_'+side+'_root');if(!source)throw Error('Hand model unavailable')
    const object=clone(source),bones=new Map<string,Bone>(),rest=new Map<string,Quaternion>()
    object.traverse(o=>{if(o instanceof Bone){bones.set(o.name,o);rest.set(o.name,o.quaternion.clone())}if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;o.raycast=()=>{}}})
    const joint=(name:string)=>bones.get(prefix+name)!
    const bend=(name:string,angle:number)=>{const b=joint(name);if(b)b.quaternion.copy(rest.get(b.name)!).multiply(new Quaternion().setFromAxisAngle(xAxis,angle))}
    const curls=mode==='flower'?[[1.02,1.50,.65],[.55,.90,.45],[.7,1.05,.5],[.85,1.1,.5]]:mode==='cup'?[[.55,.95,.55],[.65,1.05,.55],[.75,1.1,.6],[.85,1.15,.65]]:[[.9,1.2,.7],[.9,1.15,.65],[1.1,1.2,.7],[1.2,1.25,.7]]
    const fingers=['index','middle','ring','pinky'],parts=['phalanx-proximal','phalanx-intermediate','phalanx-distal']
    fingers.forEach((f,i)=>parts.forEach((p,j)=>bend(f+'-finger-'+p,curls[i][j])))
    bend('thumb-metacarpal',.25);bend('thumb-phalanx-proximal',.55);bend('thumb-phalanx-distal',.35)
    if(mode!=='flower')joint('thumb-metacarpal').quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.45))
    object.updateMatrixWorld(true)
    if(mode==='flower'){
      // Bounded correction brings the thumb to the index pad without a rigid mitten pose.
      const target=joint('index-finger-tip').getWorldPosition(new Vector3()).add(new Vector3(.012,-.003,0))
      for(let pass=0;pass<7;pass++)for(const name of ['thumb-phalanx-distal','thumb-phalanx-proximal','thumb-metacarpal']){
        const bone=joint(name),origin=bone.getWorldPosition(new Vector3()),tip=joint('thumb-tip').getWorldPosition(new Vector3())
        const delta=new Quaternion().setFromUnitVectors(tip.sub(origin).normalize(),target.clone().sub(origin).normalize())
        const step=new Quaternion().slerp(delta,Math.min(1,.16/Math.max(.0001,new Quaternion().angleTo(delta))))
        const parent=bone.parent!.getWorldQuaternion(new Quaternion()),candidate=parent.clone().invert().multiply(step).multiply(parent).multiply(bone.quaternion)
        const initial=rest.get(bone.name)!;bone.quaternion.copy(initial).slerp(candidate,Math.min(1,1.1/Math.max(.0001,initial.angleTo(candidate))))
        object.updateMatrixWorld(true)
      }
    }
    const anchor=mode==='flower'?joint('index-finger-tip').getWorldPosition(new Vector3()).add(joint('thumb-tip').getWorldPosition(new Vector3())).multiplyScalar(.5):new Vector3(0,.075,mode==='cup'?.043:.026)
    object.position.sub(anchor)
    const rotations=new Map([...bones].map(([name,b])=>[name,b.quaternion.clone()]))
    const cuff=object.getObjectByName(prefix+'linen_sleeve') as Mesh;cuff.visible=false
    const geometry=cuff.geometry.clone(),base=Float32Array.from(geometry.getAttribute('position').array),forearm=new Mesh(geometry,cuff.material)
    forearm.name='forearm-'+mode;forearm.castShadow=true;forearm.receiveShadow=true;forearm.frustumCulled=false;forearm.raycast=()=>{}
    return {object,bones,rotations,prefix,opening:-1,forearm,base,lastWrist:new Vector3(99,99,99),lastTurn:new Quaternion(1,1,1,1)}
  },[kit,mode])
  useEffect(()=>()=>hand.forearm.geometry.dispose(),[hand])
  const rotation=useMemo(()=>mode==='flower'?orientation(new Vector3(.35,.55,-.75),new Vector3(1,0,.3)):mode==='cup'?orientation(new Vector3(0,0,1),new Vector3(-1,0,0)):orientation(new Vector3(0,0,-1),new Vector3(0,1,0)),[mode])
  const position=mode==='flower'?new Vector3(0,height,0):mode==='cup'?new Vector3(0,.045,0):new Vector3(.005,.005,.073)
  useObjectPose(holder,position,rotation,mode)
  const worldTurn=useMemo(()=>new Quaternion(),[])
  useFrame(()=>{
    if(mode==='flower'&&holder.current?.parent){holder.current.parent.getWorldQuaternion(worldTurn);holder.current.quaternion.copy(worldTurn.invert()).multiply(rotation)}
    if(mode==='scissors'&&tool){
      const opening=Math.abs(tool.getObjectByName('scissors_half_0')?.rotation.y||0)/.22
      if(Math.abs(opening-hand.opening)>=.001){hand.opening=opening
      for(const finger of ['index','middle','ring','pinky']){
        const name=hand.prefix+finger+'-finger-phalanx-proximal',bone=hand.bones.get(name)
        if(bone)bone.quaternion.copy(hand.rotations.get(name)!).multiply(new Quaternion().setFromAxisAngle(xAxis,(1-opening)*.16))
      }
      }
    }
    if(!holder.current)return
    holder.current.updateWorldMatrix(true,true)
    const wrist=hand.bones.get(hand.prefix+'wrist')!.getWorldPosition(new Vector3()),turn=holder.current.getWorldQuaternion(new Quaternion())
    if(wrist.distanceToSquared(hand.lastWrist)<1e-10&&turn.angleTo(hand.lastTurn)<1e-5)return
    hand.lastWrist.copy(wrist);hand.lastTurn.copy(turn)
    // Cloth follows the wrist near the cuff, then bends toward the seated player's arm.
    const back=new Vector3(0,-1,0).applyQuaternion(turn),start=wrist.clone().addScaledVector(back,.028),control=wrist.clone().addScaledVector(back,.10)
    const end=new Vector3(mode==='flower'?-.32:.34,.48,.74),endDelta=end.clone().sub(control),width=new Vector3(1,0,0).applyQuaternion(turn)
    const positions=hand.forearm.geometry.getAttribute('position'),point=new Vector3(),tangent=new Vector3(),cross=new Vector3(),depth=new Vector3()
    for(let i=0;i<positions.count;i++){
      const x=hand.base[i*3],z=hand.base[i*3+2],t=Math.max(0,Math.min(1,(-hand.base[i*3+1]-.028)/.24)),u=1-t
      point.copy(start).multiplyScalar(u*u).addScaledVector(control,2*u*t).addScaledVector(end,t*t)
      tangent.copy(control).sub(start).multiplyScalar(u).addScaledVector(endDelta,t).normalize()
      cross.copy(width).addScaledVector(tangent,-width.dot(tangent)).normalize();depth.crossVectors(tangent,cross).normalize()
      point.addScaledVector(cross,x).addScaledVector(depth,z);positions.setXYZ(i,point.x,point.y,point.z)
    }
    positions.needsUpdate=true;hand.forearm.geometry.computeVertexNormals()
  })
  return <><group ref={holder} name={'grip-'+mode}><primitive object={hand.object} dispose={null}/></group>{createPortal(<primitive object={hand.forearm} dispose={null}/>,scene)}</>
}
