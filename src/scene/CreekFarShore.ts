import {Vector3,type BufferGeometry,type Mesh} from 'three'
import type {HeightAt} from './terrain-height'

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
const sites=[{x:-2.85,shift:-.18,radius:.50},{x:-1.55,shift:.24,radius:.58},
  {x:-.05,shift:-.28,radius:.60},{x:1.08,shift:.18,radius:.52},{x:2.15,shift:-.22,radius:.48}]
const banks=new WeakMap<Mesh,{sample:HeightAt;freeze:()=>HeightAt;before?:HeightAt}>()
export function registerCreekFarShore(bank:Mesh,sample:HeightAt,freeze:()=>HeightAt){banks.set(bank,{sample,freeze})}
export function creekBeforeFarHeight(bank:Mesh){return banks.get(bank)?.before}

// Read the existing crossing rather than assuming the water ribbon's outer edge
// is the shore. Transfer a local cross-section by a measured horizontal amount.
export function shapeCreekFarShore(bank:Mesh,stream:Mesh,level=-.132){
  const registered=banks.get(bank)
  if(bank.userData.creekFarShore||!registered)return
  const heightAt=registered.sample
  // Freeze only after the existing deep run and near-bank bars are finished.
  // Scatter decisions retain their old random sequence outside this shoreline.
  registered.before=registered.freeze()
  stream.updateWorldMatrix(true,false)
  const {position,uv}=stream.geometry.attributes,rows=new Map<number,{far:Vector3;near:Vector3}>(),point=new Vector3()
  for(let i=0;i<position.count;i++){
    const u=uv.getX(i);if(u>.001&&u<.999)continue
    const v=uv.getY(i),row=rows.get(v)??{far:new Vector3(),near:new Vector3()}
    point.fromBufferAttribute(position,i).applyMatrix4(stream.matrixWorld);row[u<.5?'far':'near'].copy(point);rows.set(v,row)
  }
  const candidates=[...rows.values()].filter(r=>r.far.z> -9.5&&r.far.z< -4.5)
  const crossing=(x:number,z:number,nx:number,nz:number)=>{
    let low=-.5,high=1.5
    for(let i=0;i<25;i++){
      const middle=(low+high)*.5
      if(heightAt(x+nx*middle,z+nz*middle)>level)low=middle;else high=middle
    }
    return (low+high)*.5
  }
  const patches=sites.flatMap(site=>{
    const row=candidates.reduce<{far:Vector3;near:Vector3}|null>((best,r)=>!best||Math.abs(r.far.x-site.x)<Math.abs(best.far.x-site.x)?r:best,null)
    if(!row)return []
    const normal=row.near.clone().sub(row.far).setY(0).normalize(),d=crossing(row.far.x,row.far.z,normal.x,normal.z)
    const x=row.far.x+normal.x*d,z=row.far.z+normal.z*d
    const offsets=[-.5,-.35,-.2,0,.2,.35,.5],before=offsets.map(t=>heightAt(x+normal.x*t,z+normal.z*t))
    return [{x,z,nx:normal.x,nz:normal.z,targetShift:site.shift,radius:site.radius,offsets,before,after:[] as number[],actualShift:0}]
  })
  const vertices=bank.geometry.attributes.position,heights=new Float32Array(vertices.count)
  let changed=0,maxDelta=0,nearRegionChanged=0,flankReliefVertices=0
  // Defer all writes so every shifted sample reads the original cross-section.
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),z=vertices.getZ(i),old=vertices.getY(i)
    let displacementX=0,displacementZ=0
    for(const patch of patches){
      const dx=x-patch.x,dz=z-patch.z,cross=dx*patch.nx+dz*patch.nz,along=-dx*patch.nz+dz*patch.nx
      const weight=(1-smooth(.12,1,Math.abs(along)/patch.radius))*(1-smooth(.36,.78,Math.abs(cross)))
      displacementX+=patch.nx*patch.targetShift*weight;displacementZ+=patch.nz*patch.targetShift*weight
    }
    let next=Math.abs(displacementX)+Math.abs(displacementZ)>.00001?heightAt(x-displacementX,z-displacementZ):old
    const farScope=smooth(-5.,-4.3,x)*(1-smooth(4.5,5.2,x))*smooth(-10.7,-9.7,z)*(1-smooth(-4.6,-4.,z))
    const upperToe=smooth(.045,.14,next-level)*(1-smooth(.42,.85,next-level))*farScope
    const rill=(.5+.5*Math.sin(x*11.7+z*4.1+.7*Math.sin(z*3.8)))**2
    if(upperToe>.001){next-=upperToe*(.007+.025*rill);flankReliefVertices++}
    heights[i]=next
    if(Math.abs(next-old)>.0001){changed++;maxDelta=Math.max(maxDelta,Math.abs(next-old));if(z> -4)nearRegionChanged++}
  }
  for(let i=0;i<vertices.count;i++)vertices.setY(i,heights[i])
  vertices.needsUpdate=true;bank.geometry.computeVertexNormals();bank.geometry.computeBoundingBox();bank.geometry.computeBoundingSphere()
  for(const patch of patches){
    patch.actualShift=crossing(patch.x,patch.z,patch.nx,patch.nz)
    patch.after=patch.offsets.map(t=>heightAt(patch.x+patch.nx*t,patch.z+patch.nz*t))
  }
  bank.userData.creekFarShore={changed,maxDelta,nearRegionChanged,flankReliefVertices,patches}
}

// Give the recessed bank real water coverage. Only the far outer ribbon row
// moves; the existing interior, near-bank bar and deep-channel vertices stay put.
export function extendCreekFarWater(geometry:BufferGeometry){
  const {position,uv}=geometry.attributes,rows=new Map<number,Vector3>()
  for(let i=0;i<position.count;i++)if(uv.getX(i)>.999)rows.set(uv.getY(i),new Vector3().fromBufferAttribute(position,i))
  const p=new Vector3(),direction=new Vector3()
  for(let i=0;i<position.count;i++){
    if(uv.getX(i)>.001)continue
    p.fromBufferAttribute(position,i);const near=rows.get(uv.getY(i));if(!near)continue
    const scope=smooth(-3.8,-3.4,p.x)*(1-smooth(2.9,3.4,p.x))*smooth(-9.8,-9.2,p.z)*(1-smooth(-4.5,-4.1,p.z))
    direction.subVectors(p,near).setY(0).normalize();p.addScaledVector(direction,.38*scope)
    position.setXYZ(i,p.x,p.y,p.z)
  }
  position.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere()
}
