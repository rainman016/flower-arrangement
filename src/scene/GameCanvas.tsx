import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { AgXToneMapping, Euler, PerspectiveCamera, PCFShadowMap } from 'three'
import { useGameStore } from '../state/game-store'
import type { SceneAssets } from '../services/scene-assets'
import Workbench from './Workbench'
import { SCENE_FILTER, TABLE_VIEW } from '../content/scene-view'
import NatureEnvironment from './NatureEnvironment'
import SceneLighting from './SceneLighting'
import { SceneMotion, useSceneMotion } from './motion/SceneMotion'

function FixedEye({assets,onCapture}:{assets:SceneAssets;onCapture:(capture:()=>void)=>void}){
  const {camera,gl,scene,size,invalidate}=useThree()
  const motion=useSceneMotion()
  const view=useGameStore(s=>s.view),looking=useGameStore(s=>s.looking)
  const drag=useRef<{x:number;y:number;yaw:number;pitch:number;pointer:number}|null>(null)
  const setView=(yaw:number,pitch:number)=>{camera.position.set(...TABLE_VIEW.eye);camera.quaternion.setFromEuler(new Euler(pitch*Math.PI/180,yaw*Math.PI/180,0,'YXZ'));camera.updateMatrixWorld();invalidate()}
  useEffect(()=>{setView(view.yaw,view.pitch)},[view,camera,invalidate])
  useEffect(()=>{if(camera instanceof PerspectiveCamera){camera.fov=size.width<600?TABLE_VIEW.mobileFov:TABLE_VIEW.desktopFov;camera.updateProjectionMatrix();invalidate()}},[camera,size.width,invalidate])
  useEffect(()=>{
    onCapture(()=>{
      motion.settle();scene.updateMatrixWorld(true)
      gl.render(scene,camera)
      const output=document.createElement('canvas');output.width=gl.domElement.width;output.height=gl.domElement.height
      const context=output.getContext('2d')
      if(!context){useGameStore.getState().tell('导出暂时失败，请重试。');return}
      context.filter=SCENE_FILTER;context.drawImage(gl.domElement,0,0)
      output.toBlob(blob=>{
      if(!blob){useGameStore.getState().tell('导出暂时失败，请重试。');return}
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='一席花-'+assets.sceneId+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);useGameStore.getState().tell('作品图片已导出。')
    },'image/png')})
  },[onCapture,gl,scene,camera,assets.sceneId])
  useEffect(()=>{
    const canvas=gl.domElement
    const end=()=>{const d=drag.current;if(!d)return;drag.current=null;try{canvas.releasePointerCapture(d.pointer)}catch{};const e=new Euler().setFromQuaternion(camera.quaternion,'YXZ');useGameStore.getState().viewTo(e.y*180/Math.PI,e.x*180/Math.PI)}
    const down=(e:PointerEvent)=>{if(!useGameStore.getState().looking||e.button!==0)return
      const v=useGameStore.getState().view;drag.current={x:e.clientX,y:e.clientY,yaw:v.yaw,pitch:v.pitch,pointer:e.pointerId};canvas.setPointerCapture(e.pointerId)}
    const move=(e:PointerEvent)=>{const d=drag.current;if(!d)return;setView(d.yaw+(e.clientX-d.x)*.18,Math.max(-65,Math.min(60,d.pitch+(e.clientY-d.y)*.16)))}
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);window.addEventListener('blur',end)
    return()=>{end();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);window.removeEventListener('blur',end)}
  },[camera,gl,invalidate])
  useEffect(()=>{gl.domElement.style.cursor=looking?'grab':'default';if(!looking)drag.current=null},[looking,gl])
  return null
}
export default function GameCanvas({assets,onReady,onCapture}:{assets:SceneAssets;onReady:()=>void;onCapture:(capture:()=>void)=>void}){
  return <Canvas style={{filter:SCENE_FILTER}} shadows={{type:PCFShadowMap}} frameloop="demand" dpr={[1,1.5]} camera={{position:TABLE_VIEW.eye,fov:TABLE_VIEW.desktopFov,near:.015,far:60}}
    gl={{antialias:true,toneMapping:AgXToneMapping,preserveDrawingBuffer:false}}
    fallback={<div className="scene-fallback" role="alert">浏览器暂不支持三维显示，请启用硬件加速后重试。</div>}>
    <SceneMotion><FixedEye assets={assets} onCapture={onCapture}/>
    <SceneLighting sceneId={assets.sceneId} light={assets.light}/>
    <NatureEnvironment model={assets.environment} kit={assets.natureKit} sceneId={assets.sceneId} floor={assets.floor} bankAtlas={assets.bankAtlas}/>
    <Workbench assets={assets} onReady={onReady}/></SceneMotion>
  </Canvas>
}

