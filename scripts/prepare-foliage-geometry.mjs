import {Box3,Matrix4,Vector3} from 'three'
import {MeshoptSimplifier} from 'meshoptimizer'
/** Offline geometry LOD for a seated scene. Materials and real planting remain intact. */
export function prepareFoliageGeometry(json,names,scales){
 if(json.prepared.foliageLod)return
 const geometries=new Map(json.geometries.map(g=>[g.uuid,g])),bounds=new Map(),copies=new Map(),eye=new Vector3(0,1.54,1.31),point=new Vector3(),report=[]
 const visit=(o,parent=new Matrix4())=>{
  const world=parent.clone().multiply(new Matrix4().fromArray(o.matrix??new Matrix4().elements)),g=geometries.get(o.geometry)
  if(g?.data.index&&!g.data.groups?.length&&/leaves|fern|grass|herb|blades|bryophyte|_stems|_twigs|creek_mirror_.*bark/.test(o.name)){
   let box=bounds.get(g.uuid)
   if(!box){box=new Box3();const a=g.data.attributes.position.array;for(let i=0;i<a.length;i+=3)box.expandByPoint(point.fromArray(a,i));bounds.set(g.uuid,box)}
   const planted=new Box3()
   if(o.instanceMatrix)for(let i=0;i<o.count;i++)planted.union(box.clone().applyMatrix4(new Matrix4().fromArray(o.instanceMatrix.array,i*16).premultiply(world)))
   else planted.copy(box).applyMatrix4(world)
   const distance=planted.distanceToPoint(eye),mirror=o.name.startsWith('creek_mirror_'),error=mirror?.060:distance<2.8?.004:distance<7?.012:.025,key=g.uuid+'-foliage-'+error
   let lod=copies.get(key)
   if(!lod){
    const a=g.data.attributes,positions=a.position.array,fields=[a.normal,a.uv].filter(Boolean),stride=fields.reduce((s,v)=>s+v.itemSize,0),attributes=new Float32Array(positions.length/3*stride),weights=[]
    let column=0
    for(const field of fields){const factor=field.normalized?(field.type==='Int8Array'?127:field.type==='Int16Array'?32767:255):1;for(let i=0;i<positions.length/3;i++)for(let c=0;c<field.itemSize;c++)attributes[i*stride+column+c]=field.array[i*field.itemSize+c]/factor;for(let c=0;c<field.itemSize;c++)weights.push(field===a.normal?.005:.012);column+=field.itemSize}
    const indices=Uint32Array.from(g.data.index.array),scale=scales.get(g.uuid)||1,target=Math.max(12,Math.floor(indices.length*(mirror?.14:.24)/3)*3)
    const [reduced,actual]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributes,stride,weights,null,target,error/scale,['ErrorAbsolute','Prune','Permissive'])
    lod={...g,uuid:key,data:{...g.data,attributes:Object.fromEntries(Object.entries(a).map(([name,v])=>[name,{...v,array:v.array.slice()}])),index:{...g.data.index,type:'Uint32Array',array:reduced}}}
    copies.set(key,lod);json.geometries.push(lod);names.set(key,o.name);scales.set(key,scale)
    report.push({name:o.name,distance,error,before:indices.length/3,after:reduced.length/3,errorMetres:actual*scale})
   }
   o.geometry=lod.uuid
  }
  o.children?.forEach(child=>visit(child,world))
 };visit(json.object);json.prepared.foliageLod=report
}
