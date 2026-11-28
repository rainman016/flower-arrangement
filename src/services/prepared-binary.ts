import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
const typed={Float32Array,Float64Array,Uint32Array,Int32Array,Uint16Array,Int16Array,Uint8Array,Int8Array,Uint8ClampedArray}

/** Decode binary scene data without touching images, the DOM or WebGL. */
export async function decodePreparedData(data:ArrayBuffer){
  if(data.byteLength<8||data.byteLength>192*1024*1024)throw Error('环境资源格式无效')
  const view=new DataView(data)
  if(view.getUint32(0)!==0x504e5331)throw Error('环境资源格式无效')
  const size=view.getUint32(4,true),start=8+size
  if(size>16*1024*1024||start>data.byteLength)throw Error('环境资源不完整')
  const {payload,parts}=JSON.parse(new TextDecoder().decode(new Uint8Array(data,8,size)))
  if(!payload||!Array.isArray(parts))throw Error('环境场景数据不完整')
  let decodedBytes=0
  await MeshoptDecoder.ready
  const revive=(value:any):any=>{
    if(Array.isArray(value))return value.map(revive)
    if(value&&typeof value==='object'){
      if('$binary' in value){
        const part=parts[value.$binary],ArrayType=typed[part?.type as keyof typeof typed]
        if(!Object.hasOwn(typed,part?.type)||!ArrayType||!Number.isInteger(part.offset)||!Number.isInteger(part.bytes)||part.offset<0||part.bytes<0||(start+part.offset)%ArrayType.BYTES_PER_ELEMENT||start+part.offset+part.bytes>data.byteLength||part.bytes%ArrayType.BYTES_PER_ELEMENT)throw Error('环境数组不完整')
        return new ArrayType(data,start+part.offset,part.bytes/ArrayType.BYTES_PER_ELEMENT)
      }
      if('$meshopt' in value){
        const Type=typed[value.type as keyof typeof typed],{count,stride,row,mode}=value
        if(!Object.hasOwn(typed,value.type)||!Type||!Number.isInteger(count)||count<0||count>20_000_000||!Number.isInteger(stride)||stride<1||stride>256||!Number.isInteger(row)||row<1||row>stride||row%Type.BYTES_PER_ELEMENT||!['ATTRIBUTES','INDICES','TRIANGLES'].includes(mode))throw Error('环境压缩数据无效')
        decodedBytes+=count*(stride+(row===stride?0:row))
        if(decodedBytes>192*1024*1024)throw Error('环境解压数据过大')
        const decoded=new Uint8Array(count*stride)
        MeshoptDecoder.decodeGltfBuffer(decoded,count,stride,revive(value.$meshopt),mode)
        if(row===stride)return new Type(decoded.buffer)
        const compact=new Uint8Array(count*row)
        for(let i=0;i<count;i++)compact.set(decoded.subarray(i*stride,i*stride+row),i*row)
        return new Type(compact.buffer)
      }
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,revive(v)]))
    }
    return value
  }
  const json=revive(payload)
  if(!json.object||!Array.isArray(json.geometries)||!Array.isArray(json.materials)||!json.prepared||!['bamboo','creek','rain'].includes(json.prepared.sceneId))throw Error('环境场景数据不完整')
  return json
}
