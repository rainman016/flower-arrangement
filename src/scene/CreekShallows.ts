import {Box3,Mesh,Vector3,type Object3D} from 'three'
import {shapeCreekFarShore} from './CreekFarShore.ts'

const smooth=(a:number,b:number,value:number)=>{
  const t=Math.max(0,Math.min(1,(value-a)/(b-a)))
  return t*t*(3-2*t)
}

// Fixed world-space deposits follow the near-bank current beyond the right desk
// corner. Their tapered ends leave deeper gaps; the adjacent main run stays deep.
export const creekMarginDeposits=[
  {x:1.47,z:-3.02,length:.42,width:.30},
  {x:1.82,z:-2.58,length:.40,width:.32},
  {x:2.15,z:-2.13,length:.43,width:.30},
] as const
export const creekMarginFlow={x:.64,z:.7683749085}
export function creekMarginWeight(x:number,z:number){
  let weight=0
  for(const bar of creekMarginDeposits){
    const dx=x-bar.x,dz=z-bar.z,u=(dx*creekMarginFlow.x+dz*creekMarginFlow.z)/bar.length
    const v=(-dx*creekMarginFlow.z+dz*creekMarginFlow.x)/bar.width
    const r=Math.hypot(u,v)*(1+.055*Math.sin(x*19+z*13))
    weight=Math.max(weight,1-smooth(.65,1.10,r))
  }
  return weight
}

// Deepen the downstream run after the scanned stones have been seated, keeping
// a continuous supporting bed under their feet. Lower the underlying terrain as
// well so an older, shallower mesh cannot show through the detailed bed.
export function deepenCreekRun(bank:Mesh,terrain:Mesh,stream:Mesh,root:Object3D,level=-.132){
  if(bank.userData.creekRun)return
  const points=stream.geometry.attributes.position,uv=stream.geometry.attributes.uv
  const sections=new Map<number,{left:Vector3;right:Vector3}>(),p=new Vector3()
  stream.updateWorldMatrix(true,false)
  for(let i=0;i<points.count;i++){
    const u=uv.getX(i);if(u>.001&&u<.999)continue
    const v=uv.getY(i),row=sections.get(v)??{left:new Vector3(),right:new Vector3()}
    p.fromBufferAttribute(points,i).applyMatrix4(stream.matrixWorld)
    row[u<.5?'left':'right'].copy(p);sections.set(v,row)
  }
  const rows=[...sections.values()].map(({left,right})=>{
    const center=left.clone().lerp(right,.5),width=left.distanceTo(right),normal=right.clone().sub(left).divideScalar(width)
    return {center,width,normal}
  }).filter(row=>row.center.x>-.9&&row.center.x<7.2&&row.center.z<-1)
  const feet:{x:number;z:number;rx:number;rz:number}[]=[]
  root.traverse(node=>{
    if(!(node instanceof Mesh)||!node.userData.surfaceSource)return
    const bounds=new Box3().setFromObject(node),c=bounds.getCenter(new Vector3()),s=bounds.getSize(new Vector3())
    feet.push({x:c.x,z:c.z,rx:Math.max(.12,s.x*.56),rz:Math.max(.12,s.z*.56)})
  })
  let changed=0,maxCut=0
  for(const mesh of [bank,terrain]){
    const vertices=mesh.geometry.attributes.position,inverse=mesh.matrixWorld.clone().invert()
    for(let i=0;i<vertices.count;i++){
      p.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld)
      if(p.y>=level-.025||p.x<-.7||p.x>6.8||p.z<-7.5||p.z>-.8)continue
      let nearest=rows[0],best=Infinity
      for(const row of rows){const d=(p.x-row.center.x)**2+(p.z-row.center.z)**2;if(d<best){best=d;nearest=row}}
      if(!nearest)continue
      const across=.5+((p.x-nearest.center.x)*nearest.normal.x+(p.z-nearest.center.z)*nearest.normal.z)/nearest.width
      let weight=smooth(.10,.29,across)*(1-smooth(.68,.91,across))*smooth(-.2,1.2,nearest.center.x)*(1-smooth(5.2,6.7,p.x))
      for(const foot of feet){const r=Math.hypot((p.x-foot.x)/foot.rx,(p.z-foot.z)/foot.rz);weight*=smooth(.90,1.65,r)}
      const depth=.72+.11*Math.sin(p.x*.87+p.z*.48)+.06*Math.cos(p.z*1.7-p.x*.35)
      const cut=Math.max(0,p.y-(level-depth))*weight
      if(cut<.0001)continue
      p.y-=cut+(mesh===terrain?.018*weight:0)
      p.applyMatrix4(inverse);vertices.setXYZ(i,p.x,p.y,p.z);changed++;maxCut=Math.max(maxCut,cut)
    }
    vertices.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere()
  }
  bank.userData.creekRun={changed,maxCut,protectedStoneFeet:feet.length}
  const vertices=bank.geometry.attributes.position
  let lifted=0,maxLift=0
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i),weight=creekMarginWeight(x,z)
    if(y>=level-.10||weight===0)continue
    const depth=.16+.025*Math.sin(x*7+z*5)+.012*Math.cos(z*11-x*4)
    const lift=Math.max(0,level-depth-y)*weight
    if(lift<.0001)continue
    vertices.setY(i,y+lift);lifted++;maxLift=Math.max(maxLift,lift)
  }
  vertices.needsUpdate=true;bank.geometry.computeVertexNormals();bank.geometry.computeBoundingBox();bank.geometry.computeBoundingSphere()
  bank.userData.creekMarginBar={patches:creekMarginDeposits.length,changed:lifted,maxLift}
  shapeCreekFarShore(bank,stream,level)
}

