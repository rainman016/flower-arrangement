import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Euler, Group, Object3D, Plane, Quaternion, Vector3 } from 'three'
import BotanicalPart from './BotanicalPart'
import BotanicalStem, { stemPoint } from './BotanicalStem'
import { BASE_Y, FLOWERS, MOUTH_Y } from '../../content/catalog'
import { availablePose, poseProblem, visibleParts } from '../../game/rules'
import type { Arrangement, FlowerState, Pose } from '../../game/types'
import { useGameStore } from '../../state/game-store'
import { useObjectPose, useSceneMotion } from '../motion/SceneMotion'

const up=new Vector3(0,1,0)
export function flowerTransform(f:FlowerState,s:Arrangement,held:boolean){
  if(f.location==='vase'){
    const yaw=(f.pose.yaw+s.vase.yaw)*Math.PI/180,tilt=f.pose.tilt*Math.PI/180
    const dir=new Vector3(Math.sin(tilt)*Math.cos(yaw),Math.cos(tilt),Math.sin(tilt)*Math.sin(yaw))
    const a=s.vase.yaw*Math.PI/180
    return {position:new Vector3(s.vase.x+f.pose.x*Math.cos(a)-f.pose.z*Math.sin(a),MOUTH_Y,s.vase.z-.025+f.pose.x*Math.sin(a)+f.pose.z*Math.cos(a)).addScaledVector(dir,-f.pose.depth),quaternion:new Quaternion().setFromUnitVectors(up,dir).multiply(new Quaternion().setFromAxisAngle(up,yaw))}
  }
  const yaw=f.pose.yaw*Math.PI/180
  if(held)return {position:new Vector3(-.10,.81,.16),quaternion:new Quaternion().setFromEuler(new Euler(0,yaw,.10))}
  if(f.location==='cup')return {position:new Vector3(-.17+(f.slot%3-1)*.007,BASE_Y+.012,-.02),quaternion:new Quaternion().setFromEuler(new Euler((f.slot%3-1)*.07,yaw,-(f.slot%3-1)*.14))}
  return {position:new Vector3(-.26+(f.slot%4)*.028,BASE_Y+.012+Math.floor(f.slot/4)*.009,-.13),quaternion:new Quaternion().setFromEuler(new Euler(1.35,yaw,.1,'XZY'))}
}
export default function Flower({flower:f,kit}:{flower:FlowerState;kit:Object3D}){
  const s=useGameStore(x=>x.history.present),selected=useGameStore(x=>x.selectedId===f.id),held=useGameStore(x=>x.held&&x.selectedId===f.id)
  const preview=useGameStore(x=>x.cutPreview),looking=useGameStore(x=>x.looking)
  const group=useRef<Group>(null),invalidate=useThree(x=>x.invalidate)
  const motion=useSceneMotion(),action=useGameStore(x=>x.visualAction)
  const drag=useRef<{x:number;y:number;moved:boolean;pose?:Pose;capture:{setPointerCapture:(n:number)=>void;releasePointerCapture:(n:number)=>void};pointer:number}|null>(null)
  const plane=useMemo(()=>new Plane(up,-MOUTH_Y),[]),hit=useMemo(()=>new Vector3(),[])
  const reset=()=>{const state=useGameStore.getState(),flower=state.history.present.flowers.find(x=>x.id===f.id);if(group.current&&flower){const t=flowerTransform(flower,state.history.present,state.held&&state.selectedId===f.id);group.current.position.copy(t.position);group.current.quaternion.copy(t.quaternion);invalidate()}}
  const target=flowerTransform(f,s,held)
  const inserting=action?.command.type==='insert'&&action.command.id===f.id
  const above=inserting?target.position.clone().addScaledVector(up.clone().applyQuaternion(target.quaternion),f.pose.depth+.025):undefined
  useObjectPose(group,target.position,target.quaternion,action,above)
  const cancel=()=>{const d=drag.current;if(d){try{d.capture.releasePointerCapture(d.pointer)}catch{/* Already released by browser. */}drag.current=null;useGameStore.getState().setDragging(false);reset()}}
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel()}
    window.addEventListener('keydown',key);window.addEventListener('blur',cancel);window.addEventListener('pointercancel',cancel)
    return()=>{cancel();window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);window.removeEventListener('pointercancel',cancel)}
  },[])
  const down=(e:ThreeEvent<PointerEvent>)=>{
    const state=useGameStore.getState();if(e.button!==0||state.looking||state.recoveryBlocked)return
    e.stopPropagation();if(group.current)motion.cancel(group.current);state.select(f.id)
    if(state.tool){state.tell(state.tool==='scissors'?'点选叶片预览剪切，或使用右侧修剪控制。':'先放回杯子，再移动花枝。');return}
    const capture=e.target as unknown as {setPointerCapture:(n:number)=>void;releasePointerCapture:(n:number)=>void}
    capture.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,moved:false,capture,pointer:e.pointerId};state.setDragging(true)
  }
  const move=(e:ThreeEvent<PointerEvent>)=>{
    const d=drag.current;if(!d||!group.current)return;e.stopPropagation()
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6&&!d.moved)return
    d.moved=true
    if(!e.ray.intersectPlane(plane,hit))return
    const state=useGameStore.getState().history.present,a=-state.vase.yaw*Math.PI/180
    const dx=hit.x-state.vase.x,dz=hit.z-(state.vase.z-.025),near=Math.hypot(dx,dz)<.07
    d.pose=undefined
    if(near){
      // Assisted placement maps the larger visible target onto a safe narrow-mouth slot.
      const x=Math.max(-.007,Math.min(.007,(dx*Math.cos(a)-dz*Math.sin(a))*.15))
      const z=Math.max(-.007,Math.min(.007,(dx*Math.sin(a)+dz*Math.cos(a))*.15))
      const candidate={...f.pose,x,z}
      d.pose=!poseProblem(state,f,candidate)?candidate:availablePose(state,f)
    }
    if(d.pose){const t=flowerTransform({...f,location:'vase',pose:d.pose},state,false);group.current.position.copy(t.position).addScaledVector(up.clone().applyQuaternion(t.quaternion),d.pose.depth+.025);group.current.quaternion.copy(t.quaternion)}
    else{group.current.position.copy(hit).addScaledVector(up,-.06);group.current.quaternion.identity()}
    invalidate()
  }
  const release=(e:ThreeEvent<PointerEvent>)=>{
    const d=drag.current;if(!d)return;e.stopPropagation()
    drag.current=null;try{d.capture.releasePointerCapture(d.pointer)}catch{/* Browser may have canceled. */}
    const store=useGameStore.getState();store.setDragging(false)
    if(d.moved&&d.pose)store.dispatch(f.location==='vase'?{type:'adjust',id:f.id,pose:d.pose}:{type:'insert',id:f.id,pose:d.pose})
    else if(d.moved)store.tell('没有落在瓶口，花枝已回到原位。')
    if(!d.moved||!d.pose)reset()
  }
  const cut=FLOWERS[f.kind].length-f.length
  return <group ref={group} name={f.id} onPointerDown={down} onPointerMove={move} onPointerUp={release}>
    <BotanicalStem length={f.length} selected={selected}/>
    <group position={stemPoint(f.length,f.length)}><BotanicalPart kit={kit} name={'flower_'+f.kind+'_head'}/></group>
    <mesh position={[0,f.length,0]} visible={!looking}><sphereGeometry args={[.025,12,8]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
    {visibleParts(f).map((part)=>{
      const side=part.id==='leaf-1'?1:-1,isPreview=preview?.kind==='part'&&preview.id===f.id&&preview.part===part.id
      return <group key={part.id} position={stemPoint(part.height-cut,f.length)} rotation={[0,(f.slot%3-1)*.2,-side*.85]}
        onPointerDown={e=>{const state=useGameStore.getState();if(state.tool==='scissors'&&!state.looking){e.stopPropagation();state.select(f.id);state.previewCut({kind:'part',id:f.id,part:part.id})}}}>
        <group scale={part.id==='leaf-0'?.88:part.id==='branch-0'?.76:1}><BotanicalPart kit={kit} name={f.kind==='grass'?'flower_grass_leaf':'flower_leaf'} highlight={isPreview}/></group>
        {part.id==='branch-0'&&f.kind!=='grass'&&<>
          <mesh position={[0,.028,0]} castShadow><cylinderGeometry args={[.0006,.0008,.056,6]}/><meshStandardMaterial color="#64773a"/></mesh>
          <group position={[0,.057,0]} scale={.55}><BotanicalPart kit={kit} name={'flower_'+f.kind+'_head'} highlight={isPreview}/></group>
        </>}
      </group>
    })}
    {preview?.kind==='length'&&preview.id===f.id&&<mesh position={[0,f.length-preview.length,0]} rotation={[0,0,Math.PI/2]}><torusGeometry args={[.005,.001,6,16]}/><meshBasicMaterial color="#c7743d" depthTest={false}/></mesh>}
    {selected&&<mesh position={[0,f.length+.038,0]}><sphereGeometry args={[.003,8,8]}/><meshBasicMaterial color="#34533b"/></mesh>}
  </group>
}

