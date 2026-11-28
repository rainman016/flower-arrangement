import {afterEach,describe,expect,it,vi} from 'vitest'
import {loadCachedAsset,decodeCachedAsset} from '../../src/services/cached-asset'
const nativeFetch=globalThis.fetch,url='https://game.test/assets/versioned.glb'
afterEach(()=>vi.unstubAllGlobals())
function storage(){
 const entries=new Map<string,Response>()
 const cache={match:vi.fn(async(key:string)=>entries.get(key)?.clone()),put:vi.fn(async(key:string,value:Response)=>{entries.set(key,value)}),delete:vi.fn(async(key:string)=>entries.delete(key))}
 vi.stubGlobal('caches',{open:async()=>cache})
 return {cache,entries}
}
const decode=async(url:string)=>{const text=await(await nativeFetch(url)).text();if(text==='broken')throw Error('bad data');return text}
describe('persistent immutable assets',()=>{
 it('decodes a single network body without cloning its stream or fetching a blob URL',async()=>{
  storage();const response=new Response('pixels'),clone=vi.spyOn(response,'clone').mockImplementation(()=>{throw Error('unconsumed stream')})
  const fetch=vi.fn(async()=>response);vi.stubGlobal('fetch',fetch)
  expect(await decodeCachedAsset(url,blob=>blob.text())).toBe('pixels')
  expect(clone).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1)
  expect(await decodeCachedAsset(url,blob=>blob.text())).toBe('pixels');expect(fetch).toHaveBeenCalledTimes(1)
 })
 it('reuses a saved asset without another network download',async()=>{
  storage();const fetch=vi.fn(async()=>new Response('model'));vi.stubGlobal('fetch',fetch)
  expect(await loadCachedAsset(url,decode)).toBe('model');expect(await loadCachedAsset(url,decode)).toBe('model');expect(fetch).toHaveBeenCalledTimes(1)
 })
 it('evicts a corrupt cached file and retries the network once',async()=>{
  const {entries,cache}=storage();entries.set(url,new Response('broken'))
  const fetch=vi.fn(async()=>new Response('fixed'));vi.stubGlobal('fetch',fetch)
  expect(await loadCachedAsset(url,decode)).toBe('fixed');expect(cache.delete).toHaveBeenCalledWith(url);expect(fetch).toHaveBeenCalledTimes(1)
 })
 it('uses the normal loader when persistent storage is unavailable',async()=>{
  vi.stubGlobal('caches',{open:async()=>{throw Error('blocked')}});const load=vi.fn(async()=>42)
  expect(await loadCachedAsset(url,load)).toBe(42);expect(load).toHaveBeenCalledWith(url)
 })
 it('does not retain missing or undecodable network files',async()=>{
  const {cache}=storage();vi.stubGlobal('fetch',async()=>new Response('broken'))
  await expect(loadCachedAsset(url,decode)).rejects.toThrow('bad data');expect(cache.put).not.toHaveBeenCalled()
  vi.stubGlobal('fetch',async()=>new Response('',{status:404}));await expect(loadCachedAsset(url,decode)).rejects.toThrow('游戏素材读取失败')
 })
 it('keeps playing if cache storage fills up',async()=>{
  const {cache}=storage();cache.put.mockRejectedValue(new Error('quota'));vi.stubGlobal('fetch',async()=>new Response('model'))
  expect(await loadCachedAsset(url,decode)).toBe('model')
 })
})
