import {DataTexture,LinearFilter,Matrix4,Mesh,Object3D,RGBAFormat,Vector3} from 'three'
import type {HeightAt} from './terrain-height'

interface CrownPatch {center:Vector3;area:number}

// Horizontal leaf area is a proxy for blocked diffuse skylight. Bin the original
// leaf surfaces once per species, then plant the bins with their real transforms.
export function woodlandSkyView(root:Object3D,kit:Object3D,ground:HeightAt){
  const n=112,step=32/n,density=new Float32Array(n*n),elevation=new Float32Array(n*n)
  const crowns=new Map<Object3D,CrownPatch[]>()
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),p=new Vector3(),matrix=new Matrix4()
  function templatePatches(group:Object3D){
    const cached=crowns.get(group)
    if(cached)return cached
    const bins=new Map<string,CrownPatch>()
    group.traverse(o=>{
      if(!(o instanceof Mesh)||!o.name.endsWith('_leaves'))return
      const pos=o.geometry.attributes.position,idx=o.geometry.index
      const relative=group.matrixWorld.clone().invert().multiply(o.matrixWorld)
      const at=(out:Vector3,i:number)=>out.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(relative)
      for(let i=0;i<(idx?.count??pos.count);i+=3){
        at(a,i);at(b,i+1);at(c,i+2)
        const area=.5*Math.abs((b.x-a.x)*(c.z-a.z)-(c.x-a.x)*(b.z-a.z))
        if(area<.000002)continue
        p.copy(a).add(b).add(c).multiplyScalar(1/3)
        const key=Math.floor(p.x/.9)+','+Math.floor(p.z/.9)
        let patch=bins.get(key)
        if(!patch){patch={center:new Vector3(),area:0};bins.set(key,patch)}
        patch.area+=area;patch.center.addScaledVector(p,area)
      }
    })
    const patches=[...bins.values()]
    for(const patch of patches)patch.center.divideScalar(patch.area)
    crowns.set(group,patches);return patches
  }
  const trees=kit.children.filter(o=>o.name.startsWith('forest_tree_'))
  const bamboo=[0,1,2].map(i=>root.getObjectByName('grove_'+i))
  let treeIndex=0
  function deposit(template:Object3D,placement:Matrix4,scale:number){
    for(const patch of templatePatches(template)){
      p.copy(patch.center).applyMatrix4(placement)
      if(p.x< -18||p.x>18||p.z< -31||p.z>5)continue
      const h=p.y-ground(p.x,p.z)
      if(h<.60)continue
      const radius=.58+Math.min(1.40,h*.19)
      const px=(p.x+16)/step-.5,pz=(p.z+29)/step-.5,r=radius/step
      const extinction=patch.area*scale/(radius*radius)*1.35
      for(let z=Math.max(0,Math.ceil(pz-r));z<=Math.min(n-1,Math.floor(pz+r));z++)
        for(let x=Math.max(0,Math.ceil(px-r));x<=Math.min(n-1,Math.floor(px+r));x++){
          const d=((x-px)**2+(z-pz)**2)/(r*r)
          if(d>=1)continue
          const k=z*n+x,w=(1-d)**2*extinction
          density[k]+=w;elevation[k]+=w*p.y
        }
    }
  }
  const scale=new Vector3()
  root.traverse(o=>{
    const kind=String(o.userData.prototype??'')
    const t=kind==='tree'?trees[treeIndex++%trees.length]:kind.startsWith('grove_')?bamboo[Number(kind.slice(-1))]:undefined
    if(t){o.getWorldScale(scale);deposit(t,o.matrixWorld,scale.x*scale.z)}
  })
  const outer=root.getObjectByName('outer_canopy_leaves')
  if(outer)deposit(outer,matrix.copy(outer.matrixWorld),1)
  // Bamboo's live side crowns contribute shade at their actual height.
  if(root.getObjectByName('environment_bamboo'))root.traverse(o=>{
    if(o.name.startsWith('bamboo_side_crown_')&&o.name.endsWith('_leaves'))deposit(o,matrix.copy(o.matrixWorld),1)
  })
  const data=new Uint8Array(n*n*4)
  for(let i=0;i<density.length;i++){
    data[i*4]=Math.round(255*Math.exp(-density[i]))
    data[i*4+1]=Math.round(255*Math.min(1,Math.max(0,((elevation[i]/(density[i]||1))+8)/32)))
    data[i*4+3]=255
  }
  const texture=new DataTexture(data,n,n,RGBAFormat)
  texture.name='Forest canopy | sky visibility';texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true
  return texture
}
