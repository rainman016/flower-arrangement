import {describe,it,expect} from 'vitest'
import {commit,initialHistory,undo,redo,HISTORY_LIMIT} from '../../src/game/history'
import {initialArrangement,isArrangement,availablePose,poseProblem} from '../../src/game/rules'
import {reduceCommand} from '../../src/game/reducer'
import {decodeProgress,saveProgress,loadProgress,STORAGE_KEY,LEGACY_KEY} from '../../src/services/progress-storage'
import {ASSET_VERSION} from '../../src/content/catalog'
import type {Command,Session} from '../../src/game/types'
const scissors={tool:'scissors' as const},cup={tool:'cup' as const}
const session:Session={sceneId:'rain',chapter:'trim',wish:'愿安好'}
describe('五式作品规则',()=>{
 it('杯中有花时不能倒水，清空花草后水量守恒且不会溢出',()=>{
  const initial=initialArrangement()
  expect(reduceCommand(initial,{type:'pour',ml:130},cup).state).toBe(initial)
  let s=reduceCommand(initial,{type:'empty-cup'}).state
  expect(reduceCommand(s,{type:'pour',ml:130}).state).toBe(s)
  s=reduceCommand(s,{type:'pour',ml:500},cup).state
  expect([s.cupMl,s.vaseMl]).toEqual([50,130])
  expect(reduceCommand(s,{type:'pour',ml:10},cup).state).toBe(s)
  expect(isArrangement(s)).toBe(true)
 })
 it('满瓶后溢水独立计量，重倒恢复杯瓶且保留桌面',()=>{
  const empty=reduceCommand(initialArrangement(),{type:'empty-cup'}).state
  const full=reduceCommand(empty,{type:'pour',ml:130,spill:6},cup).state
  expect([full.cupMl,full.vaseMl,full.spillMl]).toEqual([44,130,6])
  expect(isArrangement(full)).toBe(true)
  const restored=reduceCommand(full,{type:'restore-water',cupMl:180,vaseMl:0,spillMl:0},cup).state
  expect([restored.cupMl,restored.vaseMl,restored.spillMl]).toEqual([180,0,0])
  expect(restored.flowers).toEqual(empty.flowers)
  expect(reduceCommand(empty,{type:'pour',ml:1,spill:5},cup).state).toBe(empty)
 })
 it('一笔注水同时撤销两容器水量',()=>{
  let h=commit(initialHistory(),{type:'empty-cup'}).history
  h=commit(h,{type:'pour',ml:130},cup).history
  expect([undo(h).present.cupMl,undo(h).present.vaseMl]).toEqual([180,0])
  expect(redo(undo(h)).present).toEqual(h.present)
 })
 it('修剪部件与碎屑完整撤销，其他实例不受影响',()=>{
  let h=commit(initialHistory(),{type:'empty-cup'}).history
  const other=h.present.flowers[1],before=h
  h=commit(h,{type:'cut-part',id:'f-1',part:'leaf-0'},scissors).history
  expect(h.present.flowers[0].removed).toEqual(['leaf-0'])
  expect(h.present.debris).toHaveLength(1)
  expect(h.present.flowers[1]).toBe(other)
  expect(commit(h,{type:'cut-part',id:'f-1',part:'leaf-0'},scissors).changed).toBe(false)
  expect(undo(h).present).toEqual(before.present)
  expect(redo(undo(h)).present).toEqual(h.present)
 })
 it('第二枝从鼠标所指的插点就近避开已有花茎，保留深度和朝向',()=>{
  const {present}=commit(initialHistory(),{type:'insert',id:'f-1'}).history
  const [first,second]=present.flowers
  const preferred={...first.pose,yaw:39,depth:.09}
  const fit=availablePose(present,second,preferred)!
  expect(poseProblem(present,second,fit)).toBeUndefined()
  expect(fit.depth).toBe(preferred.depth)
  expect(fit.yaw).toBe(preferred.yaw)
  expect(Math.hypot(fit.x-preferred.x,fit.z-preferred.z)).toBeLessThan(.008)
  expect([fit.x,fit.z]).not.toEqual([first.pose.x,first.pose.z])
  expect(availablePose(present,second,fit)).toEqual(fit)
 })
 it('已插花枝需要先取出，短枝仍能找到可用深度',()=>{
  let h=commit(initialHistory(),{type:'insert',id:'f-1'}).history
  expect(commit(h,{type:'cut-length',id:'f-1',length:.14},scissors).changed).toBe(false)
  h=commit(h,{type:'to-table',id:'f-1'}).history
  h=commit(h,{type:'cut-length',id:'f-1',length:.14},scissors).history
  const pose=availablePose(h.present,h.present.flowers[0])!
  expect(pose.depth).toBeCloseTo(.07)
  h=commit(h,{type:'insert',id:'f-1',pose}).history
  expect(h.present.flowers[0].location).toBe('vase')
  expect(isArrangement(h.present)).toBe(true)
 })
 it('允许原样插花和仅使用部分花材，拒绝瓶颈穿透与重叠',()=>{
  let h=commit(initialHistory(),{type:'insert',id:'f-1'}).history
  expect(h.present.flowers.filter(f=>f.location==='vase')).toHaveLength(1)
  expect(h.present.debris).toHaveLength(0)
  const f=h.present.flowers[0]
  expect(poseProblem(h.present,f,{...f.pose,tilt:12})).toBeDefined()
  expect(commit(h,{type:'insert',id:'f-2',position:{x:0,z:0}}).changed).toBe(false)
  h=commit(h,{type:'insert',id:'f-2'}).history
  expect(h.present.flowers.filter(f=>f.location==='vase')).toHaveLength(2)
  expect(isArrangement(h.present)).toBe(true)
 })
 it('移动整瓶保持每枝花局部姿态，整理可撤销',()=>{
  let h=commit(initialHistory(),{type:'insert',id:'f-1'}).history
  const pose=h.present.flowers[0].pose
  h=commit(h,{type:'move-vase',pose:{x:.03,yaw:90}}).history
  expect(h.present.flowers[0].pose).toEqual(pose)
  const before=h.present
  h=commit(h,{type:'tidy'}).history
  expect(h.present.vase.x).toBe(0)
  expect(undo(h).present).toEqual(before)
 })
 it('实例 ID 不复用；历史有界，撤销后新操作会清除重做',()=>{
  let h=initialHistory()
  h=commit(h,{type:'remove',id:'f-1'}).history
  h=commit(h,{type:'add',kind:'yellow'}).history
  expect(h.present.flowers.at(-1)?.id).toBe('f-4')
  for(let i=0;i<50;i++)h=commit(h,{type:'rotate',id:'f-4',degrees:15}).history
  expect(h.past).toHaveLength(HISTORY_LIMIT)
  h=undo(h);expect(h.future).toHaveLength(1)
  h=commit(h,{type:'rotate',id:'f-4',degrees:-15}).history
  expect(h.future).toHaveLength(0)
 })
 it('非法长度、数值和花材不能污染作品',()=>{
  const s=initialArrangement()
  for(const command of [{type:'cut-length',id:'f-1',length:0},{type:'cut-length',id:'f-1',length:NaN},{type:'add',kind:'__proto__'},{type:'adjust',id:'f-1',pose:{x:Infinity}}] as Command[]){
   expect(reduceCommand(s,command,scissors).state).toBe(s)
  }
  for(const bad of [{...s,vaseMl:20},{...s,nextId:2},{...s,flowers:[{...s.flowers[0],kind:'__proto__'}]},{...s,flowers:[...s.flowers,s.flowers[0]]}])expect(isArrangement(bad)).toBe(false)
 })
})
describe('存档与恢复',()=>{
 it('恢复同一场景、祝愿、剪切状态和撤销记录，旧存档不改写',()=>{
  const map=new Map([[LEGACY_KEY,'old-work']]),storage={getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v)}}
  let h=commit(initialHistory(),{type:'cut-part',id:'f-1',part:'leaf-1'},scissors).history
  h=commit(h,{type:'cut-length',id:'f-1',length:.22},scissors).history
  expect(saveProgress(storage,h,session)).toBeUndefined()
  const restored=loadProgress(storage)
  expect(restored.history).toEqual(h);expect(restored.session).toEqual({...session,sceneId:'creek'})
  expect(undo(restored.history!).present.flowers[0].length).toBe(.29)
  expect(map.get(LEGACY_KEY)).toBe('old-work')
 })
 it('损坏、未知版本以及非法历史保留原文，不伪造新进度',()=>{
  const cases=['{broken',JSON.stringify({schemaVersion:99}),JSON.stringify({schemaVersion:2,assetVersion:ASSET_VERSION,session,history:{...initialHistory(),past:[{state:initialArrangement(),label:42}]}})]
  for(const raw of cases){const result=decodeProgress(raw);expect(result.raw).toBe(raw);expect(result.history).toBeUndefined();expect(result.problem).toBeTruthy()}
 })
 it('存储拒绝时给出错误，内存作品仍完整',()=>{
  const h=initialHistory(),storage={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('quota')}}
  expect(loadProgress(storage).problem).toBeTruthy()
  expect(saveProgress(storage,h,session)).toBeTruthy()
  expect(h.present.flowers).toHaveLength(3);expect(STORAGE_KEY).not.toBe(LEGACY_KEY)
 })
})

