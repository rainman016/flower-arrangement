import {gunzipSync} from 'node:zlib'
import {decodePreparedData} from '../src/services/prepared-binary.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Texture } from 'three'
const root=process.cwd()
const manifest=JSON.parse(readFileSync(resolve(root,process.env.FLOWER_ASSET_MANIFEST||'public/assets/manifest.json'),'utf8'))
let total=0,authoringTotal=0
const sizes=new Map<string,number>()
const ids=new Set<string>()
for(const asset of manifest.assets){
  if(ids.has(asset.id)||!asset.file.startsWith('assets/')||asset.file.includes('..'))throw new Error('Invalid catalog entry')
  ids.add(asset.id)
  const buffer=readFileSync(resolve(root,'public',asset.file))
  if(asset.file.endsWith('.pns')){
    const data=gunzipSync(buffer),json=await decodePreparedData(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))
    if(asset.id!=='prepared-'+json.prepared.sceneId)throw Error('Prepared scene identity mismatch')
    const source=manifest.assets.find((a:{id:string})=>a.id==='environment-'+json.prepared.sceneId)
    if(asset.preparedFor!==(source?.originalFile??source?.file))throw Error('Prepared source mismatch')
    const references=new Set((json.images??[]).flatMap((i:any)=>i.url?.$asset?[i.url.$asset]:[]))
    if(references.size!==(asset.preparedTextures??[]).length||[...references].some(id=>!asset.preparedTextures?.includes(id)||!manifest.assets.some((a:any)=>a.id===id)))throw Error('Prepared texture references mismatch')
    for(const geometry of json.geometries){
      const position=geometry.data.attributes.position
      if(position.itemSize!==3||!ArrayBuffer.isView(position.array)||position.array.length%3||!position.array.every(Number.isFinite))throw Error('Invalid prepared position array')
      const count=position.array.length/3
      for(const a of Object.values(geometry.data.attributes) as any[])if(!a.isInstancedBufferAttribute&&(a.array.length/a.itemSize!==count||!a.array.every(Number.isFinite)))throw Error('Invalid prepared attribute')
      if(geometry.data.index&&!geometry.data.index.array.every((i:number)=>Number.isInteger(i)&&i>=0&&i<count))throw Error('Invalid prepared index')
    }
  }else if(asset.file.endsWith('.glb')){
    if(buffer.readUInt32LE(0)!==0x46546c67||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)throw new Error(asset.id+': invalid GLB')
    const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString('utf8'))
    const names=new Set(gltf.nodes.map((n:{name:string})=>n.name))
    for(const name of [asset.rootNode,...asset.requiredNodes||[]].filter(Boolean))if(!names.has(name))throw new Error(asset.id+': missing '+name)
    // Node verifies embedded image bytes and real scene transforms; browser tests decode/render textures.
    const binaryOffset=20+buffer.readUInt32LE(12)+8
    for(const image of gltf.images||[]){
      const view=gltf.bufferViews[image.bufferView]
      if(!view||view.buffer!==0||view.byteLength<24)throw new Error('Invalid embedded image view')
      const start=binaryOffset+(view.byteOffset||0),end=start+view.byteLength
      if(end>buffer.length)throw new Error('Embedded image outside buffer')
      const bytes=buffer.subarray(start,end)
      if(image.mimeType==='image/png'&&bytes.subarray(1,4).toString()!=='PNG')throw new Error('Invalid embedded PNG')
      if(image.mimeType==='image/jpeg'&&(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217))throw new Error('Invalid embedded JPEG')
    }
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'structural-check-texture-placeholder',loadTexture:()=>Promise.resolve(new Texture())}))
    const parsed=await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'')
    parsed.scene.updateMatrixWorld(true)
    parsed.scene.traverse(node=>{if(!node.matrixWorld.elements.every(Number.isFinite))throw new Error(asset.id+': invalid transform '+node.name)})
  }else if(asset.file.endsWith('.bin')){
    const format=buffer.toString('ascii',0,4),grid=buffer[4]
    if(!['WDS1','WDS2','WDS3','WDS4'].includes(format)||buffer[5]!==6||grid<2)throw Error(asset.id+': invalid distance surface')
    const seated=format==='WDS3'||format==='WDS4'
    let offset=seated?20:8
    if(seated&&![8,12,16].every(i=>Number.isFinite(buffer.readFloatLE(i))))throw Error('Invalid capture eye')
    const measured=(at:number)=>buffer.toString('ascii',at+1,at+4)==='PNG'||(format==='WDS4'&&buffer.toString('ascii',at,at+4)==='RIFF'&&buffer.toString('ascii',at+8,at+16)==='WEBPVP8L')
    function image(kind:string){
      const size=buffer.readUInt32LE(offset);offset+=4
      if(size<16||offset+size>buffer.length||(kind==='measured'?!measured(offset):buffer.toString('ascii',offset+8,offset+12)!==kind))throw Error(asset.id+': invalid '+kind)
      offset+=size
    }
    for(let i=0;i<6;i++){image('WEBP');offset+=(grid+1)**2*2;if(format!=='WDS1')image('measured')}
    if(offset>buffer.length||(offset<buffer.length&&!measured(offset)))throw Error(asset.id+': invalid shadow map')
  }else if(asset.file.endsWith('.hdr')){
    if(!buffer.subarray(0,100).toString('ascii').includes('FORMAT=32-bit_rle_rgbe'))throw Error('Invalid Radiance lighting map')
  }else if(asset.file.endsWith('.png')){
    if(buffer.subarray(1,4).toString()!=='PNG')throw new Error('Invalid PNG')
  }else if(asset.file.endsWith('.webp')){
    if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')throw Error('Invalid WebP')
  }else if(asset.file.endsWith('.ogg')){
    if(buffer.subarray(0,4).toString()!=='OggS'||!buffer.subarray(0,256).includes(Buffer.from('OpusHead')))throw new Error('Invalid Opus audio')
  }else if(buffer[0]!==255||buffer[1]!==216)throw new Error('Invalid JPEG')
  total+=buffer.length;sizes.set(asset.id,buffer.length)
  if(!asset.id.startsWith('prepared-'))authoringTotal+=buffer.length
  if(!asset.id.startsWith('prepared-texture-'))console.log(asset.id+': '+Math.round(buffer.length/1024)+' KB, verified')
}
// Authoring/fallback files retain their existing catalog cap. Prepared scenes
// replace their source kit, full environment and distance file on the load path.
if(authoringTotal>30*1024*1024)throw new Error('Authoring asset budget exceeded')
for(const scene of ['bamboo','creek'])if(sizes.has('prepared-'+scene)){
  const runtime=['prop-kit','woodland-light','preview-bamboo','preview-creek','audio-nature-'+scene,'prepared-'+scene,...(manifest.assets.find((a:any)=>a.id==='prepared-'+scene)?.preparedTextures??[])].reduce((sum,id)=>sum+(sizes.get(id)??0),0)
  if(runtime>20*1024*1024)throw Error(scene+': prepared load budget exceeded')
  console.log(scene+' prepared load: '+Math.round(runtime/1024)+' KB (20 MiB cap)')
}
console.log('Asset checks passed: '+Math.round(total/1024)+' KB')

