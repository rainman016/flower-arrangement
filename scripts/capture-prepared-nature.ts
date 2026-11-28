import {prepareGroundSurface} from './bake-prepared-surfaces'
import {BufferGeometry,Material,Mesh,Object3D,Texture} from 'three'
import type {NatureCapture} from '../src/scene/prepared-nature-capture'

export async function capture(){
  const capture=(globalThis as unknown as {__naturePreparation:NatureCapture}).__naturePreparation
  if(!capture)throw Error('Missing prepared environment capture')
  await prepareGroundSurface(capture)
  const meta:any={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}}
  const images=new Map<string,any>(),depths:Record<string,string>={},patches:Record<string,any>={}
  const root=capture.root.clone(true),originals:Mesh[]=[],copies:Mesh[]=[]
  function prune(original:Object3D,copy:Object3D,hidden=false){
    hidden||=original.name==='creek_mirror_grove'
    if(!original.visible&&!hidden||(original as Mesh).isMesh&&original.name==='creek_surface'){copy.removeFromParent();return}
    if((original as Mesh).isMesh){originals.push(original as Mesh);copies.push(copy as Mesh)}
    const children=[...copy.children]
    original.children.forEach((child,i)=>prune(child,children[i],hidden))
  }
  prune(capture.root,root)
  const texture=(value:Texture)=>{
    if(!meta.images[value.source.uuid])meta.images[value.source.uuid]={uuid:value.source.uuid,url:null}
    images.set(value.source.uuid,value.source.data)
    value.toJSON(meta);return {$texture:value.uuid}
  }
  const value=(v:any):any=>{
    if(v?.isTexture)return texture(v)
    if(Array.isArray(v))return v.map(value)
    if(v?.isColor)return {$type:'Color',value:v.toArray()}
    for(const type of ['Vector2','Vector3','Vector4','Matrix3','Matrix4','Quaternion'])if(v?.['is'+type])return {$type:type,value:v.toArray()}
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,value(x)]))
    return v
  }
  const materials=new Map<string,Material>()
  const attribute=(_name:string,a:any)=>{
    let array=a.array
    if(a.isInterleavedBufferAttribute){
      array=new a.data.array.constructor(a.count*a.itemSize)
      for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)array[i*a.itemSize+c]=a.data.array[i*a.data.stride+a.offset+c]
    }
    const packed={array,normalized:a.normalized}
    return {itemSize:a.itemSize,type:packed.array.constructor.name,...packed,...(a.isInstancedBufferAttribute?{isInstancedBufferAttribute:true,meshPerAttribute:a.meshPerAttribute}:{})}
  }
  const geometry=(g:BufferGeometry)=>{
    if(meta.geometries[g.uuid])return
    const attributes=Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,attribute(name,a)]))
    let index=g.index?.array
    if(index){
      const vertices=[...new Set(index)],remap=new Map(vertices.map((old,i)=>[old,i]))
      if(vertices.length<g.attributes.position.count){
        for(const a of Object.values(attributes)){
          if(a.isInstancedBufferAttribute)continue
          const source=a.array,compact=new (source.constructor as any)(vertices.length*a.itemSize)
          vertices.forEach((old,i)=>{for(let c=0;c<a.itemSize;c++)compact[i*a.itemSize+c]=source[old*a.itemSize+c]})
          a.array=compact
        }
        index=(vertices.length<65536?Uint16Array:Uint32Array).from(index,n=>remap.get(n)!)
      }
    }
    meta.geometries[g.uuid]={uuid:g.uuid,type:g.isInstancedBufferGeometry?'InstancedBufferGeometry':'BufferGeometry',name:g.name,userData:g.userData,
      data:{attributes,
        ...(index?{index:{type:index.constructor.name,array:index}}:{}),groups:g.groups}}
  }
  root.traverse(object=>{
    if(!(object as Mesh).isMesh)return
    const mesh=object as Mesh
    geometry(mesh.geometry)
    for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.set(m.uuid,m)
  })
  if(originals.length!==copies.length)throw Error('Prepared scene traversal mismatch')
  originals.forEach((original,i)=>{
    const copy=copies[i]
    if(original.customDepthMaterial){materials.set(original.customDepthMaterial.uuid,original.customDepthMaterial);depths[copy.uuid]=original.customDepthMaterial.uuid}
    copy.userData={...copy.userData,preparedDrawRange:[original.geometry.drawRange.start,Number.isFinite(original.geometry.drawRange.count)?original.geometry.drawRange.count:-1]}
    if((copy as any).isInstancedMesh){
      const instances=copy as any
      instances.instanceMatrix=instances.instanceMatrix.clone();instances.instanceMatrix.array=instances.instanceMatrix.array.slice(0,instances.count*16)
      if(instances.instanceColor){instances.instanceColor=instances.instanceColor.clone();instances.instanceColor.array=instances.instanceColor.array.slice(0,instances.count*3)}
    }
  })
  if(capture.water){
    capture.water.geometry=capture.water.geometry.clone().applyMatrix4(capture.water.matrixWorld)
    capture.water.position.set(0,0,0);capture.water.quaternion.identity();capture.water.scale.set(1,1,1);capture.water.updateMatrix()
    capture.water.name='prepared_water_source';capture.water.visible=false
    geometry(capture.water.geometry);root.add(capture.water)
    for(const m of Array.isArray(capture.water.material)?capture.water.material:[capture.water.material])materials.set(m.uuid,m)
  }
  for(const material of materials.values()){
    for(const entry of Object.values(material))if((entry as Texture)?.isTexture)texture(entry as Texture)
    const uniforms=(material as any).uniforms
    if(uniforms)for(const uniform of Object.values(uniforms) as any[])value(uniform.value)
    const shader=capture.shaders.get(material)
    if(shader){
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(shader.vertex+shader.fragment))
      patches[material.uuid]={vertex:shader.vertex,fragment:shader.fragment,uniforms:Object.fromEntries(Object.entries(shader.uniforms).map(([name,u])=>[name,value(u.value)])),clocks:shader.clocks,key:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')}
    }
    meta.materials[material.uuid]=material.toJSON(meta)
  }
  const object=root.toJSON(meta).object
  for(const [uuid,image] of images){
    if(image?.data){meta.images[uuid].url={data:image.data,width:image.width,height:image.height,type:image.data.constructor.name};continue}
    let blob:Blob
    const bitmap=(globalThis as any).__preparedBitmaps?.get(image)
    if(bitmap){
      blob=bitmap.blob
      // ObjectLoader uses HTML images: preserve encoded pixels and reproduce the
      // ImageBitmap orientation at upload, instead of expanding JPEG/WebP to PNG.
      if(bitmap.flip)for(const item of Object.values(meta.textures) as any[])if(item.image===uuid)item.flipY=!item.flipY
    }
    else if(image?.src){blob=(globalThis as any).__preparedImageBlobs?.get(image.src)??await (await fetch(image.src)).blob()}
    else if(image instanceof HTMLCanvasElement)blob=await new Promise<Blob>((resolve,reject)=>image.toBlob(b=>b?resolve(b):reject(Error('Cannot encode prepared image')),(image as any).preparedImageType??'image/png',.98))
    else if(image instanceof ImageBitmap){
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
      canvas.getContext('2d')!.drawImage(image,0,0)
      blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Cannot encode prepared bitmap')),'image/png'))
    }else throw Error('Unsupported prepared image '+uuid+' '+image?.constructor?.name)
    meta.images[uuid].url={$image:new Uint8Array(await blob.arrayBuffer()),mime:blob.type}
  }
  const chunks:Uint8Array[]=[],parts:any[]=[];let offset=0
  const arrays:any={Float32Array,Float64Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Uint8Array,Int8Array,Uint8ClampedArray}
  const binary=(input:any):any=>{
    if(ArrayBuffer.isView(input)){
      const bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength),padding=(4-offset%4)%4
      if(padding){chunks.push(new Uint8Array(padding));offset+=padding}
      const index=parts.length;parts.push({offset,bytes:bytes.length,type:input.constructor.name});chunks.push(bytes);offset+=bytes.length
      return {$binary:index}
    }
    if(Array.isArray(input))return input.map(binary)
    if(input&&typeof input==='object'){
      if(arrays[input.type]&&Array.isArray(input.array))input={...input,array:new arrays[input.type](input.array)}
      return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,binary(v)]))
    }
    return input
  }
  const payload=binary({metadata:{version:4.7,type:'Object',generator:'PreparedNature'},object,
    ...Object.fromEntries(Object.entries(meta).filter(([,v])=>Object.keys(v as any).length).map(([k,v])=>[k,Object.values(v as any)])),
    prepared:{patches,depths,waterY:capture.waterY,sceneId:(globalThis as any).__coreInspect.read().ritual.sceneId}})
  const textJSON=JSON.stringify({payload,parts})
  const encoded=new TextEncoder().encode(textJSON),json=new Uint8Array(encoded.length+(4-encoded.length%4)%4);json.fill(32);json.set(encoded)
  const header=new Uint8Array(8)
  header.set([80,78,83,49]);new DataView(header.buffer).setUint32(4,json.length,true)
  const blob=new Blob([header,json,...chunks] as BlobPart[]),compressed=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  let text='';const bytes=new Uint8Array(compressed)
  for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384))
  return {data:btoa(text),bytes:bytes.length,meshes:copies.length,materials:materials.size,patches:Object.keys(patches).length,images:images.size,rawBytes:blob.size}
}
