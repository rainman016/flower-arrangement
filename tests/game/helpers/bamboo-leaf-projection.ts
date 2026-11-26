import {BufferGeometry,MathUtils,Matrix4,Mesh,Object3D,PerspectiveCamera,Vector4} from 'three'
import {bambooCulmLOD,bambooLeafLOD} from '../../../src/scene/BambooDepth'

// Geometry-only depth ownership of the agreed 640 x 235 ROI. This does not
// predict shading or replace the browser capture; it finds leaves hidden by
// actual culms/other bamboo blades, using the default low-quality leaf LOD.
export function bambooLeafProjection(root:Object3D,camera:PerspectiveCamera){
  const width=160,height=59,depth=new Float64Array(width*height).fill(Infinity),owner=new Int16Array(width*height).fill(-1)
  const names:string[]=[],geometries=new Map<BufferGeometry,BufferGeometry>(),clip=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  const worldClip=new Matrix4(),v=new Vector4()
  function draw(geometry:BufferGeometry,world:Matrix4,name:string){
    let id=names.indexOf(name);if(id<0){id=names.length;names.push(name)}
    const p=geometry.attributes.position,index=geometry.index,points=new Float64Array(p.count*3)
    worldClip.multiplyMatrices(clip,world)
    for(let i=0;i<p.count;i++){
      v.set(p.getX(i),p.getY(i),p.getZ(i),1).applyMatrix4(worldClip)
      points[i*3]=(v.x/v.w*.5+.5)*384;points[i*3+1]=(.5-v.y/v.w*.5)*256;points[i*3+2]=v.w>0?v.z/v.w:Infinity
    }
    for(let i=0,count=index?.count??p.count;i<count;i+=3){
      const a=(index?index.getX(i):i)*3,b=(index?index.getX(i+1):i+1)*3,c=(index?index.getX(i+2):i+2)*3
      const ax=points[a],ay=points[a+1],az=points[a+2],bx=points[b],by=points[b+1],bz=points[b+2],cx=points[c],cy=points[c+1],cz=points[c+2]
      if(Math.min(az,bz,cz)<-1||Math.max(az,bz,cz)>1)continue
      const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)))
      const y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)))
      if(x0>x1||y0>y1)continue
      const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-10)continue
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const u=((bx-x-.5)*(cy-y-.5)-(by-y-.5)*(cx-x-.5))/area
        const w=((cx-x-.5)*(ay-y-.5)-(cy-y-.5)*(ax-x-.5))/area,t=1-u-w
        if(Math.min(u,w,t)<0)continue
        const z=u*az+w*bz+t*cz,k=y*width+x
        if(z<depth[k]){depth[k]=z;owner[k]=id}
      }
    }
  }
  root.traverse(o=>{
    if(!(o instanceof Mesh))return
    if(o.name.startsWith('bamboo_side_crown_')||o.name.startsWith('bamboo_sunlit_spray_')||o.name==='terrain'||o.name==='root_bank_soil')
      draw(o.geometry,o.matrixWorld,o.name)
  })
  const templates:Object3D[]=[]
  root.traverse(o=>{if(String(o.userData.gardenPrototype??'').startsWith('grove_'))templates.push(o)})
  root.traverse(marker=>{
    const kind=String(marker.userData.prototype??'');if(!kind.startsWith('grove_'))return
    const template=templates.find(t=>t.userData.gardenPrototype===kind);if(!template)return
    const far=Math.hypot(marker.matrixWorld.elements[12],marker.matrixWorld.elements[14])>6.8
    template.traverse(source=>{
      if(!(source instanceof Mesh))return
      const leaves=source.name.endsWith('_leaves'),culm=source.name.endsWith('_culm')
      if(!leaves&&!culm)return
      let geometry=source.geometry
      if(far){
        if(!geometries.has(geometry))geometries.set(geometry,culm?bambooCulmLOD(geometry):bambooLeafLOD(geometry))
        geometry=geometries.get(geometry)!
      }
      const world=marker.matrixWorld.clone().multiply(template.matrixWorld.clone().invert().multiply(source.matrixWorld))
      draw(geometry,world,source.name)
    })
  })
  const counts:Record<string,number>={};let selectedLeaves=0,fullStrengthLeaves=0
  for(let k=0;k<owner.length;k++){
    const name=names[owner[k]]??'unmodelled_background';counts[name]=(counts[name]??0)+1
    const x=(k%width+.5)/384,y=(Math.floor(k/width)+.5)/256
    const distance=camera.projectionMatrix.elements[14]/(depth[k]+camera.projectionMatrix.elements[10])
    const focus=MathUtils.smoothstep(x,-.025,.008)*(1-MathUtils.smoothstep(x,.315,.355))
      *MathUtils.smoothstep(y,-.035,.012)*(1-MathUtils.smoothstep(y,.184,.215))
      *MathUtils.smoothstep(distance,1.7,2.8)*(1-MathUtils.smoothstep(distance,27,33))
    if(name.endsWith('_leaves')){if(focus>0)selectedLeaves++;if(focus>.8)fullStrengthLeaves++}
  }
  for(const geometry of new Set(geometries.values()))geometry.dispose()
  return {resolution:[width,height],geometryOnly:true,totalPixels:owner.length,selectedVisibleLeafFraction:selectedLeaves/owner.length,fullStrengthLeafFraction:fullStrengthLeaves/owner.length,
    visibleFractions:Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>[name,count/owner.length]))}
}
