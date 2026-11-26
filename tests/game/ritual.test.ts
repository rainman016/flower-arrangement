import {describe,it,expect} from 'vitest'
import {commit,undo} from '../../src/game/history'
import {freshRitual,ritualHistory,encodeRitual,decodeRitual} from '../../src/services/ritual-progress'
describe('完整花席',()=>{
  it('旧雨景作品在溪畔继续，保留当前步骤、剪口与撤销历史',()=>{
    const cut=commit(ritualHistory(),{type:'cut-part',id:'f-1',part:'leaf-0'},{tool:'scissors'})
    expect(cut.changed).toBe(true)
    const ritual={...freshRitual('rain'),stage:'trim' as const,wish:'愿安好'}
    expect(decodeRitual(encodeRitual(cut.history,ritual))).toEqual({history:cut.history,ritual:{...ritual,sceneId:'creek'}})
  })
  it('初始盒内左瓶中杯右剪，旧席和撤销历史能迁移',()=>{
    const old=ritualHistory()
    const legacy={...old.present,vase:{x:0,z:0,yaw:0},tools:{cup:[-.17,.774,-.045] as [number,number,number],scissors:[.18,.783,.025] as [number,number,number],vaseY:.774}}
    const saved=decodeRitual(encodeRitual({present:legacy,past:[{state:legacy,label:'备席'}],future:[]},freshRitual()))
    expect(saved?.history.present).toEqual(old.present)
    expect(saved?.history.past[0].state).toEqual(old.present)
    const {tools,vase}=old.present
    expect(vase.x).toBeLessThan(tools!.cup[0]);expect(tools!.cup[0]).toBeLessThan(tools!.scissors[0])
  })
  it('旋转后的杯和花材能保存、恢复和撤销',()=>{
    const h=ritualHistory(),rotation:[number,number,number,number]=[0,Math.SQRT1_2,0,Math.SQRT1_2]
    const cup=commit(h,{type:'set-prop',prop:'cup',position:[0,.759,.18],rotation}).history
    const stem=commit(cup,{type:'place-flower',id:'f-1',position:[-.21,.78,.12],rotation}).history
    expect(decodeRitual(encodeRitual(stem,freshRitual()))?.history).toEqual(stem)
    expect(undo(stem).present).toEqual(cup.present)
    expect(commit(h,{type:'set-prop',prop:'cup',position:[0,.759,.18],rotation:[1,2,3,4]}).changed).toBe(false)
  })
  it('整张花单一次提交，杯外花、旧枝和再次打开的作品保持各自身份',()=>{
    let history=ritualHistory()
    history=commit(history,{type:'place-flower',id:'f-1',position:[-.2,.78,.12]}).history
    const picked=commit(history,{type:'choose-cup-flowers',kinds:['grass','daisy','daisy']}).history
    const flowers=picked.present.flowers
    expect(flowers.find(f=>f.id==='f-1')).toEqual(history.present.flowers[0])
    expect(flowers.find(f=>f.kind==='grass')?.id).toBe('f-3')
    expect(flowers.filter(f=>f.kind==='daisy').map(f=>f.id)).toEqual(['f-4','f-5'])
    expect(new Set(flowers.map(f=>f.slot)).size).toBe(4)
    expect(decodeRitual(encodeRitual(picked,freshRitual()))?.history).toEqual(picked)
    const cut=commit(picked,{type:'cut-part',id:'f-4',part:'branch-0'},{tool:'scissors'})
    expect(cut.changed).toBe(true)
    expect(cut.history.present.flowers.find(f=>f.id==='f-5')?.removed).toEqual([])
    const arranged=commit(cut.history,{type:'insert',id:'f-4'})
    expect(arranged.changed).toBe(true)
    expect(decodeRitual(encodeRitual(arranged.history,freshRitual()))?.history.present).toEqual(arranged.history.present)
    expect(undo(picked).present).toEqual(history.present)
    expect(commit(picked,{type:'choose-cup-flowers',kinds:['daisy','grass','daisy']}).changed).toBe(false)
    expect(commit(history,{type:'choose-cup-flowers',kinds:Array(12).fill('daisy')}).changed).toBe(false)
    expect(commit(ritualHistory(),{type:'choose-cup-flowers',kinds:[]}).changed).toBe(false)
  })
  it('两次独立注水可过三分之二，守恒并逐次撤销',()=>{
    let h=ritualHistory()
    const pour=(ml:number)=>commit(h,{type:'pour',ml},{tool:'cup'})
    expect(pour(90).changed).toBe(false)
    h=commit(h,{type:'empty-cup'}).history
    h=pour(90).history
    h=pour(60).history
    expect([h.present.vaseMl,h.present.cupMl]).toEqual([130,50])
    expect(undo(h).present.vaseMl).toBe(90)
  })
  it('任意摆放、收拾、撤销与场景祝愿同存',()=>{
    let h=ritualHistory()
    h=commit(h,{type:'set-prop',prop:'vase',position:[.16,.759,.275]}).history
    h=commit(h,{type:'insert',id:'f-1'}).history
    const prev=h.present
    h=commit(h,{type:'tidy'}).history
    expect(undo(h).present).toEqual(prev)
    expect(h.present.flowers[0].pose).toEqual(prev.flowers[0].pose)
    const ritual={...freshRitual('creek'),stage:'done' as const,wish:'愿平安'}
    expect(decodeRitual(encodeRitual(h,ritual))).toEqual({history:h,ritual})
    expect(commit(h,{type:'set-prop',prop:'cup',position:[.37,.759,.22]}).changed).toBe(true)
  })
})


