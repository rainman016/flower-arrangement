import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Object3D, Quaternion, Vector3 } from 'three'
import { useGameStore } from '../../state/game-store'

// Shared motion timing. Tool demonstrations have distinct approach/action/return beats.
export const MOTION={move:250,insert:500,approach:250,close:140,fall:500,pour:1200} as const
function bezier(t:number,x1:number,y1:number,x2:number,y2:number){
  if(t<=0)return 0;if(t>=1)return 1
  const at=(u:number,a:number,b:number)=>3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u
  let low=0,high=1
  for(let i=0;i<16;i++){const u=(low+high)/2;if(at(u,x1,x2)<t)low=u;else high=u}
  return at((low+high)/2,y1,y2)
}
export const easeMove=(t:number)=>bezier(t,.77,0,.175,1)
export const easeOut=(t:number)=>bezier(t,.23,1,.32,1)
type Job={last:number;elapsed:number;ms:number;step:(t:number)=>void;finish:()=>void;label:string}
export class MotionDirector {
  private jobs=new Map<object,Job>();private listeners=new Set<()=>void>();private busy=false
  keyboard=false
  private invalidate:()=>void;private canvas:HTMLCanvasElement
  constructor(invalidate:()=>void,canvas:HTMLCanvasElement){this.invalidate=invalidate;this.canvas=canvas}
  allowed=()=>!this.keyboard&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.visibilityState!=='hidden'
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  snapshot=()=>this.busy
  private announce(){
    const busy=this.jobs.size>0;this.canvas.dataset.motionActive=String(busy)
    this.canvas.dataset.motionEffects=[...new Set([...this.jobs.values()].map(j=>j.label))].join(',')
    if(!busy)delete this.canvas.dataset.motionPhase
    if(busy!==this.busy){this.busy=busy;this.listeners.forEach(fn=>fn())}
  }
  phase(value:string){this.canvas.dataset.motionPhase=value}
  cancel(key:object){this.jobs.delete(key);this.announce()}
  run(key:object,ms:number,step:(t:number)=>void,finish:()=>void,label='move'){
    this.jobs.delete(key)
    if(!this.allowed()){finish();this.announce();this.invalidate();return()=>{}}
    const job={last:performance.now(),elapsed:0,ms,step,finish,label};this.jobs.set(key,job);step(0);this.announce();this.invalidate()
    return()=>{if(this.jobs.get(key)===job)this.cancel(key)}
  }
  tick(){
    const now=performance.now()
    for(const [key,job] of [...this.jobs]){
      if(this.jobs.get(key)!==job)continue
      // Bound visual steps: a slow first draw must not skip the entire snip or water stream.
      job.elapsed+=Math.min(100,Math.max(0,now-job.last));job.last=now
      const t=Math.min(1,job.elapsed/job.ms);job.step(t)
      if(t>=1){this.jobs.delete(key);job.finish()}
    }
    this.announce();if(this.jobs.size)this.invalidate()
  }
  settle=()=>{const jobs=[...this.jobs.values()];this.jobs.clear();jobs.forEach(j=>j.finish());this.announce();this.invalidate()}
  pose(object:Object3D,position:Vector3,rotation:Quaternion,via?:Vector3,instant=false){
    const from=object.position.clone(),turn=object.quaternion.clone(),finish=()=>{object.position.copy(position);object.quaternion.copy(rotation)}
    const insertion=Boolean(via);if(via&&from.distanceToSquared(via)<.0001)via=undefined
    if(instant||from.distanceToSquared(position)<1e-10&&turn.angleTo(rotation)<1e-5){this.cancel(object);finish();this.invalidate();return}
    this.run(object,via?MOTION.insert:MOTION.move,t=>{
      if(via){const first=t<.6;object.position.lerpVectors(first?from:via,first?via:position,easeMove(first?t/.6:(t-.6)/.4))}
      else object.position.lerpVectors(from,position,easeMove(t))
      object.quaternion.slerpQuaternions(turn,rotation,easeMove(via?Math.min(1,t/.6):t))
    },finish,insertion?'insert':'move')
  }
}
const Context=createContext<MotionDirector|null>(null)
export function useSceneMotion(){const value=useContext(Context);if(!value)throw Error('Missing scene motion provider');return value}
export function useMotionBusy(){const motion=useSceneMotion();return useSyncExternalStore(motion.subscribe,motion.snapshot,motion.snapshot)}
export function SceneMotion({children}:{children:ReactNode}){
  const {invalidate,gl}=useThree(),motion=useMemo(()=>new MotionDirector(invalidate,gl.domElement),[invalidate,gl])
  useFrame(()=>motion.tick())
  useEffect(()=>{
    const settle=()=>{motion.settle();useGameStore.getState().settleMotion()}
    const key=(e:KeyboardEvent)=>{motion.keyboard=true;if(e.key==='Escape')settle()}
    const pointer=()=>{motion.keyboard=false}
    const hidden=()=>{if(document.visibilityState==='hidden')settle()}
    const preference=matchMedia('(prefers-reduced-motion: reduce)');preference.addEventListener('change',settle)
    window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',pointer,true);window.addEventListener('blur',settle);window.addEventListener('pointercancel',settle)
    document.addEventListener('visibilitychange',hidden)
    const unsubscribe=useGameStore.subscribe((s,previous)=>{if(s.motionEpoch!==previous.motionEpoch)motion.settle()})
    gl.domElement.dataset.motionActive='false'
    return()=>{unsubscribe();preference.removeEventListener('change',settle);window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('blur',settle);window.removeEventListener('pointercancel',settle);document.removeEventListener('visibilitychange',hidden);motion.settle()}
  },[motion,gl])
  return <Context.Provider value={motion}>{children}</Context.Provider>
}
export function useObjectPose(ref:RefObject<Object3D|null>,position:Vector3,quaternion:Quaternion,token:unknown,via?:Vector3){
  const motion=useSceneMotion(),epoch=useGameStore(s=>s.motionEpoch),previous=useRef<number|undefined>(undefined)
  useLayoutEffect(()=>{
    const obj=ref.current;if(!obj)return
    const instant=previous.current===undefined||previous.current!==epoch;previous.current=epoch
    if(!useGameStore.getState().dragging||instant)motion.pose(obj,position,quaternion,via,instant)
    return()=>motion.cancel(obj)
  },[motion,position.x,position.y,position.z,quaternion.x,quaternion.y,quaternion.z,quaternion.w,token,epoch])
}
