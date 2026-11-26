import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Mesh,MeshStandardMaterial,Vector3} from 'three'
import type {HeightAt} from './terrain-height'

// Return the actual buried rim of a stone, where a leaf can be pinned.
function contactRim(rock:Mesh,ground:HeightAt){
  const points=rock.geometry.attributes.position,index=rock.geometry.index
  const verts=Array.from({length:points.count},(_,i)=>new Vector3().fromBufferAttribute(points,i).applyMatrix4(rock.matrixWorld))
  const heights=verts.map(p=>p.y-ground(p.x,p.z)),rim:Vector3[]=[]
  const count=index?.count??points.count
  for(let i=0;i<count;i+=3){
    for(let edge=0;edge<3;edge++){
      const a=index?index.getX(i+edge):i+edge,b=index?index.getX(i+(edge+1)%3):i+(edge+1)%3
      if(heights[a]>=0||heights[b]<0)continue
      rim.push(verts[a].clone().lerp(verts[b],heights[a]/(heights[a]-heights[b])))
    }
  }
  return rim
}

export function stoneFootLitter(rocks:Mesh[],ground:HeightAt){
  const pos:number[]=[],colors:number[]=[],indices:number[]=[],wet:number[]=[],gaps:Vector3[]=[]
  const tint=new Color()
  const sites=[[1.24,-3.36],[1.48,-3.25],[1.82,-3.20],[2.18,-3.27],[2.29,-3.43]]
  const tones=[0x986a41,0xb18751,0x71563e,0xad8050,0x76523e]
  let pairs=0
  for(const rock of rocks){
    if(!rock.userData.exposedShoulder&&!rock.userData.outcropFoot)continue
    rock.geometry.computeBoundingBox()
    const centre=rock.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(rock.matrixWorld)
    const targets=rock.userData.exposedShoulder?sites:centre.z> -3.25&&centre.x>1.8?[[centre.x-.12,centre.z+.12]]:[]
    if(!targets.length)continue
    const rim=contactRim(rock,ground)
    if(!rim.length)continue
    for(const [x,z] of targets){
      const distance=(v:Vector3)=>(v.x-x)**2+(v.z-z)**2
      const pin=rim.reduce((a,b)=>distance(a)<distance(b)?a:b)
      const angle=Math.atan2(pin.z-centre.z,pin.x-centre.x)
      const gap=pin.clone();gap.x+=.064*Math.cos(angle);gap.z+=.064*Math.sin(angle);gap.y=ground(gap.x,gap.z)
      gaps.push(gap)
      // Fallen sheaths fork around a seedling. The broad one lies across the slope.
      for(let j=0;j<7;j++){
        const fork=[-.61,.52,1.12,-1.31,.10,.82,-.24][j]
        const dir=angle+fork,dx=Math.cos(dir),dz=Math.sin(dir)
        const length=[.254,.187,.139,.214,.173,.128,.195][j]*(.94+.15*Math.sin(pairs*2.3+j)),width=length*(j===1?.14:.106)
        const first=pos.length/3
        tint.setHex(tones[(pairs+j)%tones.length])
        for(let row=0;row<=10;row++){
          const t=row/10,along=t*length-.033-.004*j,curve=.011*Math.sin(t*Math.PI)*(j%3-1)
          const w=width*Math.sin(Math.PI*t)**.76*(.85+.15*t)
          for(let col=0;col<5;col++){
            const side=(col-2)*.5*w+curve,px=pin.x+dx*along-dz*side,pz=pin.z+dz*along+dx*side
            const rib=col===2?.0045:col===1?.0012:0
            const curl=.008*Math.sin(Math.PI*t)**2*(col===0?1:col===4?.32:0)
            const lift=.0016+.0018*j+curl+rib*Math.sin(Math.PI*t)
            pos.push(px,ground(px,pz)+lift-.006*(1-Math.min(1,t/.24)),pz)
            const wetness=.12+.82*(1-t)**.8+.05*Math.sin(9*t+j)
            const value=(.67+.30*t)*(col===2?1.25:col===0?.84:1.)*(1+.10*Math.cos(19*t+j))
            colors.push(tint.r*value,tint.g*value,tint.b*value);wet.push(wetness)
            if(row&&col){const a=first+row*5+col;indices.push(a-6,a-1,a,a-6,a,a-5)}
          }
        }
      }
      pairs++
    }
  }
  const geometry=new BufferGeometry()
  for(const [key,values,n] of [['position',pos,3],['color',colors,3],['_leafFilm',wet,1]] as const)
    geometry.setAttribute(key,new Float32BufferAttribute(values,n))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.38})
  const mesh=new Mesh(geometry,material);mesh.name='pinned_wet_litter'
  mesh.userData.pockets=pairs
  return {mesh,gaps,dispose:()=>{geometry.dispose();material.dispose()}}
}
