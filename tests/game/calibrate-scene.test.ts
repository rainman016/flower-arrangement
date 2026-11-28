import {afterEach,describe,expect,it,vi} from 'vitest'
import {PerspectiveCamera,Scene,type WebGLRenderer} from 'three'
import {calibrateScene} from '../../src/scene/core/calibrate-scene'

afterEach(()=>vi.unstubAllGlobals())
describe('scene calibration',()=>{
 it.each([false,true])('restores the seated camera after side views, including failure=%s',async fail=>{
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1})
  const camera=new PerspectiveCamera();camera.rotation.set(-.2,.3,0);camera.updateMatrixWorld(true)
  const before=camera.quaternion.clone(),matrix=camera.matrixWorld.clone(),views:number[][]=[]
  let count=0
  const context={getExtension:()=>({TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2}),
   createQuery:()=>({}),beginQuery:()=>{},endQuery:()=>{},deleteQuery:vi.fn(),
   getParameter:()=>false,QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,
   getQueryParameter:(_q:unknown,p:number)=>p===3?true:20e6}
  const renderer={getContext:()=>context,render:()=>{
   views.push(camera.quaternion.toArray())
   if(fail&&++count===3)throw new Error('draw failed')
  }} as unknown as WebGLRenderer
  const scene=new Scene();scene.userData.runtimeTimings={}
  const pending=calibrateScene(renderer,scene,camera,()=>false)
  if(fail)await expect(pending).rejects.toThrow('draw failed')
  else expect(await pending).toBe(20)
  expect(views.some(v=>Math.abs(camera.quaternion.clone().fromArray(v).dot(before))<.9)).toBe(true)
  expect(camera.quaternion.equals(before)).toBe(true)
  expect(camera.matrixWorld.equals(matrix)).toBe(true)
  expect(context.deleteQuery).toHaveBeenCalled()
 })
})