it('preserves independent flower dimensions, cuts and historical snapshots',()=>{
  const original=ritualHistory()
  const kept=original.present.flowers.map(f=>({id:f.id,kind:f.kind,length:f.length,headScale:1}))
  const taller={kind:'daisy' as const,length:.42,headScale:.7}
  const smaller={kind:'daisy' as const,length:.14,headScale:1.4}
  const chosen=commit(original,{type:'set-materials',destination:'cup',choices:[...kept,taller,smaller]}).history
  expect(chosen.present.flowers.slice(0,3)).toEqual(original.present.flowers)
  const [large,small]=chosen.present.flowers.slice(3)
  expect(large.id).not.toBe(small.id)
  expect(decodeRitual(encodeRitual(chosen,freshRitual()))?.history).toEqual(chosen)
  const revised=commit(chosen,{type:'set-materials',destination:'cup',choices:[...kept,{...large,headScale:1.25},{...small}]}).history
  expect(revised.present.flowers[3].id).toBe(large.id)
  expect(revised.present.flowers[4]).toEqual(small)
  expect(revised.past.at(-1)?.state.flowers[3].headScale).toBe(.7)
  const table=commit(revised,{type:'empty-cup'}).history
  const shortened=commit(table,{type:'cut-length',id:large.id,length:.27},{tool:'scissors'}).history
  expect(shortened.present.flowers[3]).toMatchObject({length:.27,stockLength:large.stockLength,headScale:1.25})
  const extra=commit(shortened,{type:'set-materials',destination:'table',choices:[smaller]}).history
  expect(extra.present.flowers.slice(0,-1)).toEqual(shortened.present.flowers)
  expect(extra.present.flowers.at(-1)?.location).toBe('table')
  expect(commit(extra,{type:'set-materials',destination:'table',choices:[{...taller,length:NaN}]}).changed).toBe(false)
  expect(commit(extra,{type:'set-materials',destination:'table',choices:[{...smaller,id:large.id}]}).changed).toBe(false)
})

it('旋转花器后收好花席保留其方向、花枝姿态和撤销',()=>{
  const start=ritualHistory(),rotation:[number,number,number,number]=[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)]
  const turned=commit(start,{type:'set-prop',prop:'vase',position:[.1,.759,.20],rotation}).history
  const withFlower=commit(turned,{type:'insert',id:'f-1'}).history
  const sorted=commit(withFlower,{type:'tidy'}).history
  expect(sorted.present.tools?.rotations?.vase).toEqual(rotation)
  expect(sorted.present.flowers).toEqual(withFlower.present.flowers)
  expect(sorted.past.at(-1)?.state).toEqual(withFlower.present)
  expect(decodeRitual(encodeRitual(sorted,{...freshRitual(),stage:'bless'}))?.history.present).toEqual(sorted.present)
})
