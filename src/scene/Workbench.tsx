import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Group, Mesh, MeshPhysicalMaterial, Object3D, Plane, Quaternion, Vector3, type Material } from 'three'
import { ContactShadows } from '@react-three/drei'
import { BASE_Y, MOUTH_Y } from '../content/catalog'
import { useGameStore } from '../state/game-store'
import type { SceneAssets } from '../services/scene-assets'
import Flower, { flowerTransform } from './objects/Flower'
import CutDebris from './objects/CutDebris'
import PropGlass from './PropGlass'
import { useMotionBusy, useObjectPose, useSceneMotion } from './motion/SceneMotion'
import { cupHome, scissorsHome, scissorsTurn, useToolMotion } from './motion/useToolMotion'

export default function Workbench({assets,onReady}:{assets:SceneAssets;onReady:()=>void}){
  const s=useGameStore(x=>x.history.present),dragging=useGameStore(x=>x.dragging),action=useGameStore(x=>x.visualAction),preview=useGameStore(x=>x.cutPreview)
  const invalidate=useThree(x=>x.invalidate),world=useThree(x=>x.scene),vaseRef=useRef<Group>(null),cupRef=useRef<Group>(null)
  const scissorsRef=useRef<Group>(null),cupWater=useRef<Mesh>(null),surface=useRef<Mesh>(null),vaseWater=useRef<Mesh>(null),stream=useRef<Mesh>(null),ripple=useRef<Mesh>(null)
  const motion=useSceneMotion(),moving=useMotionBusy()
  const models=useMemo(()=>{
    const owned:Material[]=[]
    const clone=(name:string)=>{
      const source=assets.kit.scene.getObjectByName(name);if(!source)throw new Error('缺少模型 '+name)
      const o=source.clone(true);o.position.set(0,0,0)
      o.traverse((obj:Object3D)=>{
        if(obj.name==='glass_water')obj.visible=false
        if(obj instanceof Mesh){obj.castShadow=true;obj.receiveShadow=true
          if(name==='glass_root'){
            obj.castShadow=false
            const material=(source:Material)=>{
              const copy=source.clone()
              if(copy instanceof MeshPhysicalMaterial){
                copy.thickness=.003
                copy.attenuationColor.set('#f0f6f2')
                copy.attenuationDistance=.6
                copy.ior=1.47
                copy.transmission=obj.name==='glass_polished_lip'?.9:1
                copy.opacity=1
                copy.roughness=.025
                copy.envMapIntensity=1.5
              }
              owned.push(copy)
              return copy
            }
            obj.material=Array.isArray(obj.material)?obj.material.map(material):material(obj.material)
          }
        }
      });return o
    }
    return {table:clone('wood_table_root'),tray:clone('tray_root'),vase:clone('vase_root'),cup:clone('glass_root'),scissors:clone('scissors_root'),owned}
  },[assets.kit])
  useEffect(()=>()=>models.owned.forEach(material=>material.dispose()),[models])
  useObjectPose(vaseRef,new Vector3(s.vase.x,BASE_Y,s.vase.z-.025),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-s.vase.yaw*Math.PI/180),action)
  useObjectPose(cupRef,cupHome(),new Quaternion(),action)
  useObjectPose(scissorsRef,scissorsHome(),scissorsTurn(),preview||action)
  useToolMotion({cup:cupRef,scissors:scissorsRef,cupWater,surface,vaseWater,stream,ripple},models.scissors)
  useEffect(onReady,[onReady,assets])
  const drag=useRef<{kind:'cup'|'vase';start:Vector3;x:number;y:number;moved:boolean;pointer:number;target:{releasePointerCapture:(id:number)=>void};destination:Vector3}|null>(null)
  const horizontal=new Plane(new Vector3(0,1,0),-BASE_Y),hit=new Vector3()
  const restore=()=>{
    const state=useGameStore.getState()
    if(vaseRef.current)vaseRef.current.position.set(state.history.present.vase.x,BASE_Y,state.history.present.vase.z-.025)
    for(const f of state.history.present.flowers){if(f.location==='vase'){const obj=world.getObjectByName(f.id);if(obj)obj.position.copy(flowerTransform(f,state.history.present,false).position)}}
    if(cupRef.current)cupRef.current.position.copy(cupHome())
    invalidate()
  }
  const cancel=()=>{const d=drag.current;if(!d)return;drag.current=null;try{d.target.releasePointerCapture(d.pointer)}catch{};useGameStore.getState().setDragging(false);restore()}
  useEffect(()=>{
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel()}
    window.addEventListener('keydown',escape);window.addEventListener('blur',cancel);window.addEventListener('pointercancel',cancel)
    return()=>{cancel();window.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);window.removeEventListener('pointercancel',cancel)}
  },[])
  const down=(kind:'cup'|'vase',e:ThreeEvent<PointerEvent>)=>{
    const state=useGameStore.getState();if(e.button!==0||state.looking||state.recoveryBlocked)return;e.stopPropagation()
    motion.settle()
    if(kind==='cup'){
      state.setTool('cup')
      if(state.history.present.flowers.some(f=>f.location==='cup')){state.tell('先取出杯中花草，再拿杯注水。');return}
    }
    else if(state.tool==='cup'){
      state.dispatch({type:'pour',ml:130})
      return
    }
    else if(state.held && state.selectedId && !state.tool){
      state.dispatch({type:'insert',id:state.selectedId})
      return
    }
    else if(state.tool||state.held){state.tell('先放回手中物品，再移动花瓶。');return}
    if(!e.ray.intersectPlane(horizontal,hit))return
    const target=e.target as unknown as {setPointerCapture:(id:number)=>void;releasePointerCapture:(id:number)=>void}
    target.setPointerCapture(e.pointerId)
    drag.current={kind,start:hit.clone(),x:e.clientX,y:e.clientY,moved:false,pointer:e.pointerId,target,destination:hit.clone()};state.setDragging(true)
  }
  const move=(e:ThreeEvent<PointerEvent>)=>{
    const d=drag.current;if(!d)return;e.stopPropagation()
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6&&!d.moved)return;d.moved=true
    const dragPlane=d.kind==='cup'?new Plane(new Vector3(0,1,0),-MOUTH_Y):horizontal
    if(!e.ray.intersectPlane(dragPlane,hit))return;d.destination.copy(hit)
    if(d.kind==='cup'&&cupRef.current)cupRef.current.position.set(hit.x,MOUTH_Y+.05,hit.z)
    if(d.kind==='vase'&&vaseRef.current){
      const state=useGameStore.getState().history.present
      const x=Math.max(-.04,Math.min(.04,state.vase.x+hit.x-d.start.x)),z=Math.max(-.04,Math.min(.04,state.vase.z+hit.z-d.start.z))
      vaseRef.current.position.set(x,BASE_Y,z-.025)
      for(const f of state.flowers){if(f.location==='vase'){const obj=world.getObjectByName(f.id);if(obj)obj.position.copy(flowerTransform(f,state,false).position).add(new Vector3(x-state.vase.x,0,z-state.vase.z))}}
    }
    invalidate()
  }
  const release=(e:ThreeEvent<PointerEvent>)=>{
    const d=drag.current;if(!d)return;e.stopPropagation();drag.current=null;try{d.target.releasePointerCapture(d.pointer)}catch{}
    const state=useGameStore.getState(),before=state.history;state.setDragging(false)
    if(d.moved){
      if(d.kind==='cup'){
        if(Math.hypot(d.destination.x-s.vase.x,d.destination.z-(s.vase.z-.025))<.09)state.dispatch({type:'pour',ml:130})
        else state.tell('将杯子移到瓶口上方，或使用注水按钮。')
      }else state.dispatch({type:'move-vase',pose:{x:Math.max(-.04,Math.min(.04,s.vase.x+d.destination.x-d.start.x)),z:Math.max(-.04,Math.min(.04,s.vase.z+d.destination.z-d.start.z))}})
    }
    if(d.kind!=='cup'||!d.moved||useGameStore.getState().history===before||Math.hypot(d.destination.x-s.vase.x,d.destination.z-(s.vase.z-.025))>=.09)restore()
  }
  return <>
    <primitive object={models.table} dispose={null}/>
    <primitive object={models.tray} position={[0,.761,0]} dispose={null}/>
    {!dragging&&!moving&&<ContactShadows key={JSON.stringify(s)} position={[0,BASE_Y+.0003,-.005]} scale={1} width={.60} height={.37} opacity={.25} blur={.65} far={.07} resolution={512} color="#251c16" frames={1}/>}
    <group ref={vaseRef} onPointerDown={e=>down('vase',e)} onPointerMove={move} onPointerUp={release}>
      <primitive object={models.vase} dispose={null}/>
      <mesh ref={vaseWater} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.022,32]}/><meshStandardMaterial color="#7caaa7" roughness={.1}/></mesh>
    </group>
    <group ref={cupRef} onPointerDown={e=>down('cup',e)} onPointerMove={move} onPointerUp={release}>
      <primitive object={models.cup} dispose={null}/>
      <PropGlass model={models.cup}/>
      <mesh ref={cupWater}><cylinderGeometry args={[.032,.028,1,64]}/><meshPhysicalMaterial color="#ffffff" transmission={1} thickness={.018} ior={1.333} roughness={0}/></mesh>
      <mesh ref={surface} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.032,.00035,6,64]}/><meshPhysicalMaterial color="#e4ede7" transmission={.8} thickness={.001} ior={1.333} roughness={.06}/></mesh>
    </group>
    <group ref={scissorsRef} onPointerDown={e=>{if(!useGameStore.getState().looking){e.stopPropagation();useGameStore.getState().setTool('scissors')}}}>
      <primitive object={models.scissors} dispose={null}/>
    </group>
    {s.flowers.map(f=><Flower key={f.id} flower={f} kit={assets.kit.scene}/>)}
    {s.debris.map((d,i)=><CutDebris key={d.id} debris={d} index={i} kit={assets.kit.scene}/>)}
    <mesh ref={stream} visible={false} raycast={()=>null}><cylinderGeometry args={[1,1,1,8]}/><meshBasicMaterial color="#d9ece3" transparent opacity={.65} depthWrite={false}/></mesh>
    <mesh ref={ripple} rotation={[-Math.PI/2,0,0]} visible={false} raycast={()=>null}><torusGeometry args={[1,.09,5,24]}/><meshBasicMaterial color="#d5e7dc" transparent opacity={.55} depthWrite={false}/></mesh>
    {dragging&&<mesh position={[s.vase.x,MOUTH_Y+.002,s.vase.z-.025]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.021,.025,32]}/><meshBasicMaterial color="#4c7954" depthTest={false}/></mesh>}
  </>
}

