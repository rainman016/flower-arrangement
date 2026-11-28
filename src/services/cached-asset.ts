/** Persist versioned game assets even when the browser evicts its HTTP cache. */
export async function loadCachedAsset<T>(url:string,load:(url:string)=>Promise<T>):Promise<T>{
  if(typeof caches==='undefined'||!/^https?:/i.test(new URL(url,globalThis.location?.href).href))return load(url)
  const cache=await caches.open('flower-runtime-assets-v1').catch(()=>undefined)
  if(!cache)return load(url)
  return decodeAsset(url,cache,async blob=>{
    const local=URL.createObjectURL(blob)
    try{return await load(local)}finally{URL.revokeObjectURL(local)}
  })
}

/** Decode the downloaded bytes directly, without a second blob-URL fetch. */
export async function decodeCachedAsset<T>(url:string,decode:(blob:Blob)=>Promise<T>):Promise<T>{
  const cache=typeof caches!=='undefined'&&/^https?:/i.test(new URL(url,globalThis.location?.href).href)?await caches.open('flower-runtime-assets-v1').catch(()=>undefined):undefined
  return decodeAsset(url,cache,decode)
}

async function decodeAsset<T>(url:string,cache:Cache|undefined,decode:(blob:Blob)=>Promise<T>):Promise<T>{
  const cached=await cache?.match(url).catch(()=>undefined)
  if(cached){
    try{return await decode(await cached.blob())}catch{await cache?.delete(url).catch(()=>false)}
  }
  const response=await fetch(url)
  if(!response.ok)throw Error('游戏素材读取失败')
  const blob=await response.blob(),result=await decode(blob)
  // Cache failures (private mode, quota) must never prevent playing.
  // The network body has one consumer; never leave a tee branch waiting for decode.
  void cache?.put(url,new Response(blob,{headers:response.headers})).catch(()=>{})
  return result
}
