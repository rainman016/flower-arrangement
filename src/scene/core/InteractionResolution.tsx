import {ResolutionChange} from './ResolutionChange'
import { useContext, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { lowWoodlandQuality, startingPixelRatio } from '../render-quality'
import type { CoreWorld } from './CoreCanvas'

/** Adjust only during real input. Idle scenery intentionally renders at a lower rate. */
export function InteractionResolution({world}:{world:CoreWorld}){
  const {size,setDpr,gl,scene,invalidate}=useThree(),notifyResolution=useContext(ResolutionChange)
  const budget=useRef({lastInput:0,lastBusy:0,pressed:false,ceiling:1,slow:0,overBudget:0,fast:0,cooldown:0,calibration:undefined as object|undefined})
  useEffect(()=>{
    const state=budget.current
    state.ceiling=Math.min(startingPixelRatio(size.width,size.height,window.devicePixelRatio),scene.userData.runtimeCalibration?Math.sqrt(scene.userData.runtimeCalibration.pixels/(size.width*size.height)):Infinity)
    state.slow=0;state.overBudget=0;state.fast=0;state.cooldown=performance.now()+1000
    // Warmup owns the first canvas size, including a recent calibrated budget.
    if(!lowWoodlandQuality||scene.userData.runtimeCalibration){setDpr(state.ceiling);notifyResolution(state.ceiling)}
    if(!lowWoodlandQuality)return
    const record=(event:PointerEvent)=>{
      if(event.target!==gl.domElement)return
      state.lastInput=performance.now();state.pressed=event.buttons!==0
    }
    window.addEventListener('pointermove',record,true)
    return ()=>window.removeEventListener('pointermove',record,true)
  },[gl,size.width,size.height,setDpr])
  useFrame((_,delta)=>{
    const b=budget.current,now=performance.now()
    if(!lowWoodlandQuality||document.hidden)return
    const calibration=scene.userData.runtimeCalibration
    if(calibration&&b.calibration!==calibration){
      b.calibration=calibration;b.ceiling=Math.min(b.ceiling,Math.sqrt(calibration.pixels/(size.width*size.height)));b.cooldown=now+800
    }
    const moving=world.stroke||world.pouring||(now-b.lastInput<Math.max(130,delta*1200)&&(b.pressed||world.active||world.marker?.visible))
    if(!moving){
      b.fast=0;b.slow=0;b.overBudget=0

      return
    }
    // Keep the next animation frame pending throughout a drag, independent of
    // operating-system pointer event coalescing and the 30 Hz idle scenery clock.
    invalidate()
    b.lastBusy=now
    if(now<b.cooldown||delta<=0||delta>.95)return
    b.slow=delta>.0295?b.slow+Math.min(.25,delta):Math.max(0,b.slow-delta*.45)
    b.fast=delta<.022?b.fast+delta:0
    const current=gl.getPixelRatio()
    // Respond to a persistent tail of slow frames, even when cached frames are
    // fast enough to keep the average low. One isolated pause cannot trigger it.
    b.overBudget=delta>.0333?b.overBudget+1:Math.max(0,b.overBudget-.04)
    const floor=Math.min(b.ceiling,.53)
    const next=b.slow>.9||b.overBudget>4?Math.max(floor,current-.06):b.fast>8?Math.min(b.ceiling,current+.08):current
    if(Math.abs(next-current)<.001)return
    b.slow=0;b.overBudget=0;b.fast=0;b.cooldown=now+1700;setDpr(next);notifyResolution(next)
  })
  return null
}
