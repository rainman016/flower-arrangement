import {describe,it,expect,vi,afterEach} from 'vitest'
import {gzipSync,gunzipSync} from 'node:zlib'
import {Mesh} from 'three'
import {loadPreparedNature} from '../../src/services/prepared-nature'
import {compressPreparedNature} from '../../scripts/pack-prepared-nature.mjs'

function fixture(){
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0,90,90,90]),indices=new Uint16Array([0,1,2])
 const payload={object:{uuid:'root',type:'Group',children:[{uuid:'mesh',type:'Mesh',name:'triangle',geometry:'g',material:'m',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]},
  geometries:[{uuid:'g',type:'BufferGeometry',data:{attributes:{position:{type:'Float32Array',itemSize:3,array:{$binary:0},normalized:false}},index:{type:'Uint16Array',array:{$binary:1}},groups:[]}}],
  materials:[{uuid:'m',type:'MeshStandardMaterial',color:0xffffff}],textures:[],images:[],prepared:{sceneId:'bamboo',patches:{},depths:{}}}
 const parts=[{offset:0,bytes:positions.byteLength,type:'Float32Array'},{offset:positions.byteLength,bytes:indices.byteLength,type:'Uint16Array'}]
 const json=Buffer.from(JSON.stringify({payload,parts})),aligned=Buffer.alloc(json.length+(4-json.length%4)%4,32);json.copy(aligned)
 const header=Buffer.alloc(8);header.write('PNS1');header.writeUInt32LE(aligned.length,4)
 return gzipSync(Buffer.concat([header,aligned,Buffer.from(positions.buffer),Buffer.from(indices.buffer)]))
}
const serve=(data:Uint8Array)=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)))
afterEach(()=>vi.unstubAllGlobals())
describe('prepared environment data',()=>{
 it('round trips actual indexed geometry through the production compressor and decoder',async()=>{
  serve(await compressPreparedNature(fixture()))
  const asset=await loadPreparedNature('/test.pns'),mesh=asset.root.getObjectByName('triangle') as Mesh
  expect(asset.sceneId).toBe('bamboo');expect(mesh.geometry.attributes.position.count).toBe(3)
  expect(Array.from(mesh.geometry.attributes.position.array)).toEqual([0,0,0,1,0,0,0,1,0])
  expect(Array.from(mesh.geometry.index!.array)).toEqual([0,1,2])
 })
 it('reuses a validated content-addressed response on return visits',async()=>{
  const entries=new Map<string,Response>()
  vi.stubGlobal('location',{href:'http://localhost/'})
  vi.stubGlobal('caches',{open:async()=>({match:async(url:string)=>entries.get(url)?.clone(),put:async(url:string,response:Response)=>{entries.set(url,response)}})})
  const fetcher=vi.fn(async()=>new Response(fixture()));vi.stubGlobal('fetch',fetcher)
  await loadPreparedNature('/scene-hash.pns');await loadPreparedNature('/scene-hash.pns')
  expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it('replaces a broken cached response with one successful network retry',async()=>{
  const entries=new Map<string,Response>([['/scene-hash.pns',new Response('broken')]])
  vi.stubGlobal('location',{href:'http://localhost/'})
  vi.stubGlobal('caches',{open:async()=>({match:async(url:string)=>entries.get(url)?.clone(),delete:async(url:string)=>entries.delete(url),put:async(url:string,response:Response)=>{entries.set(url,response)}})})
  const fetcher=vi.fn(async()=>new Response(fixture()));vi.stubGlobal('fetch',fetcher)
  expect((await loadPreparedNature('/scene-hash.pns')).sceneId).toBe('bamboo')
  await loadPreparedNature('/scene-hash.pns');expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it('rejects a truncated archive before constructing the scene',async()=>{
  const data=gunzipSync(fixture());serve(gzipSync(data.subarray(0,11)))
  await expect(loadPreparedNature('/bad.pns')).rejects.toThrow('环境资源不完整')
 })
 it('rejects a binary view extending outside the payload',async()=>{
  const data=gunzipSync(fixture());serve(gzipSync(data.subarray(0,data.length-2)))
  await expect(loadPreparedNature('/bad.pns')).rejects.toThrow('环境数组不完整')
 })
 it('reports failed fetches without trying to decode an error page',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('missing',{status:404})))
  await expect(loadPreparedNature('/missing.pns')).rejects.toThrow('环境资源读取失败')
 })
})
