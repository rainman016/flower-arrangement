import {Texture,NoColorSpace,SRGBColorSpace,LinearSRGBColorSpace} from 'three'

/** Decode/flip on the image worker, avoiding synchronous HTML image conversion at upload. */
export function prepareTextureBitmaps(textures:Record<string,Texture>,imageReady:(image:unknown)=>Promise<void>){
 const prepared=new Map<HTMLImageElement,Map<string,Promise<{bitmap:ImageBitmap;source:Texture['source']}>>>()
 const review=globalThis as {flowerUploadReview?:boolean;flowerPreparedUploads?:unknown[]}
 if(review.flowerUploadReview)review.flowerPreparedUploads=[]
 return new Map(Object.values(textures).map(texture=>{
  const original=texture.image
  const pendingTexture=imageReady(original).then(async()=>{
  if(typeof createImageBitmap!=='function')return
  if(!(original instanceof HTMLImageElement)||!([NoColorSpace,SRGBColorSpace,LinearSRGBColorSpace] as string[]).includes(texture.colorSpace))return
  let variants=prepared.get(original);if(!variants){variants=new Map();prepared.set(original,variants)}
  const key=texture.flipY+':'+texture.premultiplyAlpha
  let pending=variants.get(key)
  if(!pending){pending=createImageBitmap(original,{imageOrientation:texture.flipY?'flipY':'none',premultiplyAlpha:texture.premultiplyAlpha?'premultiply':'none',colorSpaceConversion:'none'}).then(bitmap=>({bitmap,source:new Texture(bitmap).source}));variants.set(key,pending)}
  const converted=await pending.catch(()=>undefined)
  if(!converted)return // Keep the decoded image on browsers without this conversion.
  const {bitmap,source}=converted
  texture.source=source;texture.needsUpdate=true
  if(review.flowerUploadReview)review.flowerPreparedUploads!.push({original,bitmap,flipY:texture.flipY,premultiplyAlpha:texture.premultiplyAlpha,name:texture.name})
  });void pendingTexture.catch(()=>{})
  return [texture,pendingTexture] as const
 }))
}
