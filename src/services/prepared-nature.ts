import {preparedImagesReady} from './prepared-images'
import {loadCachedAsset} from './cached-asset'
import {prepareTextureBitmaps} from './prepared-bitmaps'
import {Texture,ImageBitmapLoader} from 'three'
import {runtimeMark} from './runtime-timing'
import {decodePreparedData} from './prepared-binary'
import {Color,CustomBlending,Matrix3,Matrix4,Mesh,LoadingManager,ObjectLoader,OneFactor,OneMinusSrcAlphaFactor,OrthographicCamera,ShaderMaterial,SrcAlphaFactor,Vector2,Vector3,Vector4,Quaternion,ZeroFactor,type Group} from 'three'

export type PreparedNature={root:Group;clock:{value:number};waterY?:number;sceneId:string;ready:Promise<void>;uploads:Map<Texture,Promise<void>>}
const vectors={Color,Matrix3,Matrix4,Vector2,Vector3,Vector4,Quaternion}

export async function loadPreparedNature(url:string,resolveAsset?:(id:string)=>string):Promise<PreparedNature>{
  // Large streaming responses were re-downloaded on return visits in Chrome.
  // Content-hashed files are immutable; keep only our own prepared asset responses.
  const cache=typeof caches!=='undefined'&&/^https?:/i.test(new URL(url,location.href).href)?await caches.open('flower-prepared-v1').catch(()=>undefined):undefined
  const cached=await cache?.match(url).catch(()=>undefined)
  let response=cached??await fetch(url),remember=!cached&&cache&&response.ok?response.clone():undefined
  const decode=async(response:Response)=>{
    if(!response.ok||!response.body)throw Error('环境资源读取失败')
    const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    runtimeMark('prepared-body')
    const json=await decodePreparedData(data);runtimeMark('prepared-decoded');return json
  }
  const json=await decode(response).catch(async error=>{
    if(!cached)throw error
    // Evict only this broken content-addressed response, then retry once online.
    await cache?.delete(url).catch(()=>false)
    response=await fetch(url);remember=cache&&response.ok?response.clone():undefined
    return decode(response)
  }),manager=new LoadingManager(),loader=new ObjectLoader(manager),clock={value:0},urls:string[]=[]
  for(const image of json.images??[]){
    if(image.url?.$asset){if(!resolveAsset)throw Error('环境纹理目录缺失');image.url=resolveAsset(image.url.$asset)}
    else if(image.url?.$image){const url=URL.createObjectURL(new Blob([image.url.$image],{type:image.url.mime}));urls.push(url);image.url=url}
  }
  // ObjectLoader's private manager can miss completion when ImageLoader reuses
  // an image already loading under another manager. Observe each real image instead.
  const external=(json.images??[]).filter((image:any)=>typeof image.url==='string'&&/^https?:/i.test(new URL(image.url,location.href).href))
  const images=loader.parseImages((json.images??[]).filter((image:any)=>!external.includes(image)))
  const decoded=preparedImagesReady(images)
  const imageLoads=new Map<unknown,Promise<void>>()
  const imageBitmaps=new Map<unknown,ImageBitmap>()
  const pending=external.map((entry:any)=>{
    const image=document.createElementNS('http://www.w3.org/1999/xhtml','img') as HTMLImageElement
    images[entry.uuid]=new Texture(image).source
    const loaded=loadCachedAsset(entry.url,async url=>{
      if(typeof createImageBitmap==='function'){
        const bitmap=await new ImageBitmapLoader().setOptions({imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'}).loadAsync(url)
        imageBitmaps.set(image,bitmap)
        if(!(globalThis as {flowerUploadReview?:boolean}).flowerUploadReview)return
      }
      image.src=url;await preparedImagesReady({image:{data:image}})
    })
    imageLoads.set(image,loaded);return loaded
  })
  const imagesReady=Promise.all([decoded,...pending]).then(()=>{})
  let ready=imagesReady
  void ready.catch(()=>{})
  try{
    const textures=loader.parseTextures(json.textures,images),materials=loader.parseMaterials(json.materials,textures)
    const uploads=prepareTextureBitmaps(textures,image=>imageLoads.get(image)??decoded,image=>imageBitmaps.get(image)??image)
    ready=Promise.all([imagesReady,...uploads.values()]).then(()=>{});void ready.catch(()=>{})
    void ready.finally(()=>urls.forEach(url=>URL.revokeObjectURL(url))).catch(()=>{})
    void ready.then(()=>{const retained=new Set(Object.values(textures).map(texture=>texture.image));for(const bitmap of imageBitmaps.values())if(!retained.has(bitmap))bitmap.close()}).catch(()=>{})
    const uniform=(value:any):any=>{
      if(Array.isArray(value))return value.map(uniform)
      if(value?.$texture){const texture=textures[value.$texture];if(!texture)throw Error('环境纹理缺失');return texture}
      if(value?.$type){const Type=vectors[value.$type as keyof typeof vectors];if(!Type)throw Error('环境向量格式无效');return new Type().fromArray(value.value)}
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,uniform(v)]))
      return value
    }
    for(const [uuid,patch] of Object.entries(json.prepared.patches) as [string,any][]){
      const material=materials[uuid];if(!material)continue
      const uniforms=Object.fromEntries(Object.entries(patch.uniforms).map(([name,v])=>[name,{value:uniform(v)}]))
      for(const name of patch.clocks)uniforms[name]=clock
      if(material instanceof ShaderMaterial)Object.assign(material.uniforms,uniforms)
      material.customProgramCacheKey=()=>patch.key
      material.onBeforeCompile=shader=>{
        shader.vertexShader=patch.vertex;shader.fragmentShader=patch.fragment
        Object.assign(shader.uniforms,uniforms)
      }
    }
    const root=loader.parseObject(json.object,loader.parseGeometries(json.geometries),materials,{}) as Group
    root.name='nature_environment';root.userData.natureClock=clock;root.userData.renderedFrames=0;root.userData.preparedNature=true
    root.traverse(object=>{
      if(!(object instanceof Mesh))return
      const depth=json.prepared.depths[object.uuid]
      if(depth)object.customDepthMaterial=materials[depth]
      const range=object.userData.preparedDrawRange
      if(range)object.geometry.setDrawRange(range[0],range[1]<0?Infinity:range[1])
      object.raycast=()=>{}
      const material=object.material as ShaderMaterial
      if(object.parent?.name==='woodland_distance_surfaces'&&material.uniforms?.image){
        material.blending=CustomBlending;material.blendSrcAlpha=ZeroFactor;material.blendDstAlpha=OneFactor
        object.onBeforeRender=renderer=>{
          const target=renderer.getRenderTarget(),coverage=!target||target.samples>0
          material.blendSrc=coverage?OneFactor:SrcAlphaFactor;material.blendDst=coverage?ZeroFactor:OneMinusSrcAlphaFactor
        }
      }
      if(object.name==='distant_canopy_shadow'){
        object.frustumCulled=false
        object.onBeforeShadow=(_r,_self,_camera,shadowCamera)=>object.geometry.setDrawRange(0,shadowCamera instanceof OrthographicCamera?6:0)
        object.onAfterShadow=()=>object.geometry.setDrawRange(0,0)
      }
    })
    root.updateMatrixWorld(true)
    runtimeMark('prepared-object')
    if(remember&&cache)void cache.put(url,remember).catch(()=>{})
    return {root,clock,waterY:json.prepared.waterY,sceneId:json.prepared.sceneId,ready,uploads}
  }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));throw error}
}
