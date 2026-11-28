/** Wait for the actual image objects, including requests shared with another loader. */
export function preparedImagesReady(sources:Record<string,{data:unknown}>){
 const images=new Set<HTMLImageElement>()
 const collect=(data:any)=>{
  if(Array.isArray(data)){data.forEach(collect);return}
  if(data&&typeof data.complete==='boolean'&&typeof data.addEventListener==='function')images.add(data)
 }
 Object.values(sources).forEach(source=>collect(source.data))
 return Promise.all([...images].map(image=>new Promise<void>((resolve,reject)=>{
  const clear=()=>{image.removeEventListener('load',loaded);image.removeEventListener('error',failed)}
  const loaded=()=>{
   clear()
   if(image.naturalWidth<=0){reject(new Error('环境纹理读取失败'));return}
   // Finish decoding while material compilation is in flight, rather than
   // synchronously decoding each image during the first GPU texture upload.
   if(typeof image.decode==='function')void image.decode().then(resolve,reject)
   else resolve()
  }
  const failed=()=>{clear();reject(new Error('环境纹理读取失败'))}
  if(image.complete){loaded();return}
  image.addEventListener('load',loaded,{once:true});image.addEventListener('error',failed,{once:true})
 }))).then(()=>{})
}
