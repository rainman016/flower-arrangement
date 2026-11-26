import {Mesh,Vector3} from 'three'

export type HeightAt=(x:number,z:number)=>number

const detailed=new WeakMap<Mesh,HeightAt>()
export function registerTerrainSurface(mesh:Mesh,height:HeightAt){
  detailed.set(mesh,height)
  return ()=>{if(detailed.get(mesh)===height)detailed.delete(mesh)}
}

/** Sample the triangulated Blender heightfield at a world-space X/Z point. */
export function terrainSampler(terrain:Mesh):HeightAt{
  const replacement=detailed.get(terrain)
  if(replacement)return replacement
  const segments=Number(terrain.userData.heightfieldSegments),width=Number(terrain.userData.heightfieldSize)
  if(!segments||!width)throw Error('缺少地形尺寸')
  const row=segments+1,heights=new Float32Array(row*row),diagonals=new Uint8Array(segments*segments)
  const pos=terrain.geometry.attributes.position,gridIndex=new Uint32Array(pos.count),p=new Vector3()
  const grid=(v:number)=>(v/width+.5)*segments
  for(let i=0;i<pos.count;i++){
    p.fromBufferAttribute(pos,i).applyMatrix4(terrain.matrixWorld)
    gridIndex[i]=Math.round(grid(p.z))*row+Math.round(grid(p.x))
    heights[gridIndex[i]]=p.y
  }
  const index=terrain.geometry.index,indices=index?.count??pos.count
  for(let i=0;i<indices;i+=3){
    for(let j=0;j<3;j++){
      const a=gridIndex[index?index.getX(i+j):i+j]
      const b=gridIndex[index?index.getX(i+(j+1)%3):i+(j+1)%3]
      if(Math.abs(a-b)===row-1){
        const x=Math.min(a%row,b%row),z=Math.floor(Math.min(a,b)/row)
        diagonals[z*segments+x]=1
      }
    }
  }
  return (x,z)=>{
    const gx=Math.max(0,Math.min(segments-.00001,grid(x))),gz=Math.max(0,Math.min(segments-.00001,grid(z)))
    const ix=Math.floor(gx),iz=Math.floor(gz),a=iz*row+ix,dx=gx-ix,dz=gz-iz
    if(diagonals[iz*segments+ix]){
      return dx+dz<1?heights[a]*(1-dx-dz)+heights[a+1]*dx+heights[a+row]*dz:
        heights[a+row+1]*(dx+dz-1)+heights[a+1]*(1-dz)+heights[a+row]*(1-dx)
    }
    const middle=dx>dz?heights[a+1]:heights[a+row]
    return heights[a]*(1-Math.max(dx,dz))+middle*Math.abs(dx-dz)+heights[a+row+1]*Math.min(dx,dz)
  }
}
