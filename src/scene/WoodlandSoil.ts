import {DataTexture,LinearFilter,Matrix4,Mesh,Object3D,RGBAFormat,Vector3} from 'three'
import type {HeightAt} from './terrain-height'

// R stores contact, G its softer humus apron. BA store ground elevation as a
// linearly filterable 16-bit value, in the same metres as the planted meshes.
export const woodlandSoilSampling=`
  uniform sampler2D woodlandSoil;
  vec4 soilAt(vec2 xz){return texture2D(woodlandSoil,(xz+vec2(16.,29.))/32.);}
  float soilElevation(vec4 sampleValue){return dot(sampleValue.ba,vec2(255.*256.,255.))*32./65535.-8.;}
`

export function woodlandSoil(root:Object3D,kit:Object3D,ground:HeightAt){
  const resolution=768,step=32/resolution,texels=resolution*resolution
  const contact=new Float32Array(texels),heights=new Float32Array(texels)
  const image=new Uint8Array(texels*4)
  for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){
    const i=z*resolution+x,y=ground((x+.5)*step-16,(z+.5)*step-29)
    heights[i]=y
    const value=Math.round(Math.min(1,Math.max(0,(y+8)/32))*65535)
    image[i*4+2]=value>>8;image[i*4+3]=value&255
  }
  const a=new Vector3(),b=new Vector3(),c=new Vector3()
  function footprint(mesh:Mesh,world:Matrix4){
    const pos=mesh.geometry.attributes.position,indices=mesh.geometry.index
    const vertices=Array.from({length:pos.count},(_,i)=>new Vector3().fromBufferAttribute(pos,i).applyMatrix4(world))
    const corner=(i:number)=>vertices[indices?indices.getX(i):i]
    for(let i=0,n=indices?.count??pos.count;i<n;i+=3){
      a.copy(corner(i));b.copy(corner(i+1));c.copy(corner(i+2))
      // Only the surface that enters or overhangs earth contributes to this map.
      if(a.y-ground(a.x,a.z)>.29&&b.y-ground(b.x,b.z)>.29&&c.y-ground(c.x,c.z)>.29)continue
      const dx=b.x-a.x,dz=b.z-a.z,ex=c.x-a.x,ez=c.z-a.z,det=dx*ez-dz*ex
      if(Math.abs(det)<1e-8)continue
      const x0=Math.max(0,Math.ceil((Math.min(a.x,b.x,c.x)+16)/step-.5))
      const x1=Math.min(resolution-1,Math.floor((Math.max(a.x,b.x,c.x)+16)/step-.5))
      const z0=Math.max(0,Math.ceil((Math.min(a.z,b.z,c.z)+29)/step-.5))
      const z1=Math.min(resolution-1,Math.floor((Math.max(a.z,b.z,c.z)+29)/step-.5))
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const tx=(x+.5)*step-16-a.x,tz=(z+.5)*step-29-a.z
        const u=(tx*ez-tz*ex)/det,v=(dx*tz-dz*tx)/det
        if(u<0||v<0||u+v>1)continue
        const index=z*resolution+x,clearance=a.y+u*(b.y-a.y)+v*(c.y-a.y)-heights[index]
        contact[index]=Math.max(contact[index],Math.min(1,Math.max(0,1-clearance/.28)))
      }
    }
  }
  const point=new Vector3(),scale=new Vector3()
  const treeTemplates=kit.children.filter(o=>o.name.startsWith('forest_tree_'))
  let treeIndex=0
  root.traverse(o=>{
    if(o instanceof Mesh&&(o.userData.surfaceSource||o.name==='mature_bark'))footprint(o,o.matrixWorld)
    const kind=String(o.userData.prototype??'')
    if(kind!=='tree'&&!kind.startsWith('grove_'))return
    o.getWorldPosition(point);o.getWorldScale(scale)
    const template=kind==='tree'?treeTemplates[treeIndex++%treeTemplates.length]:null
    if(point.z>3||point.z< -29||Math.abs(point.x)>16)return
    if(template&&point.z> -13&&Math.abs(point.x)<8){
      template.traverse(part=>{if(part instanceof Mesh&&part.name.endsWith('_bark'))footprint(part,new Matrix4().multiplyMatrices(o.matrixWorld,part.matrixWorld))})
    }
    // The measured diameters of the three bamboo prototypes differ by 70 percent.
    const radius=kind==='tree'?.14:([.056,.076,.045][Number(kind.slice(-1))]??.06)
    const r=Math.max(step*.7,radius*Math.max(scale.x,scale.z))
    const cx=(point.x+16)/step-.5,cz=(point.z+29)/step-.5,w=r/step+1.4
    for(let z=Math.max(0,Math.ceil(cz-w));z<=Math.min(resolution-1,Math.floor(cz+w));z++)
      for(let x=Math.max(0,Math.ceil(cx-w));x<=Math.min(resolution-1,Math.floor(cx+w));x++){
        const i=z*resolution+x,edge=Math.hypot(x-cx,z-cz)-r/step
        contact[i]=Math.max(contact[i],Math.min(1,Math.max(0,1-edge/1.4)))
      }
  })
  // Two separable box passes spread earth contact into a soft forest-floor margin.
  // Each row and column is scanned once, regardless of the filter radius.
  function blur(input:Float32Array,radius:number){
    const mid=new Float32Array(texels),out=new Float32Array(texels),width=radius*2+1
    for(let z=0;z<resolution;z++){
      const row=z*resolution
      let sum=0
      for(let k=-radius;k<=radius;k++)sum+=input[row+Math.max(0,k)]
      for(let x=0;x<resolution;x++){
        mid[row+x]=sum/width
        sum+=input[row+Math.min(resolution-1,x+radius+1)]-input[row+Math.max(0,x-radius)]
      }
    }
    for(let x=0;x<resolution;x++){
      let sum=0
      for(let k=-radius;k<=radius;k++)sum+=mid[Math.max(0,k)*resolution+x]
      for(let z=0;z<resolution;z++){
        out[z*resolution+x]=sum/width
        sum+=mid[Math.min(resolution-1,z+radius+1)*resolution+x]-mid[Math.max(0,z-radius)*resolution+x]
      }
    }
    return out
  }
  const inner=blur(contact,1),apron=blur(blur(inner,3),4)
  for(let i=0;i<texels;i++){
    image[i*4]=Math.round((inner[i]*.64+contact[i]*.36)*255)
    image[i*4+1]=Math.round(Math.min(1,apron[i]*1.35)*255)
  }
  const result=new DataTexture(image,resolution,resolution,RGBAFormat)
  result.name='Forest floor | root and stone contact';result.minFilter=result.magFilter=LinearFilter
  result.needsUpdate=true
  return result
}
