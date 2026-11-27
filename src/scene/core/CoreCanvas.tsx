import {ShaderChunk} from 'three'
import {CatmullRomCurve3} from 'three'
import {FlowerFocus} from './FlowerFocus'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AgXToneMapping, Box3, Euler, Group, Mesh, MeshPhysicalMaterial, Object3D, PCFShadowMap, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three'
import { BASE_Y } from '../../content/catalog'
import { TABLE_VIEW } from '../../content/scene-view'
import { floatPosition, type ScreenRect } from '../../components/game/float-position'
import type { Debris, FlowerState } from '../../game/types'
import type { SceneAssets } from '../../services/scene-assets'
import { useCoreStore } from '../../state/core-store'
import NatureEnvironment from '../NatureEnvironment'
import SceneLighting from '../SceneLighting'
import {startingPixelRatio} from '../render-quality'
import {InteractionResolution} from './InteractionResolution'
import {SceneWarmup} from './SceneWarmup'
import PropGlass from '../PropGlass'
import { SceneMotion } from '../motion/SceneMotion'
import { centerObject, createPiece, createPlant, disposeGeometry } from './botanical-geometry'
import { coreFlowerPose, heldScissors, SCISSORS_REST } from './core-transforms'
import CoreControls from './CoreControls'
import { flowerPortraits } from './flower-portraits'
import type { FlowerKind } from '../../game/types'
import { BOX } from '../../game/desk-layout'
import { deskView, localBounds, propRotation } from './desk-space'
import { flowerOutline, flowerShadowGeometry, flowerSupport, releaseRestShape, restFlower } from './flower-rest'
import { registerFlowerShadow } from '../PropContactShadows'
import VaseWater from './VaseWater'
import { CupLiquid } from './tumbler'
import RitualControls from './RitualControls'
import type { shearStroke } from './shear-stroke'
import { observationMotion } from './observation-motion'

