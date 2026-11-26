import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {useCoreStore} from '../../src/state/core-store'
import {commit} from '../../src/game/history'
import {canArrange,decodeRitual,encodeRitual,RITUAL_KEY} from '../../src/services/ritual-progress'

const state=()=>useCoreStore.getState()
let saved:Map<string,string>

beforeEach(()=>{
  saved=new Map()
  vi.stubGlobal('localStorage',{
    getItem:(key:string)=>saved.get(key)??null,
    setItem:(key:string,value:string)=>saved.set(key,value),
  })
  useCoreStore.setState(useCoreStore.getInitialState(),true)
  state().newJourney('bamboo')
  state().updateRitual({stage:'arrange',arranging:true})
  expect(state().dispatch({type:'insert',id:'f-1'})).toBe(true)
  state().updateRitual({stage:'tidy',line:0})
})
afterEach(()=>vi.unstubAllGlobals())

describe('收尾后重新整理作品',()=>{
  it.each([0,1])('整理进度为 %i 时，取出唯一一枝后仍可重新插回',line=>{
    state().updateRitual({line})
    const original=state().history.present.flowers.find(f=>f.id==='f-1')!
    state().focusVase(true)
    expect(state().ritual).toMatchObject({stage:'arrange',arranging:true,line:0})
    state().select(original.id)
    expect(state().dispatch({type:'to-table',id:original.id})).toBe(true)
    expect(state().vaseFocus).toBe(false)
    expect(canArrange(state().ritual)).toBe(true)
    state().select(original.id)
    expect(state().heldId).toBe(original.id)
    expect(state().dispatch({type:'insert',id:original.id,pose:original.pose})).toBe(true)
    expect(state().history.present.flowers.find(f=>f.id===original.id)).toMatchObject({
      location:'vase',kind:original.kind,removed:original.removed,pose:original.pose,
    })
    state().updateRitual({stage:'tidy',line:0})
    expect(canArrange(state().ritual)).toBe(false)
  })

  it('取出后刷新恢复，仍可选择并插回花枝',()=>{
    state().focusVase(true)
    expect(state().dispatch({type:'to-table',id:'f-1'})).toBe(true)
    const persisted=decodeRitual(saved.get(RITUAL_KEY)!)!
    expect(persisted.ritual).toMatchObject({stage:'arrange',arranging:true})
    useCoreStore.setState(useCoreStore.getInitialState(),true)
    state().openJourney()
    state().select('f-1')
    expect(state().heldId).toBe('f-1')
    expect(state().dispatch({type:'insert',id:'f-1'})).toBe(true)
  })

  it('取出后撤销、重做和关闭近景均不丢失重新插入能力',()=>{
    state().focusVase(true)
    state().select('f-1')
    expect(state().dispatch({type:'to-table',id:'f-1'})).toBe(true)
    state().undo()
    expect(state().history.present.flowers[0].location).toBe('vase')
    state().redo()
    expect(state().history.present.flowers[0].location).toBe('table')
    state().focusVase(false)
    expect(canArrange(state().ritual)).toBe(true)
    state().select('f-1')
    expect(state().dispatch({type:'insert',id:'f-1'})).toBe(true)
  })

  it('旧存档已在收尾取空花瓶，仍可通过继续调整恢复',()=>{
    const stuck=commit(state().history,{type:'to-table',id:'f-1'}).history
    saved.set(RITUAL_KEY,encodeRitual(stuck,state().ritual!))
    useCoreStore.setState(useCoreStore.getInitialState(),true)
    state().openJourney()
    expect(state().ritual?.stage).toBe('tidy')
    expect(state().history.present.flowers.some(f=>f.location==='vase')).toBe(false)
    state().updateRitual({stage:'arrange',arranging:true,line:0})
    state().select('f-1')
    expect(state().heldId).toBe('f-1')
    expect(state().dispatch({type:'insert',id:'f-1'})).toBe(true)
  })

  it.each([false,true])('收尾状态不能绕过重新整理直接取花（残留近景 %s）',vaseFocus=>{
    useCoreStore.setState({vaseFocus})
    const before=state().history
    expect(state().dispatch({type:'to-table',id:'f-1'})).toBe(false)
    expect(state().dispatch({type:'place-flower',id:'f-1',position:[-.20,.78,.12]})).toBe(false)
    expect(state().history).toBe(before)
  })

  it.each(['bless','done'] as const)('%s 阶段不因近景入口重新开放插花',stage=>{
    state().updateRitual({stage,line:0})
    state().focusVase(true)
    expect(state().vaseFocus).toBe(false)
    expect(state().ritual?.stage).toBe(stage)
    expect(state().dispatch({type:'to-table',id:'f-1'})).toBe(false)
  })
})
