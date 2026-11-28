import {afterEach,expect,it,vi} from 'vitest'
import {readRenderBudget,saveRenderBudget} from '../../src/services/render-budget'
const row={width:1536,height:1024,deviceRatio:1,dpr:.62,gpuMs:47}
afterEach(()=>vi.unstubAllGlobals())
function storage(){const entries=new Map();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>entries.get(key),setItem:(key:string,value:string)=>entries.set(key,value)});return entries}
it('reuses only a recent measurement for the same scene and viewport',()=>{
 storage();saveRenderBudget('creek',row,1000)
 expect(readRenderBudget('creek',1536,1024,1,1,2000)?.dpr).toBe(.62)
 expect(readRenderBudget('bamboo',1536,1024,1,1,2000)).toBeUndefined()
 expect(readRenderBudget('creek',1280,800,1,1,2000)).toBeUndefined()
 expect(readRenderBudget('creek',1536,1024,2,1,2000)).toBeUndefined()
})
it('remeasures expired, future-dated or excessive quality settings',()=>{
 storage();saveRenderBudget('creek',row,1000)
 expect(readRenderBudget('creek',1536,1024,1,1,301000)).toBeUndefined()
 expect(readRenderBudget('creek',1536,1024,1,1,999)).toBeUndefined()
 expect(readRenderBudget('creek',1536,1024,1,.6,2000)).toBeUndefined()
})
it('ignores malformed or unavailable storage',()=>{
 const entries=storage();entries.set('flower-render-budget-v1:creek','bad json')
 expect(readRenderBudget('creek',1536,1024,1,1)).toBeUndefined()
 vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}})
 expect(readRenderBudget('creek',1536,1024,1,1)).toBeUndefined();expect(()=>saveRenderBudget('creek',row)).not.toThrow()
})
