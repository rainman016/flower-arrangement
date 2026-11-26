import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Texture } from 'three'
const root=process.cwd()
const manifest=JSON.parse(readFileSync(resolve(root,process.env.FLOWER_ASSET_MANIFEST||'public/assets/manifest.json'),'utf8'))
let total=0
const ids=new Set<string>()
for(const asset of manifest.assets){
  if(ids.has(asset.id)||!asset.file.startsWith('assets/')||asset.file.includes('..'))throw new Error('Invalid catalog entry')
  ids.add(asset.id)
  const buffer=readFileSync(resolve(root,'public',asset.file))
  if(asset.file.endsWith('.glb')){
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
    if(!['WDS1','WDS2','WDS3'].includes(format)||buffer[5]!==6||grid<2)throw Error(asset.id+': invalid distance surface')
    let offset=format==='WDS3'?20:8
    if(format==='WDS3'&&![8,12,16].every(i=>Number.isFinite(buffer.readFloatLE(i))))throw Error('Invalid capture eye')
    function image(kind:string){
      const size=buffer.readUInt32LE(offset);offset+=4
      if(size<16||offset+size>buffer.length||buffer.toString('ascii',offset+(kind==='PNG'?1:8),offset+(kind==='PNG'?4:12))!==kind)throw Error(asset.id+': invalid '+kind)
      offset+=size
    }
    for(let i=0;i<6;i++){image('WEBP');offset+=(grid+1)**2*2;if(format!=='WDS1')image('PNG')}
    if(offset>buffer.length||(offset<buffer.length&&buffer.toString('ascii',offset+1,offset+4)!=='PNG'))throw Error(asset.id+': invalid shadow map')
  }else if(asset.file.endsWith('.hdr')){
    if(!buffer.subarray(0,100).toString('ascii').includes('FORMAT=32-bit_rle_rgbe'))throw Error('Invalid Radiance lighting map')
  }else if(asset.file.endsWith('.png')){
    if(buffer.subarray(1,4).toString()!=='PNG')throw new Error('Invalid PNG')
  }else if(asset.file.endsWith('.ogg')){
    if(buffer.subarray(0,4).toString()!=='OggS'||!buffer.subarray(0,256).includes(Buffer.from('OpusHead')))throw new Error('Invalid Opus audio')
  }else if(buffer[0]!==255||buffer[1]!==216)throw new Error('Invalid JPEG')
  total+=buffer.length
  console.log(asset.id+': '+Math.round(buffer.length/1024)+' KB, verified')
}
// Shared hand rig and six lazy audio tracks add to the existing 23 MiB art catalog.
if(total>30*1024*1024)throw new Error('Asset budget exceeded')
console.log('Asset checks passed: '+Math.round(total/1024)+' KB')

