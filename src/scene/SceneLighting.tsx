import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Fog, Object3D, RectAreaLight, type DirectionalLight, type Texture } from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import type { SceneId } from '../game/types'
import PropContactShadows from './PropContactShadows'
import WorkbenchCanopy from './WorkbenchCanopy'
import {woodlandSky} from './WoodlandSky'
import {canopyLight,forestSun} from './CanopyLight'
import {lowWoodlandQuality} from './render-quality'

const LOOKS = {
  bamboo: {key:4.8,color:'#ffe4b1',sky:'#d5dec1',ground:'#465036',exposure:.91,fog:'#8e9c78',near:10.5,far:65},
  rain: {key:2.0,color:'#d8e8ed',sky:'#bfd4d9',ground:'#384936',exposure:.99,fog:'#9aadae',near:5.6,far:36},
  creek: {key:5.15,color:'#ffe2a5',sky:'#cddcda',ground:'#46553c',exposure:.96,fog:'#a0b6b7',near:7.8,far:66},
}

export default function SceneLighting({sceneId,light}:{sceneId:SceneId;light:Texture}){
  const {scene,gl,invalidate}=useThree(),look=LOOKS[sceneId]
  useLayoutEffect(()=>{
    if(!lowWoodlandQuality)return
    const oldTransmission=gl.transmissionResolutionScale
    gl.transmissionResolutionScale=.5
    return ()=>{gl.transmissionResolutionScale=oldTransmission}
  },[gl])
  const sun=useRef<DirectionalLight>(null),lastShadow=useRef(-Infinity)
  useFrame(()=>{
    if(!sun.current||!lowWoodlandQuality)return
    const now=performance.now()
    if(now-lastShadow.current>=120){
      sun.current.shadow.needsUpdate=true
      lastShadow.current=now
    }
  })
  const sky=useMemo(()=>woodlandSky(sceneId),[sceneId])
  useEffect(()=>()=>sky.dispose(),[sky])
  const workSurface=useMemo(()=>{const object=new Object3D();object.position.set(0,.77,0);return object},[])
  const sunPatch=useMemo(()=>{
    const target=new Object3D()
    target.position.set(sceneId==='bamboo'?-2.45:.37,.06,sceneId==='bamboo'?-5.4:-4.48)
    return target
  },[sceneId])
  const clearing=useMemo(()=>new RectAreaLight(),[])
  const canopy=useMemo(canopyLight,[])
  useEffect(()=>()=>canopy.dispose(),[canopy])
  useLayoutEffect(()=>{
    RectAreaLightUniformsLib.init()
    clearing.color.set(sceneId==='rain'?'#e2ecec':'#fff3da')
    clearing.intensity=sceneId==='rain'?6.8:7.8;clearing.width=.38;clearing.height=1.04
    clearing.position.set(-.71,1.34,.49);clearing.lookAt(0,.84,0);invalidate()
  },[clearing,sceneId,invalidate])
  useLayoutEffect(()=>{
    const previous={environment:scene.environment,background:scene.background,fog:scene.fog,intensity:scene.environmentIntensity,exposure:gl.toneMappingExposure,rotation:scene.environmentRotation.clone()}
    scene.environment=light;scene.environmentRotation.set(0,1.05,0);scene.environmentIntensity=.36
    scene.background=sky;scene.fog=new Fog(look.fog,look.near,look.far)
    gl.toneMappingExposure=look.exposure;invalidate()
    return()=>{
      scene.environment=previous.environment;scene.background=previous.background;scene.fog=previous.fog
      scene.environmentIntensity=previous.intensity;scene.environmentRotation.copy(previous.rotation)
      gl.toneMappingExposure=previous.exposure
    }
  },[scene,gl,light,look,sky,sceneId,invalidate])
  return <>
    <PropContactShadows sceneId={sceneId}/>
    <hemisphereLight args={[look.sky,look.ground,sceneId==='rain'?.43:sceneId==='bamboo'?.38:.29]}/>
    <primitive object={clearing}/>
    <primitive object={workSurface}/>
    {sceneId!=='rain'&&<>
      <primitive object={sunPatch}/>
      <spotLight name={sceneId==='bamboo'?'bamboo_gap_sun':undefined} position={sceneId==='bamboo'?[-8.15,4.76,-15.1]:[-5.6,5,-7.4]} target={sunPatch} angle={sceneId==='bamboo'?.28:.40} penumbra={.62}
        map={canopy} color={sceneId==='bamboo'?'#ffdfa0':'#ffedb4'} intensity={sceneId==='bamboo'?440:570} distance={30}/>
    </>}
    {sceneId==='rain'?<spotLight position={[-1.40,1.86,-.65]} target={workSurface} angle={.52} penumbra={.57}
      color="#ffedce" intensity={10} castShadow shadow-mapSize={lowWoodlandQuality?[768,768]:[1536,1536]}
      shadow-camera-near={.40} shadow-camera-far={5} shadow-bias={-.00008} shadow-normalBias={.0004}/>:
      <WorkbenchCanopy sceneId={sceneId} target={workSurface}/>}
    <directionalLight ref={sun} shadow-autoUpdate={!lowWoodlandQuality} shadow-needsUpdate position={[...forestSun[sceneId]]} color={look.color} intensity={look.key} castShadow
      shadow-mapSize={lowWoodlandQuality?[1024,1024]:[4096,4096]} shadow-camera-left={-6} shadow-camera-right={6}
      shadow-camera-top={6} shadow-camera-bottom={-6} shadow-camera-near={.5} shadow-camera-far={42}
      shadow-radius={sceneId==='rain'?4:2.5} shadow-bias={-.00008} shadow-normalBias={.0022}/>
  </>
}
