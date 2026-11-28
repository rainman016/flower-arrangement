import {afterEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import * as Sky from '../../src/scene/WoodlandSky'
import {loadGeneratedSky} from '../../src/services/generated-sky'
const entry='https://game.test/assets/index-build-a.js',key=entry+'?generated-sky=creek'
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function storage(){
 const entries=new Map<string,Response>()
 const cache={match:vi.fn(async(url:string)=>entries.get(url)?.clone()),put:vi.fn(async(url:string,response:Response)=>{entries.set(url,response)}),keys:async()=>[...entries.keys()].map(url=>new Request(url)),delete:vi.fn(async(request:Request)=>entries.delete(request.url))}
 vi.stubGlobal('document',{querySelector:()=>({src:entry})});vi.stubGlobal('caches',{open:async()=>cache})
 return {entries,cache}
}
const checksum=(texture:ReturnType<typeof Sky.woodlandSky>)=>createHash('sha256').update(new Uint8Array(texture.image.data.buffer)).digest('hex')
describe('generated sky cache',()=>{
 it('reuses exactly the generated half-float pixels',async()=>{
  const {cache}=storage(),generate=vi.spyOn(Sky,'woodlandSky'),first=await loadGeneratedSky('creek')
  await vi.waitFor(()=>expect(cache.put).toHaveBeenCalledTimes(1))
  const next=await loadGeneratedSky('creek');expect(generate).toHaveBeenCalledTimes(1);expect(checksum(next)).toBe(checksum(first));expect(next.mapping).toBe(first.mapping);expect(next.colorSpace).toBe(first.colorSpace)
 })
 it('recomputes damaged data and removes only older builds of this scene',async()=>{
  const {entries,cache}=storage(),old='https://game.test/assets/index-old.js?generated-sky=creek',other='https://game.test/assets/index-old.js?generated-sky=bamboo'
  entries.set(key,new Response(new Uint8Array(3)));entries.set(old,new Response('old'));entries.set(other,new Response('other scene'))
  const texture=await loadGeneratedSky('creek');expect(texture.image.width).toBe(768)
  await vi.waitFor(()=>expect(cache.delete).toHaveBeenCalledTimes(1));expect(entries.has(old)).toBe(false);expect(entries.has(other)).toBe(true)
 })
 it('still computes a sky when storage is blocked',async()=>{
  storage();vi.stubGlobal('caches',{open:async()=>{throw Error('blocked')}})
  const texture=await loadGeneratedSky('bamboo');expect(texture.image.width).toBe(768);expect(texture.image.height).toBe(384)
 })
})
