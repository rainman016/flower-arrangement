import {prepareFoliageGeometry} from './prepare-foliage-geometry.mjs'
import {prepareLightTerms} from './prepare-light-terms.ts'
import {createHash} from 'node:crypto'
import {gunzipSync,gzipSync} from 'node:zlib'
import {MeshoptEncoder,MeshoptDecoder,MeshoptSimplifier} from 'meshoptimizer'
import {Box3,Matrix4,ShaderChunk,Vector3} from 'three'
const types={Float32Array,Float64Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Uint8Array,Int8Array,Uint8ClampedArray}
/** Pack the already prepared scene, retaining only indexed vertices. */
export async function compressPreparedNature(input,{externalImages}={}){
 await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready,MeshoptSimplifier.ready])
 const bytes=gunzipSync(input),size=bytes.readUInt32LE(4),{payload,parts}=JSON.parse(bytes.subarray(8,8+size).toString())
 const revive=v=>{
  if(Array.isArray(v))return v.map(revive)
  if(v&&typeof v==='object'){
   if('$meshopt'in v){
    const decoded=new Uint8Array(v.count*v.stride);MeshoptDecoder.decodeGltfBuffer(decoded,v.count,v.stride,revive(v.$meshopt),v.mode)
    if(v.row===v.stride)return new types[v.type](decoded.buffer)
    const compact=new Uint8Array(v.count*v.row);for(let i=0;i<v.count;i++)compact.set(decoded.subarray(i*v.stride,i*v.stride+v.row),i*v.row)
    return new types[v.type](compact.buffer)
   }
   if('$binary'in v){const p=parts[v.$binary];return new types[p.type](bytes.buffer.slice(bytes.byteOffset+8+size+p.offset,bytes.byteOffset+8+size+p.offset+p.bytes))}
   return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)]))
  }
  return v
 }
 const json=revive(payload),names=new Map(),scales=new Map(),simplification=[]
 const visit=(o,parent=new Matrix4())=>{
  const matrix=parent.clone().multiply(new Matrix4().fromArray(o.matrix??new Matrix4().elements))
  if(o.geometry){
   names.set(o.geometry,o.name);let scale=matrix.getMaxScaleOnAxis()
   if(o.instanceMatrix)for(let i=0;i<o.count;i++)scale=Math.max(scale,matrix.clone().multiply(new Matrix4().fromArray(o.instanceMatrix.array,i*16)).getMaxScaleOnAxis())
   scales.set(o.geometry,Math.max(scale,scales.get(o.geometry)??0))
  }
  o.children?.forEach(child=>visit(child,matrix))
 };visit(json.object)
 // Reflected distant trees cover much less than one pixel per centimetre.
 // Give only the reflection grove its own LOD; the visible bank keeps its source meshes.
 if(!json.prepared.mirrorLod){
  const originals=new Map(json.geometries.map(g=>[g.uuid,g])),copies=new Map(),report=[]
  const mirror=o=>{
   if(o.name?.startsWith('creek_mirror_')&&o.geometry){
    const source=originals.get(o.geometry)
    if(source?.data.index&&!source.data.groups?.length){
     let lod=copies.get(source.uuid)
     if(!lod){
      const scale=scales.get(source.uuid)||1,indices=Uint32Array.from(source.data.index.array),positions=source.data.attributes.position.array
      const [reduced,error]=MeshoptSimplifier.simplify(indices,positions,3,Math.max(3,Math.floor(indices.length*.16/3)*3),.012/scale,['ErrorAbsolute','PreserveFolds'])
      lod={...source,uuid:source.uuid+'-mirror-lod',data:{...source.data,attributes:Object.fromEntries(Object.entries(source.data.attributes).map(([name,a])=>[name,{...a,array:a.array.slice()}])),index:{...source.data.index,type:'Uint32Array',array:reduced}}}
      copies.set(source.uuid,lod);json.geometries.push(lod);names.set(lod.uuid,o.name);scales.set(lod.uuid,scale)
      report.push({name:o.name,before:indices.length/3,after:reduced.length/3,errorMetres:error*scale})
     }
     o.geometry=lod.uuid
    }
   }
   o.children?.forEach(mirror)
  };mirror(json.object);json.prepared.mirrorLod=report
 }
 if(!json.prepared.spatialCells){
  const geometries=new Map(json.geometries.map(g=>[g.uuid,g])),bounds=new Map(),report=[]
  const cells=(parent,parentMatrix=new Matrix4())=>{
   const world=parentMatrix.clone().multiply(new Matrix4().fromArray(parent.matrix??new Matrix4().elements))
   if(!parent.children)return
   parent.children=parent.children.flatMap(o=>{
    cells(o,world)
    if(o.type!=='InstancedMesh'||o.count<16||o.children?.length)return [o]
    const local=world.clone().multiply(new Matrix4().fromArray(o.matrix??new Matrix4().elements)),g=geometries.get(o.geometry),parts=new Map(),matrix=new Matrix4(),p=new Vector3(),solid=/grit|stone|rock|pebble|mineral/.test(o.name)
    let box=bounds.get(o.geometry)
    if(!box){box=new Box3();const a=g.data.attributes.position.array;for(let i=0;i<a.length;i+=3)box.expandByPoint(p.fromArray(a,i));bounds.set(o.geometry,box)}
    for(let i=0;i<o.count;i++){
     matrix.fromArray(o.instanceMatrix.array,i*16).premultiply(local);p.setFromMatrixPosition(matrix)
     const under=solid&&box.clone().applyMatrix4(matrix).max.y+.015<(json.prepared.waterY??-.133)
     const key=Math.floor(p.x/4)+','+Math.floor(p.z/4)+','+(under?'under':'surface'),rows=parts.get(key)||[];rows.push(i);parts.set(key,rows)
    }
    if(parts.size===1)return [o]
    report.push({name:o.name,instances:o.count,cells:parts.size})
    return [...parts.values()].map((rows,i)=>{
     const copy={...o,uuid:o.uuid+'-cell-'+i,count:rows.length};delete copy.boundingSphere;delete copy.boundingBox
     for(const key of ['instanceMatrix','instanceColor'])if(o[key]){
      const a=o[key],stride=a.itemSize??(key==='instanceMatrix'?16:3),array=new a.array.constructor(rows.length*stride)
      rows.forEach((row,j)=>array.set(a.array.subarray(row*stride,(row+1)*stride),j*stride));copy[key]={...a,array}
     }
     if(json.prepared.depths[o.uuid])json.prepared.depths[copy.uuid]=json.prepared.depths[o.uuid]
     return copy
    })
   })
  };cells(json.object);json.prepared.spatialCells=report
 }
 prepareFoliageGeometry(json,names,scales)
 const usedGeometry=new Set();const keep=o=>{if(o.geometry)usedGeometry.add(o.geometry);o.children?.forEach(keep)};keep(json.object)
 json.geometries=json.geometries.filter(g=>usedGeometry.has(g.uuid))
 const prepareMaterial=o=>{
  if(/^(terrain|root_bank_soil|mossy_bank_stone_.*|forest_rock_.*_surface)$/.test(o.name)){
   const patch=json.prepared.patches[o.material]
   if(patch){const next=prepareLightTerms(patch);next.key=createHash('sha256').update(next.vertex+next.fragment).digest('hex');json.prepared.patches[o.material]=next}
  }
  o.children?.forEach(prepareMaterial)
 };prepareMaterial(json.object)
 // The softbox is a local workbench fill. The forest retains its sun, skylight,
 // canopy filtering and shadows, without evaluating distant LTC area lighting.
 for(const material of json.materials){
  if(!['MeshStandardMaterial','MeshPhysicalMaterial'].includes(material.type))continue
  const patch=json.prepared.patches[material.uuid];if(!patch)continue
  patch.fragment=patch.fragment.replace('#include <lights_fragment_begin>',ShaderChunk.lights_fragment_begin).replace(/RE_Direct_RectArea\([^;]+;/g,'')
  patch.key=createHash('sha256').update(patch.vertex+patch.fragment).digest('hex')
 }
 const encode=(array,components,mode='ATTRIBUTES')=>{
  const row=components*array.BYTES_PER_ELEMENT,stride=mode==='ATTRIBUTES'?row+(4-row%4)%4:row,count=array.length/components
  const padded=new Uint8Array(count*stride),source=new Uint8Array(array.buffer,array.byteOffset,array.byteLength)
  if(stride===row)padded.set(source);else for(let i=0;i<count;i++)padded.set(source.subarray(i*row,(i+1)*row),i*stride)
  return {$meshopt:MeshoptEncoder.encodeGltfBuffer(padded,count,stride,mode,0),type:array.constructor.name,count,stride,row,mode}
 }
 for(const g of json.geometries){
  const attrs=g.data.attributes,index=g.data.index,name=names.get(g.uuid)||''
  if(!json.prepared.optimizedGeometry&&index&&!g.data.groups?.length&&/bryophyte|grass|blades|fern|herb|sedge|understory/.test(name)&&!/_stems$|_twigs$/.test(name)){
   const positions=attrs.position.array,normal=attrs.normal,uv=attrs.uv,fields=[normal,uv].filter(Boolean),stride=fields.reduce((s,a)=>s+a.itemSize,0),count=positions.length/3,attributes=new Float32Array(count*stride),weights=[]
   let offset=0
   for(const a of fields){
    const scale=a.normalized?(a.type==='Int8Array'?127:a.type==='Int16Array'?32767:255):1
    for(let i=0;i<count;i++)for(let c=0;c<a.itemSize;c++)attributes[i*stride+offset+c]=a.array[i*a.itemSize+c]/scale
    for(let c=0;c<a.itemSize;c++)weights.push(a===normal?.002:.006)
    offset+=a.itemSize
   }
   const original=index.array.length,target=Math.max(3,Math.floor(original*.4/3)*3),scale=scales.get(g.uuid)||1
   const [reduced,error]=stride?MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(index.array),positions,3,attributes,stride,weights,null,target,.002/scale,['ErrorAbsolute','PreserveFolds']):MeshoptSimplifier.simplify(Uint32Array.from(index.array),positions,3,target,.002/scale,['ErrorAbsolute','PreserveFolds'])
   if(reduced.length<original){index.array=reduced;index.type='Uint32Array';simplification.push({name,before:original/3,after:reduced.length/3,errorMetres:error*scale})}
  }
  if(index&&!json.prepared.reorderedVertices&&!g.data.groups?.length&&name!=='distant_canopy_shadow'){
   const ordered=Uint32Array.from(index.array),[remap,unique]=MeshoptEncoder.reorderMesh(ordered,true,false)
   for(const a of Object.values(attrs)){
    if(a.isInstancedBufferAttribute)continue
    const source=a.array,output=new source.constructor(unique*a.itemSize)
    for(let i=0;i<remap.length;i++)if(remap[i]<unique)for(let c=0;c<a.itemSize;c++)output[remap[i]*a.itemSize+c]=source[i*a.itemSize+c]
    a.array=output
   }
   index.array=(unique<65536?Uint16Array:Uint32Array).from(ordered);index.type=index.array.constructor.name
  }
  const used=index?[...new Set(index.array)]:null,remap=used?new Map(used.map((old,i)=>[old,i])):null
  if(used&&used.length<attrs.position.array.length/attrs.position.itemSize){
   for(const a of Object.values(attrs)){
    if(a.isInstancedBufferAttribute)continue
    const source=a.array,compact=new source.constructor(used.length*a.itemSize)
    used.forEach((old,i)=>{for(let c=0;c<a.itemSize;c++)compact[i*a.itemSize+c]=source[old*a.itemSize+c]});a.array=compact
   }
   index.array=(used.length<65536?Uint16Array:Uint32Array).from(index.array,n=>remap.get(n));index.type=index.array.constructor.name
  }
  for(const [name,a]of Object.entries(attrs)){
   if(a.type==='Float32Array'&&!a.normalized){
    if(name==='position'||name==='uv'){const scale=name==='position'?4096:16384;a.array=Float32Array.from(a.array,n=>Math.round(n*scale)/scale)}
    if(name==='normal'||name==='tangent'){
     const small=/grass|leaves|fern|canopy|litter/.test(names.get(g.uuid)||''),Type=small?Int8Array:Int16Array,scale=small?127:32767
     a.array=Type.from(a.array,n=>Math.round(Math.max(-1,Math.min(1,n))*scale));a.type=Type.name;a.normalized=true
    }
    if(name==='color'&&a.array.every(n=>n>=0&&n<=1)){a.array=Uint8Array.from(a.array,n=>Math.round(n*255));a.type='Uint8Array';a.normalized=true}
   }
   a.array=encode(a.array,a.itemSize)
  }
  if(index)index.array=encode(index.array,1,'TRIANGLES')
 }
 for(const image of json.images??[]){
  const data=image.url?.data,pixels=image.url?.width*image.url?.height
  if(ArrayBuffer.isView(data)&&pixels>0&&Number.isInteger(data.length/pixels))image.url.data=encode(data,data.length/pixels)
 }
 json.prepared.reorderedVertices=true
 if(!json.prepared.optimizedGeometry){json.prepared.optimizedGeometry=true;json.prepared.simplification=simplification}
 if(externalImages)for(const image of json.images??[]){
  const encoded=image.url?.$image;if(!encoded)continue
  const bytes=Buffer.from(encoded),hash=createHash('sha256').update(bytes).digest('hex'),mime=image.url.mime||'image/png',ext=mime.includes('jpeg')?'jpg':mime.includes('webp')?'webp':'png'
  const id='prepared-texture-'+hash.slice(0,20),file='assets/prepared/textures/'+hash.slice(0,20)+'.'+ext
  externalImages.set(id,{id,file,bytes,mime});image.url={$asset:id}
 }
 const chunks=[],packedParts=[];let offset=0
 const pack=v=>{
  if(ArrayBuffer.isView(v)){
   const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding}
   const part=packedParts.length;packedParts.push({offset,bytes:v.byteLength,type:v.constructor.name});chunks.push(Buffer.from(v.buffer,v.byteOffset,v.byteLength));offset+=v.byteLength;return {$binary:part}
  }
  return Array.isArray(v)?v.map(pack):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)])):v
 }
 const packed=pack(json),text=Buffer.from(JSON.stringify({payload:packed,parts:packedParts})),padded=Buffer.alloc(text.length+(4-text.length%4)%4,32);text.copy(padded)
 const header=Buffer.alloc(8);header.write('PNS1');header.writeUInt32LE(padded.length,4)
 return gzipSync(Buffer.concat([header,padded,...chunks]),{level:9})
}
