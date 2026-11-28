import {woodlandSky,woodlandSkyTexture} from '../scene/WoodlandSky'
import type {SceneId} from '../game/types'

const hash=async(data:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('')
/** Cache deterministic CPU-generated pixels; the built entry URL versions all dependencies. */
export async function loadGeneratedSky(scene:SceneId){
 const script=typeof document==='undefined'?undefined:document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src
 if(!script||!/^https?:/i.test(script)||typeof caches==='undefined'||!globalThis.crypto?.subtle)return woodlandSky(scene)
 const cache=await caches.open('flower-generated-sky-v1').catch(()=>undefined)
 if(!cache)return woodlandSky(scene)
 const key=new URL(script);key.searchParams.set('generated-sky',scene)
 const stored=await cache.match(key.href).catch(()=>undefined)
 if(stored)try{
  const data=await stored.arrayBuffer()
  if(data.byteLength===768*384*8&&await hash(data)===stored.headers.get('x-flower-sky-sha256'))return woodlandSkyTexture(scene,new Uint16Array(data))
 }catch{/* Recompute an incomplete or damaged local cache entry. */}
 const texture=woodlandSky(scene),data=(texture.image.data as Uint16Array).buffer as ArrayBuffer
 void hash(data).then(async checksum=>{
  await cache.put(key.href,new Response(data,{headers:{'Content-Type':'application/octet-stream','x-flower-sky-sha256':checksum}}))
  // Bound only this application's generated cache, keeping the current scene's build.
  for(const old of await cache.keys())if(old.url!==key.href&&new URL(old.url).searchParams.get('generated-sky')===scene)await cache.delete(old)
 }).catch(()=>{})
 return texture
}
