/** Persist versioned game assets even when the browser evicts its HTTP cache. */
export async function loadCachedAsset<T>(url:string,load:(url:string)=>Promise<T>):Promise<T>{
  if(typeof caches==='undefined'||!/^https?:/i.test(new URL(url,globalThis.location?.href).href))return load(url)
  const cache=await caches.open('flower-runtime-assets-v1').catch(()=>undefined)
  if(!cache)return load(url)
  const cached=await cache.match(url).catch(()=>undefined)
  const decode=async(response:Response)=>{
    if(!response.ok)throw Error('游戏素材读取失败')
    const local=URL.createObjectURL(await response.blob())
    try{return await load(local)}finally{URL.revokeObjectURL(local)}
  }
  if(cached){
    try{return await decode(cached)}catch{await cache.delete(url).catch(()=>false)}
  }
  const response=await fetch(url),copy=response.clone(),result=await decode(response)
  // Cache failures (private mode, quota) must never prevent playing.
  void cache.put(url,copy).catch(()=>{})
  return result
}
