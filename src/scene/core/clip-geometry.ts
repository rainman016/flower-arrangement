import { BufferGeometry, Float32BufferAttribute, Vector3, Vector4 } from 'three'
type Vertex={p:Vector3;n:Vector3;u:number;v:number;c?:Vector4}
const mix=(a:Vertex,b:Vertex,t:number):Vertex=>({p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize(),u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t,c:a.c&&b.c?a.c.clone().lerp(b.c,t):undefined})
/** Clip real triangles, preserving UVs, normals and material groups. Close the exposed section. */
export function sliceY(input:BufferGeometry,low:number,high:number):BufferGeometry {
  const geometry=new BufferGeometry(),p=input.getAttribute('position'),n=input.getAttribute('normal'),uv=input.getAttribute('uv'),color=input.getAttribute('color'),index=input.index
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],colors:number[]=[]
  const cuts=[new Map<string,Vertex>(),new Map<string,Vertex>()]
  const push=(v:Vertex)=>{positions.push(v.p.x,v.p.y,v.p.z);normals.push(v.n.x,v.n.y,v.n.z);uvs.push(v.u,v.v);if(v.c){colors.push(v.c.x,v.c.y,v.c.z);if(color.itemSize===4)colors.push(v.c.w)}}
  const read=(i:number):Vertex=>({p:new Vector3().fromBufferAttribute(p,i),n:n?new Vector3().fromBufferAttribute(n,i):new Vector3(0,1,0),u:uv?.getX(i)??0,v:uv?.getY(i)??0,c:color?new Vector4(color.getX(i),color.getY(i),color.getZ(i),color.itemSize===4?color.getW(i):1):undefined})
  const clip=(poly:Vertex[],height:number,keepAbove:boolean,cut:Map<string,Vertex>)=>{
    if(!Number.isFinite(height))return poly
    const next:Vertex[]=[]
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=(a.p.y-height)*(keepAbove?1:-1),db=(b.p.y-height)*(keepAbove?1:-1)
      if(da>=-1e-9)next.push(a)
      if((da>1e-9&&db< -1e-9)||(da< -1e-9&&db>1e-9)){
        const v=mix(a,b,da/(da-db));v.p.y=height;next.push(v)
        cut.set([v.p.x,v.p.z].map(x=>Math.round(x*1e7)).join(','),v)
      }
    }
    return next
  }
  let lastMaterial=-1,groupStart=0
  const setMaterial=(material:number)=>{
    if(material===lastMaterial)return
    if(lastMaterial>=0)geometry.addGroup(groupStart,positions.length/3-groupStart,lastMaterial)
    groupStart=positions.length/3;lastMaterial=material
  }
  const count=index?.count??p.count
  for(let i=0;i<count;i+=3){
    const poly=clip(clip([0,1,2].map(j=>read(index?index.getX(i+j):i+j)),low,true,cuts[0]),high,false,cuts[1])
    if(poly.length<3)continue
    setMaterial(input.groups.find(g=>i>=g.start&&i<g.start+g.count)?.materialIndex??0)
    for(let j=1;j<poly.length-1;j++)[poly[0],poly[j],poly[j+1]].forEach(push)
  }
  cuts.forEach((cut,k)=>{
    const rim=[...cut.values()],points=rim.map(v=>v.p);if(points.length<3)return
    const capColor=color?rim.reduce((sum,v)=>sum.add(v.c!),new Vector4(0,0,0,0)).multiplyScalar(1/rim.length):undefined
    setMaterial(0)
    const center=points.reduce((a,b)=>a.add(b),new Vector3()).multiplyScalar(1/points.length)
    points.sort((a,b)=>Math.atan2(a.z-center.z,a.x-center.x)-Math.atan2(b.z-center.z,b.x-center.x))
    const normal=new Vector3(0,k===0?-1:1,0)
    const vertex=(p:Vector3):Vertex=>({p,n:normal,c:capColor,u:.5+(p.x-center.x)*10,v:.5+(p.z-center.z)*10})
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length]
      ;(k===0?[center,a,b]:[center,b,a]).map(vertex).forEach(push)
    }
  })
  if(lastMaterial>=0)geometry.addGroup(groupStart,positions.length/3-groupStart,lastMaterial)
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2))
  if(color)geometry.setAttribute('color',new Float32BufferAttribute(colors,color.itemSize))
  if(positions.length){geometry.computeBoundingBox();geometry.computeBoundingSphere()}
  return geometry
}