// Raise only the submerged inside bend of the generated, continuous bank mesh.
// Both the water's optical depth and the pebble placement sample this surface.
export function shapeCreekShallows(bank:Mesh,stream:Mesh,level=-.132){
  if(bank.userData.creekShallows)return
  stream.updateWorldMatrix(true,false)
  const ends=new Map<number,{left:Vector3;right:Vector3}>(),point=new Vector3()
  const water=stream.geometry.attributes
  for(let i=0;i<water.position.count;i++){
    const u=water.uv.getX(i)
    if(u>.001&&u<.999)continue
    const v=water.uv.getY(i),row=ends.get(v)??{left:new Vector3(),right:new Vector3()}
    point.fromBufferAttribute(water.position,i).applyMatrix4(stream.matrixWorld)
    row[u<.5?'left':'right'].copy(point);ends.set(v,row)
  }
  const rows=[...ends.values()].map(({left,right})=>{
    const width=left.distanceTo(right),normal=right.clone().sub(left).divideScalar(width)
    return {x:(left.x+right.x)*.5,z:(left.z+right.z)*.5,nx:normal.x,nz:normal.z,width}
  }).filter(row=>row.x>-5.4&&row.x<2.5&&row.z>-9&&row.z<-2.5)
  const vertices=bank.geometry.attributes.position
  let changed=0,maxLift=0
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i)
    if(y>=level-.026||x<-6.7||x>2.6||z<-9.2||z>-2)continue
    let nearest=rows[0],best=Infinity
    for(const row of rows){const d=(x-row.x)**2+(z-row.z)**2;if(d<best){best=d;nearest=row}}
    if(!nearest)continue
    const across=.5+((x-nearest.x)*nearest.nx+(z-nearest.z)*nearest.nz)/nearest.width
    const shore=smooth(.56,.72,across)*(1-smooth(.98,1.06,across))
    const bend=smooth(-5.1,-3.7,nearest.x)*(1-smooth(.70,2.1,nearest.x))
    const depth=.044+.012*Math.sin(2.2*x+.6*z)+.008*Math.cos(3.1*z-x)
    const lift=Math.max(0,level-depth-y)*shore*bend
    if(lift<.0001)continue
    vertices.setY(i,y+lift);changed++;maxLift=Math.max(maxLift,lift)
  }
  vertices.needsUpdate=true;bank.geometry.computeVertexNormals()
  bank.geometry.computeBoundingBox();bank.geometry.computeBoundingSphere()
  bank.userData.creekShallows={changed,maxLift,level}
}
