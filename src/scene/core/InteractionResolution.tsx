import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { lowWoodlandQuality, startingPixelRatio } from '../render-quality'
import type { CoreWorld } from './CoreCanvas'

/** Adjust only during real input. Idle scenery intentionally renders at a lower rate. */
export function InteractionResolution({world}:{world:CoreWorld}){
  const {size,setDpr,gl}=useThree()
  const budget=useRef({lastInput:0,lastBusy:0,pressed:false,ceiling:1,slow:0,overBudget:0,fast:0,cooldown:0})
  useEffect(()=>{
    const state=budget.current
    state.ceiling=startingPixelRatio(size.width,size.height,window.devicePixelRatio)
    state.slow=0;state.overBudget=0;state.fast=0;state.cooldown=performance.now()+1000
    setDpr(state.ceiling)
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
    const moving=world.stroke||world.pouring||(now-b.lastInput<Math.max(130,delta*1200)&&(b.pressed||world.active||world.marker?.visible))
    if(!moving){
      b.fast=0;b.slow=0;b.overBudget=0
      if(now-b.lastBusy>1800&&now>=b.cooldown&&gl.getPixelRatio()<b.ceiling-.001){
        setDpr(b.ceiling);b.cooldown=now+1000
      }
      return
    }
    b.lastBusy=now
    if(now<b.cooldown||delta<=0||delta>.95)return
    b.slow=delta>.024?b.slow+Math.min(.25,delta):Math.max(0,b.slow-delta*.45)
    b.fast=delta<.019?b.fast+delta:0
    const current=gl.getPixelRatio()
    b.overBudget=current<=.66&&delta>.046?b.overBudget+Math.min(.25,delta):Math.max(0,b.overBudget-delta*.45)
    const floor=Math.min(b.ceiling,b.overBudget>.65?.53:.65,current)
    const next=b.slow>.9?Math.max(floor,current-.12):b.fast>4?Math.min(b.ceiling,current+.08):current
    if(Math.abs(next-current)<.001)return
    b.slow=0;b.fast=0;b.cooldown=now+1700;setDpr(next)
  })
  return null
}