const overflowPath=new CatmullRomCurve3([new Vector3(),new Vector3(.003,-.003,.003),new Vector3(.001,-.019,.002),new Vector3(.004,-.035,.004),new Vector3(.011,-.070,.014)])
export type CoreWorld={
  pieces:Map<string,Group>;cancelPiece?:()=>boolean;gatherPieces?:(tidy?:boolean)=>void;sideFlower?:()=>void
  sampleFlower?:(choice:import('../../game/types').MaterialChoice)=>string|undefined
  portraits?:()=>Partial<Record<FlowerKind,string>>
  overflow:Mesh|null; pickFlower?:(e:PointerEvent)=>{id:string;point:Vector3}|undefined; cup:Group|null; water:Mesh|null; cupWater:CupLiquid|null; stream:Mesh|null; previewMl:number; pouring:boolean; abortRitual?:()=>boolean; takeCup?:()=>void; pourAction?:(action:'start'|'stop'|'cancel'|'retry'|'finish')=>void
  flowers:Map<string,Group>;scissors:Group|null;table:Object3D|null;tray:Object3D|null;vase:Group|null;ghost:Group|null;marker:Mesh|null
  stroke?:ReturnType<typeof shearStroke>;active:{kind:string;id?:string}|null;cancel:()=>boolean;zoom:number;cut:(target:string,at:number,commit:boolean)=>boolean
}
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches
const ease=(t:number)=>t*t*(3-2*t)
function FlowerObject({flower,kit,world}:{flower:FlowerState;kit:Object3D;world:CoreWorld}) {
  const editing=useCoreStore(s=>!s.ritual||s.ritual.stage==='prepare'||s.ritual.stage==='arrange'&&s.ritual.arranging)
  const insertPreview=useCoreStore(s=>s.selectedId===flower.id?s.insertPreview:null)
  const held=useCoreStore(s=>s.heldId===flower.id),selected=useCoreStore(s=>s.selectedId===flower.id)
  const work=useCoreStore(s=>s.history.present),turn=useCoreStore(s=>s.turn),epoch=useCoreStore(s=>s.epoch)
  const observing=useCoreStore(s=>s.ritual?.stage==='observe'&&s.heldId===flower.id)
  const trimming=useCoreStore(s=>s.ritual?.stage==='trim'&&s.heldId===flower.id)
  const overDesk=observing||trimming
  const flexible=observing||trimming
  const {invalidate,scene,size}=useThree(),ref=useRef<Group>(null)
  const model=useMemo(()=>createPlant(kit,flower),[kit,flower.id,flower.kind,flower.slot,flower.length,flower.stockLength,flower.headScale,flower.removed,flower.sections,flexible])
  const framing=useMemo(()=>held&&work.tools?{
    bounds:localBounds(model),outline:flowerOutline(model),editing:!flexible,overDesk
  }:undefined,[held,!!work.tools,flexible,overDesk,model])
  const motion=useMemo(()=>flexible?observationMotion(model,flower.length,trimming?(flower.headScale??1):0):undefined,[model,flexible,trimming,flower.length,flower.headScale])
  const animation=useRef<{start:number;from:Vector3;rotation:Quaternion;to:Vector3;end:Quaternion;zoom:number;clearance?:number}|null>(null)
  const resting=useMemo(()=>{
    if(held||!work.tools||flower.location!=='table')return null
    const pose=coreFlowerPose(flower,work,false)
    return restFlower(model,pose.position,pose.quaternion,!flower.tableRotation||Math.abs(new Vector3(0,1,0).applyQuaternion(pose.quaternion).y)>.20)
  },[flower,work.tools,model,held])
  const visibleModel=resting?.model??model
  const nearDesk=held||flower.location==='table'
  useLayoutEffect(()=>{
    if(nearDesk)return registerFlowerShadow(scene,visibleModel,flowerShadowGeometry(visibleModel))
  },[scene,visibleModel,nearDesk])
  const mounted=useRef(false),lastPlacement=useRef(-1),focusedModel=useRef<typeof model|null>(null),focusedEpoch=useRef(-1)
  useLayoutEffect(()=>{
    const root=ref.current!;world.flowers.set(flower.id,root)
    const pose=insertPreview?coreFlowerPose({...flower,pose:insertPreview,location:'vase'},work,false):resting??coreFlowerPose(flower,work,held,turn,world.zoom,framing)
    if(held&&world.active?.id===flower.id){animation.current=null}
    else if(!mounted.current||reduced()||(overDesk&&(focusedModel.current!==model||focusedEpoch.current!==epoch))){root.position.copy(pose.position);root.quaternion.copy(pose.quaternion);animation.current=null}
    else {
      const {lastCommand,serial}=useCoreStore.getState()
      const landing=!held&&work.tools&&flower.location==='table'&&lastCommand?.type==='place-flower'&&lastCommand.id===flower.id&&lastPlacement.current!==serial
      const clearance=landing?Math.max(0,root.position.y-flowerSupport(visibleModel,root.position,root.quaternion)):undefined
      if(landing)lastPlacement.current=serial
      animation.current={start:performance.now(),from:root.position.clone(),rotation:root.quaternion.clone(),to:pose.position,end:pose.quaternion,zoom:world.zoom,clearance}
    }
    focusedModel.current=overDesk?model:null;focusedEpoch.current=epoch;mounted.current=true;invalidate()
    return()=>{world.flowers.delete(flower.id)}
  },[flower,work.vase,work.tools,held,turn,epoch,world,invalidate,framing,insertPreview,size.width,size.height,resting])
  useFrame(()=>{
    if(world.active?.id===flower.id||world.active?.id===flower.location)return
    const a=animation.current;if(!a||!ref.current)return
    if(held&&a.zoom!==world.zoom){
      a.zoom=world.zoom
      a.to.copy(coreFlowerPose(flower,work,true,turn,world.zoom,framing).position)
    }
    const root=ref.current,landing=a.clearance!==undefined
    const t=Math.min(1,(performance.now()-a.start)/(landing?240:held?340:150))
    if(landing&&t<1){
      // The stem reaches its landing spot first. The tip finishes turning against the support.
      const travel=Math.min(1,t/.78),drop=Math.min(1,t/.86)
      root.position.lerpVectors(a.from,a.to,ease(travel))
      root.quaternion.slerpQuaternions(a.rotation,a.end,1-(1-t)**2)
      root.position.y=flowerSupport(visibleModel,root.position,root.quaternion)+a.clearance!*(1-drop*drop)
    }else{
      root.position.lerpVectors(a.from,a.to,ease(t));root.quaternion.slerpQuaternions(a.rotation,a.end,ease(t))
    }
    if(t===1)animation.current=null
    if(t<1||landing)invalidate()
  })
  useFrame((_,delta)=>{
    if(motion&&ref.current&&motion.update(ref.current,delta,reduced()))invalidate()
  })
  useEffect(()=>()=>{releaseRestShape(model);disposeGeometry(model)},[model])
  return <group ref={ref} name={'core-flower-'+flower.id} userData={{role:'flower',id:flower.id,heldFrame:framing}}>
    <primitive object={visibleModel} dispose={null}/>
    <mesh position={[0,flower.length,0]}><sphereGeometry args={[.024,10,8]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
    {editing&&!trimming&&(held||selected)&&<mesh name={'core-grip-'+flower.id} position={[0,flower.location==='vase'?flower.pose.depth+.02:.025,0]} userData={{role:'grip',id:flower.id}}>
      <sphereGeometry args={[.011,12,10]}/><meshBasicMaterial color="#f3e6ba" transparent opacity={observing?.08:.38} depthTest={false} depthWrite={false}/>
    </mesh>}
  </group>
}
function PieceObject({debris,kit,world}:{debris:Debris;kit:Object3D;world:CoreWorld}) {
  const shape=debris.shape!,ref=useRef<Group>(null),invalidate=useThree(s=>s.invalidate)
  const scene=useThree(s=>s.scene)
  const serial=useCoreStore(s=>s.serial),command=useCoreStore(s=>s.lastCommand)
  const object=useMemo(()=>{const g=createPiece(kit,shape.flower,shape.target,shape.from,shape.to);centerObject(g);return g},[kit,shape.flower,shape.target,shape.from,shape.to])
  useLayoutEffect(()=>registerFlowerShadow(scene,object,flowerShadowGeometry(object)),[scene,object])
  const fall=useMemo(()=>{
    if(!shape.contact)return
    const origin=new Vector3(...shape.origin),initial=new Quaternion(...shape.rotation),contact=new Vector3(...shape.contact)
    const firstY=flowerSupport(object,origin,initial),pivot=contact.clone().applyQuaternion(initial).add(origin)
    const end=new Quaternion(...shape.resting),drift=new Vector3(...shape.landing).sub(pivot.clone().sub(contact.clone().applyQuaternion(end)))
    drift.y=0
    return {origin,initial,contact,firstY,pivot,end,drift,v:new Vector3(),seconds:Math.sqrt(2*Math.max(0,origin.y-firstY)/9.81)}
  },[shape,object])
  const start=useRef(0),animate=useRef(false)
  useLayoutEffect(()=>{
    const s=useCoreStore.getState()
    animate.current=!reduced()&&command?.type==='free-cut'&&s.history.present.debris.at(-1)?.id===debris.id
    start.current=performance.now();ref.current!.userData.settled=!animate.current
    ref.current!.position.fromArray(animate.current?shape.origin:shape.landing)
    ref.current!.quaternion.fromArray(animate.current?shape.rotation:shape.resting)
    invalidate()
  },[shape,serial,command,debris.id,invalidate])
  useFrame(()=>{
    if(world.active?.kind==='piece'&&world.active.id===debris.id){animate.current=false;return}
    if(!animate.current||!ref.current)return
    if(fall){
      const time=(performance.now()-start.current)/1000,root=ref.current
      if(time<fall.seconds){
        root.position.copy(fall.origin);root.position.y-=4.905*time*time
        root.quaternion.copy(fall.initial)
      }else{
        const t=Math.min(1,(time-fall.seconds)/.32),roll=1-(1-t)**2
        root.quaternion.slerpQuaternions(fall.initial,fall.end,roll)
        root.position.copy(fall.pivot).sub(fall.v.copy(fall.contact).applyQuaternion(root.quaternion)).addScaledVector(fall.drift,roll)
        root.position.y=flowerSupport(object,root.position,root.quaternion)
        if(t===1){root.position.fromArray(shape.landing);animate.current=false;root.userData.settled=true}
      }
      invalidate();return
    }
    const t=Math.min(1,(performance.now()-start.current)/850),legacyFall=Math.min(1,t/.82),p=ref.current.position
    p.lerpVectors(new Vector3(...shape.origin),new Vector3(...shape.landing),legacyFall*legacyFall)
    if(t>.82)p.y+=Math.sin((t-.82)/.18*Math.PI)*.003
    ref.current.quaternion.slerpQuaternions(new Quaternion(...shape.rotation),new Quaternion(...shape.resting),ease(legacyFall))
    if(t===1){animate.current=false;ref.current.userData.settled=true;invalidate()}else invalidate()
  })
  useEffect(()=>()=>disposeGeometry(object),[object])
  useEffect(()=>{
    const settle=()=>{animate.current=false;if(ref.current){ref.current.userData.settled=true;ref.current.position.fromArray(shape.landing);ref.current.quaternion.fromArray(shape.resting);invalidate()}}
    window.addEventListener('blur',settle);return()=>window.removeEventListener('blur',settle)
  },[shape,invalidate,world])
  useLayoutEffect(()=>{
    const root=ref.current!;world.pieces.set(debris.id,root)
    return ()=>{world.pieces.delete(debris.id)}
  },[debris.id,world])
  return <group ref={ref} name={'core-debris-'+debris.id}><primitive object={object} dispose={null}/></group>
}
function Tools({assets,world}:{assets:SceneAssets;world:CoreWorld}) {
  const scissorsHeld=useCoreStore(s=>s.scissors),serial=useCoreStore(s=>s.serial),work=useCoreStore(s=>s.history.present),epoch=useCoreStore(s=>s.epoch)
  const cutting=useCoreStore(s=>s.ritual?.stage==='trim'&&!!s.heldId&&s.scissors)
  const {invalidate,size}=useThree()
  const liquid=useMemo(()=>new CupLiquid(),[])
  useEffect(()=>()=>liquid.dispose(),[liquid])
  const models=useMemo(()=>{
    const clone=(name:string)=>{const source=assets.kit.scene.getObjectByName(name);if(!source)throw Error('缺少器物模型');const object=source.clone(true);object.position.set(0,0,0);object.quaternion.identity();object.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true;if(name==='vase_root')o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone()}if(o.name==='glass_water')o.visible=false});return object}
    return {table:clone('wood_table_root'),tray:clone('tray_root'),vase:clone('vase_root'),cup:clone('glass_root'),scissors:clone('scissors_root')}
  },[assets])
  useLayoutEffect(()=>{
    const originals=new Map<Mesh,MeshPhysicalMaterial>(),wood=new Map<MeshPhysicalMaterial,MeshPhysicalMaterial>()
    for(const root of [models.table,models.tray]){
      root.traverse(node=>{
        if(!(node instanceof Mesh)||!(node.material instanceof MeshPhysicalMaterial))return
        const original=node.material
        let finish=wood.get(original)
        if(!finish){
          finish=original.clone()
          const [r,g,b]=assets.sceneId==='bamboo'?[.78,.86,.80]:[.83,.85,.72]
          finish.color.r*=r;finish.color.g*=g;finish.color.b*=b
          finish.clearcoat=.025;finish.clearcoatRoughness=.64
          finish.roughness=Math.max(.68,original.roughness);finish.specularIntensity*=.42
          const key=finish.customProgramCacheKey()
          // Under the forest canopy the broad fill stays below the light through the openings.
          finish.onBeforeCompile=shader=>{
            shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',
              ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
                'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= 0.72;'))
          }
          finish.customProgramCacheKey=()=>key+'-canopy-fill'
          wood.set(original,finish)
        }
        originals.set(node,original);node.material=finish
      })
    }
    return ()=>{
      originals.forEach((material,mesh)=>{mesh.material=material})
      wood.forEach(material=>material.dispose())
    }
  },[assets.sceneId,models])
  const minStandbyY=useMemo(()=>{
    const bounds=localBounds(models.scissors),v=new Vector3()
    const rotation=new Quaternion().setFromEuler(new Euler(Math.PI/2,0,.65,'ZXY'))
    let low=Infinity
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      low=Math.min(low,v.set(x,y,z).applyQuaternion(rotation).y)
    }
    return BOX.rim+.025-low
  },[models])
  const standbyY=useRef(0)
  const animated=useRef<{start:number;from:Vector3;rotation:Quaternion;to:Vector3;end:Quaternion}|null>(null),mounted=useRef(false)
  useLayoutEffect(()=>{
    world.table=models.table;world.tray=models.tray
    const object=world.scissors;if(!object)return
    const to=new Vector3(...(scissorsHeld?heldScissors(work,cutting):(work.tools?.scissors??SCISSORS_REST)))
    standbyY.current=to.y
    const end=scissorsHeld?new Quaternion().setFromEuler(new Euler(Math.PI/2,0,.65,'ZXY')):work.tools?propRotation(work,'scissors'):new Quaternion().setFromEuler(new Euler(0,.3,0))
    if(!mounted.current||reduced()){object.position.copy(to);object.quaternion.copy(end);animated.current=null}
    else animated.current={start:performance.now(),from:object.position.clone(),rotation:object.quaternion.clone(),to,end}
    mounted.current=true;invalidate()
  },[models,scissorsHeld,cutting,serial,epoch,world,size.width,size.height,invalidate])
  useFrame(()=>{
    const object=world.scissors,a=animated.current
    if(!object||world.active?.kind==='prop'||world.active?.kind==='carry'||world.active?.kind==='scissors')return
    if(world.stroke){
      animated.current=null
      if(world.stroke.update(performance.now(),reduced()))world.stroke=undefined
      invalidate();return
    }
    const heldId=useCoreStore.getState().heldId
    const lift=cutting&&heldId?world.flowers.get(heldId)?.userData.heldFrame?.lift??0:0
    const raise=cutting?Math.max(lift,minStandbyY-standbyY.current):0
    if(a){
      const t=Math.min(1,(performance.now()-a.start)/220)
      object.position.lerpVectors(a.from,a.to,ease(t));object.quaternion.slerpQuaternions(a.rotation,a.end,ease(t))
      object.position.y+=raise*ease(t)
      if(t===1)animated.current=null;else invalidate()
    }else if(cutting)object.position.y=standbyY.current+raise
    const recent=useCoreStore.getState().lastCommand?.type==='free-cut'&&a
    const opening=scissorsHeld?(recent&&performance.now()-a.start<160?0:.18):0
    models.scissors.getObjectByName('scissors_half_0')!.rotation.y=-opening
    models.scissors.getObjectByName('scissors_half_1')!.rotation.y=opening
  })
  return <>
    <primitive object={models.table} userData={{role:'table'}} dispose={null}/>
    <primitive object={models.tray} position={[0,.761,work.tools?BOX.z:0]} scale={work.tools?[BOX.scaleX,1,BOX.scaleZ]:[1,1,1]} userData={{role:'table'}} dispose={null}/>
    <group ref={o=>{world.vase=o}} name="core-vase" position={[work.vase.x,work.tools?.vaseY??BASE_Y,work.vase.z-.025]} quaternion={propRotation(work,'vase')} userData={{role:'vase'}}>
      <primitive object={models.vase} dispose={null}/>
      <mesh ref={o=>{world.overflow=o}} name="overflow-film" position={[.011,.178,.012]} visible={false}>
        <tubeGeometry args={[overflowPath,18,.0013,6,false]}/><meshStandardMaterial color="#bddfdb" transparent opacity={.8} roughness={.1}/>
      </mesh>
      {work.tools?<VaseWater world={world}/>:<mesh ref={o=>{world.water=o}} visible={work.vaseMl>0} position={[0,.087,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.025,32]}/><meshStandardMaterial color="#6f9385" roughness={.13}/></mesh>}
    </group>
    <group ref={o=>{world.cup=o}} name="core-cup" quaternion={propRotation(work,'cup')} position={work.tools?.cup??[-.26,BASE_Y,-.025]}>
      <primitive object={models.cup} dispose={null}/><PropGlass model={models.cup} waterPlane={work.tools?liquid.surfacePlane:undefined}/>
      {work.tools&&<primitive object={liquid} ref={(o:CupLiquid|null)=>{world.cupWater=o}} dispose={null}/>}</group>
    <group ref={o=>{world.scissors=o}} name="core-scissors" userData={{role:'scissors'}}><primitive object={models.scissors} dispose={null}/></group>
  </>
}
type CanvasProps={assets:SceneAssets;onReady:()=>void;onWorld:(world:CoreWorld)=>void;onExport:(fn:(wish?:string)=>void)=>void;contextRef:RefObject<HTMLDivElement|null>}
function Contents({assets,onReady,onWorld,onExport,contextRef}:CanvasProps) {
  const world=useMemo<CoreWorld>(()=>({overflow:null,cup:null,water:null,cupWater:null,stream:null,previewMl:0,pouring:false,flowers:new Map(),pieces:new Map(),scissors:null,table:null,tray:null,vase:null,ghost:null,marker:null,active:null,cancel:()=>false,zoom:0,cut:()=>false}),[])
  const lastLayout=useRef({time:0,key:''})
  const work=useCoreStore(s=>s.history.present),{camera,gl,scene,size,invalidate}=useThree()
  useLayoutEffect(()=>{
    camera.position.set(...TABLE_VIEW.eye);camera.quaternion.setFromEuler(new Euler(TABLE_VIEW.pitch*Math.PI/180,0,0,'YXZ'))
    if(camera instanceof PerspectiveCamera){camera.fov=work.tools?deskView(size.width,size.height).fov:size.width<600?TABLE_VIEW.mobileFov:TABLE_VIEW.desktopFov;camera.updateProjectionMatrix()}
    camera.updateMatrixWorld();invalidate()
  },[camera,size.width,size.height,!!work.tools,invalidate])
  useEffect(()=>{
    let portraits:ReturnType<typeof flowerPortraits>|undefined
    world.portraits=()=>portraits??=flowerPortraits(gl,assets.kit.scene)
    world.sampleFlower=choice=>flowerPortraits(gl,assets.kit.scene,choice)[choice.kind]
    onWorld(world)
    if(import.meta.env.DEV||Boolean((globalThis as {flowerCoreReview?:boolean}).flowerCoreReview))Object.assign(window,{__coreInspect:{scene,camera,renderer:gl,Vector3,Box3,Raycaster,world,read:()=>({history:useCoreStore.getState().history,ritual:useCoreStore.getState().ritual,cupHeld:useCoreStore.getState().cupHeld,held:useCoreStore.getState().heldId,selected:useCoreStore.getState().selectedId,tool:useCoreStore.getState().scissors,active:world.active})}})
    onExport((wish)=>{
      const state=useCoreStore.getState()
      if(state.saving)return
      useCoreStore.setState({saving:true,saveNotice:''})
      const failed=()=>useCoreStore.setState({saving:false,saveNotice:'图片生成失败，可以再次点「保存作品」重试。'})
      const capture=()=>{
        const previewRatio=gl.getPixelRatio()
        try{
          gl.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5))
          gl.render(scene,camera)
          let output=gl.domElement
          if(wish?.trim()){
            const copy=document.createElement('canvas');copy.width=output.width;copy.height=output.height
            const ctx=copy.getContext('2d')
            if(!ctx){failed();return}
            {
              const font=Math.max(18,copy.width*.021),pad=font
              ctx.font=font+'px serif';const lines:string[]=[];let line=''
              for(const char of wish){if(char==='\n'||ctx.measureText(line+char).width>copy.width-3*pad){lines.push(line);line=''}if(char!=='\n')line+=char}
              lines.push(line)
              const height=Math.ceil(lines.length*font*1.5+pad*2)
              copy.height=output.height+height
              ctx.drawImage(output,0,0)
              ctx.fillStyle='#f3efdf';ctx.fillRect(0,output.height,copy.width,height)
              ctx.font=font+'px serif';ctx.fillStyle='#334638'
              lines.forEach((v,i)=>ctx.fillText(v,pad,output.height+pad+font*(1+i*1.5)))
              output=copy
            }
          }
          output.toBlob(blob=>{
            if(!blob){failed();return}
            try{
              const url=URL.createObjectURL(blob),a=document.createElement('a')
              a.href=url;a.download='一席花.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
              useCoreStore.setState({saving:false,saveNotice:'作品图片已生成。'})
            }catch{failed()}
          },'image/png')
        }catch{failed()}finally{
          gl.setPixelRatio(previewRatio)
        }
      }
      if(state.ritual?.stage==='done')capture()
      else{
        world.cancel();state.putDown();useCoreStore.setState({selectedId:null})
        setTimeout(capture,750)
      }
    })
    return()=>{delete (window as unknown as Record<string,unknown>).__coreInspect}
  },[onReady,onWorld,onExport,world,scene,camera,gl,assets.kit])
  useFrame(()=>{
    const node=contextRef.current,s=useCoreStore.getState(),object=s.selectedId?world.flowers.get(s.selectedId):undefined
    const pour=gl.domElement.parentElement?.closest('.core-studio')?.querySelector<HTMLElement>('.cup-pour-actions')
    if(pour&&world.cup&&world.vase&&s.history.present.tools){
      const anchor=world.vase.localToWorld(new Vector3(0,.178,0))
      const right=new Vector3().setFromMatrixColumn(camera.matrixWorld,0)
      const safeEdge=anchor.clone().addScaledVector(right,.155).project(camera)
      anchor.project(camera)
      const x=(1+anchor.x)*size.width/2,y=(1-anchor.y)*size.height/2
      const width=pour.offsetWidth,height=pour.offsetHeight
      const gap=Math.max(35,(safeEdge.x-anchor.x)*size.width/2+10)
      const side=x+gap+width<=size.width-8?x+gap:x-width-gap
      pour.style.left=Math.max(8,Math.min(size.width-width-8,side))+'px'
      pour.style.top=Math.max(8,Math.min(size.height-height-8,y-height/2))+'px'
      pour.style.visibility='visible'
      pour.style.setProperty('--vase-level',String(Math.min(1,(s.history.present.vaseMl+world.previewMl)/130)))
    }
    if(s.ritual||!node||!object)return
    if(world.active){node.style.visibility='hidden';return}
    node.style.visibility='visible'
    const now=performance.now(),cache=lastLayout.current
    if(now-cache.time<65)return
    cache.time=now
    const key=[s.selectedId,s.serial,s.epoch,s.mode,node.offsetWidth,node.offsetHeight,size.width,size.height,...camera.matrixWorld.elements,...object.matrixWorld.elements,...world.scissors?.matrixWorld.elements??[],...world.vase?.matrixWorld.elements??[]].join('/')
    if(cache.key===key&&!world.marker?.visible&&!s.history.present.debris.length)return
    cache.key=key
    const project=(v:Vector3)=>{v.project(camera);return {x:(v.x+1)*size.width/2,y:(1-v.y)*size.height/2}}
    const avoid:ScreenRect[]=[]
    for(const item of [world.vase,object,world.scissors,...scene.children.filter(o=>o.name.startsWith('core-debris-'))]){
      if(!item)continue
      const b=new Box3().setFromObject(item);if(b.isEmpty())continue
      const points=[b.min.x,b.max.x].flatMap(x=>[b.min.y,b.max.y].flatMap(y=>[b.min.z,b.max.z].map(z=>project(new Vector3(x,y,z)))))
      avoid.push({left:Math.min(...points.map(p=>p.x))-12,right:Math.max(...points.map(p=>p.x))+12,top:Math.min(...points.map(p=>p.y))-12,bottom:Math.max(...points.map(p=>p.y))+12})
    }
    for(const selector of ['.core-heading','.core-utilities']){
      const rect=document.querySelector(selector)?.getBoundingClientRect()
      if(rect)avoid.push({left:rect.left-8,right:rect.right+8,top:rect.top-8,bottom:rect.bottom+8})
    }
    if(world.marker?.visible){const p=project(world.marker.position.clone());avoid.push({left:p.x-26,right:p.x+26,top:p.y-26,bottom:p.y+26})}
    const anchor=project(object.getWorldPosition(new Vector3()))
    const position=floatPosition(size,{width:node.offsetWidth,height:node.offsetHeight},anchor,avoid)
    node.style.left=position.x+'px';node.style.top=position.y+'px'
    node.style.visibility=world.active?'hidden':'visible'
  })
  return <>
    <FlowerFocus world={world}/>
    <InteractionResolution world={world}/>
    <SceneLighting sceneId={assets.sceneId} light={assets.light}/>
    <NatureEnvironment model={assets.environment} kit={assets.natureKit} sceneId={assets.sceneId} floor={assets.floor} bankAtlas={assets.bankAtlas} distance={assets.distance}/>
    <group name="workbench_and_tools">
    <Tools assets={assets} world={world}/>
    <mesh ref={o=>{world.stream=o}} visible={false}><cylinderGeometry args={[.0017,.0021,1,12]}/><meshStandardMaterial color="#a8d5d0" transparent opacity={.74} roughness={.08}/></mesh>
    {work.flowers.map(f=><FlowerObject key={f.id} flower={f} kit={assets.kit.scene} world={world}/>)}
    {work.debris.filter(d=>d.shape).map(d=><PieceObject key={d.id} debris={d} kit={assets.kit.scene} world={world}/>)}
    <group ref={o=>{world.ghost=o}} name="core-cut-preview" visible={false}/>
    <mesh ref={o=>{world.marker=o}} name="core-cut-marker" renderOrder={8} visible={false} raycast={()=>null}>
      <torusGeometry args={[.007,.0008,6,32]}/><meshBasicMaterial color="#d6b56b" toneMapped={false} depthTest={false} depthWrite={false}/>
      <mesh name="cut-contrast-rim" visible={false} renderOrder={7} raycast={()=>null}>
        <torusGeometry args={[.007,.00165,8,32]}/><meshBasicMaterial color="#3a3221" toneMapped={false} depthTest={false} depthWrite={false}/>
      </mesh>
    </mesh>
    </group>
    <CoreControls world={world} kit={assets.kit.scene}/>
    {work.tools&&<RitualControls world={world}/>}
    <SceneWarmup identity={assets.environment} onReady={onReady}/>
  </>
}
export default function CoreCanvas(props:CanvasProps) {
  return <Canvas shadows={{type:PCFShadowMap}} frameloop="demand" dpr={startingPixelRatio(window.innerWidth,window.innerHeight,window.devicePixelRatio)} camera={{position:TABLE_VIEW.eye,fov:TABLE_VIEW.desktopFov,near:.015,far:60}}
    gl={{antialias:true,toneMapping:AgXToneMapping,preserveDrawingBuffer:true}} fallback={<p role="alert">浏览器暂不支持三维显示，请启用硬件加速。</p>}>
    <SceneMotion><Contents {...props}/></SceneMotion>
  </Canvas>
}
