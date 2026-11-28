import {installInstanceVisibility} from './instance-visibility'
import {runtimeMark} from '../services/runtime-timing'
import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Mesh} from 'three'
import type {PreparedNature as Prepared} from '../services/prepared-nature'
import {streamSurface} from './StreamSurface'
import {terrainSampler} from './terrain-height'
import {creekBankHeight} from './CreekBank'
import {canopyLight} from './CanopyLight'

export default function PreparedNature({prepared}:{prepared:Prepared}){
  const {camera,gl,invalidate}=useThree(),active=useRef(false)
  const scene=useMemo(()=>{
    runtimeMark('nature-assemble-start')
    const root=prepared.root.clone(true),clock=prepared.clock
    const originals:Mesh[]=[],copies:Mesh[]=[]
    prepared.root.traverse(o=>{if(o instanceof Mesh)originals.push(o)})
    root.traverse(o=>{if(o instanceof Mesh)copies.push(o)})
    originals.forEach((mesh,i)=>{
      copies[i].customDepthMaterial=mesh.customDepthMaterial
      copies[i].onBeforeRender=mesh.onBeforeRender;copies[i].onAfterRender=mesh.onAfterRender
      copies[i].onBeforeShadow=mesh.onBeforeShadow;copies[i].onAfterShadow=mesh.onAfterShadow
    })
    root.userData.natureClock=clock;clock.value=0
    const source=root.getObjectByName('prepared_water_source'),terrain=root.getObjectByName('terrain'),bank=root.getObjectByName('root_bank_soil')
    const openings=source?canopyLight():null
    const ground=terrain instanceof Mesh?terrainSampler(terrain):null
    const height=bank instanceof Mesh&&ground?creekBankHeight(bank,ground,source instanceof Mesh?source:undefined):ground
    const water=source instanceof Mesh&&openings?streamSurface(source,prepared.waterY??-.133,camera,clock,openings,height,undefined,root):null
    source?.removeFromParent();if(water){water.name='creek_surface';root.add(water)}
    installInstanceVisibility(root)
    runtimeMark('nature-assemble-ready')
    return {root,water,openings}
  },[prepared,camera])
  useEffect(()=>{
    const preference=matchMedia('(prefers-reduced-motion: reduce)');let timer:ReturnType<typeof setInterval>|undefined
    const sync=()=>{
      if(timer)clearInterval(timer)
      active.current=!preference.matches&&!document.hidden
      gl.domElement.dataset.environmentMotion=active.current?'running':preference.matches?'reduced':'paused'
      if(active.current)timer=setInterval(invalidate,1000/30)
      invalidate()
    }
    sync();preference.addEventListener('change',sync);document.addEventListener('visibilitychange',sync)
    return()=>{if(timer)clearInterval(timer);preference.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync)}
  },[gl,invalidate])
  useEffect(()=>()=>{scene.water?.dispose();scene.water?.geometry.dispose();scene.openings?.dispose()},[scene])
  useFrame((_,delta)=>{if(active.current)prepared.clock.value+=Math.min(.1,delta);scene.root.userData.renderedFrames++})
  return <primitive object={scene.root}/>
}
