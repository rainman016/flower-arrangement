import {BufferGeometry,Float32BufferAttribute,Mesh,Object3D,Vector3} from 'three'
import type {SceneId} from '../game/types'
import {registerTerrainSurface,type HeightAt} from './terrain-height.ts'

// Register the small relief that sits above the coarse triangulated bank with
// all other ground users, including roots, leaf litter and the stone contact map.
export function shapeWoodlandGround(root:Object3D,terrain:Mesh,original:HeightAt,bed:HeightAt,id:SceneId){
  const owned:BufferGeometry[]=[],p=new Vector3()
  // Same trunk centres as the scanned bark scene. The bamboo centre belongs
  // to the hero outcrop; the low soil tongue crosses only its downhill rim.
  const roots=root.getObjectByName('environment_rain')?.userData.rootButtresses??[2.38,-5.06,-2.89,-4.12]
  const sites=id==='rain'?[[roots[0],roots[1],.97,1.09,.19],[roots[2],roots[3],.82,.94,.13]]:
    id==='creek'?[[-2.84,-3.25,1.04,1.17,.15],[3.39,-7.22,.90,1.06,.13]]:[
      [1.76,-3.35,.84,.53,.107],
      // Two lobes of washed soil overlap the downhill rim, with a hollow between them.
      [1.39,-3.30,.32,.24,.095],[1.95,-3.26,.27,.19,.077],
    ]
  function lift(x:number,z:number,site:number[]){
    const [cx,cz,sx,sz,h]=site,dx=(x-cx)/sx,dz=(z-cz)/sz
    if(Math.abs(dx)>1.25||Math.abs(dz)>1.25)return 0
    const r=Math.hypot(dx,dz)
    if(r>1.25)return 0
    const a=Math.atan2(dz,dx),angle=a+cx
    const radius=.93+.13*Math.sin(3*angle)+.09*Math.cos(5*a-.47*cx)
    const envelope=Math.max(0,1-r/radius)
    const fold=.69+.19*Math.sin(4*angle+r*2)+.12*Math.cos(7*a-r*2.2)
    return h*envelope**.83*fold+.016*envelope*Math.sin(x*21+z*14)
  }
  const source=terrain.geometry,attrs=source.attributes
  const n=Number(terrain.userData.heightfieldSegments),width=Number(terrain.userData.heightfieldSize),coarse=width/n
  const grid=(v:number)=>Math.round((v/width+.5)*n)
  const xmin=grid(-7),xmax=grid(7),zmin=grid(-14),zmax=grid(.2)
  const sub=n>200?3:4,nx=(xmax-xmin)*sub,nz=(zmax-zmin)*sub,dx=coarse/sub
  const originX=(xmin/n-.5)*width,originZ=(zmin/n-.5)*width
  const size=(nx+1)*(nz+1),relief=new Float32Array(size),heights=new Float32Array(size)
  const moss=root.getObjectByName('bank_moss')
  // Transfer each authored cushion's actual triangular relief onto the continuous
  // bank. Hard intersections between two independently drawn surfaces disappear.
  if(moss instanceof Mesh){
    const verts=moss.geometry.attributes.position,idx=moss.geometry.index
    const points=Array.from({length:verts.count},(_,i)=>new Vector3().fromBufferAttribute(verts,i).applyMatrix4(moss.matrixWorld))
    const mossHeight=points.map(q=>Math.min(.024,Math.max(0,(q.y-original(q.x,q.z))*.70-.003)))
    const indices=idx?.count??verts.count
    for(let i=0;i<indices;i+=3){
      const ia=idx?idx.getX(i):i,ib=idx?idx.getX(i+1):i+1,ic=idx?idx.getX(i+2):i+2
      const a=points[ia],b=points[ib],c=points[ic],bx=b.x-a.x,bz=b.z-a.z,cx=c.x-a.x,cz=c.z-a.z,det=bx*cz-bz*cx
      if(Math.abs(det)<1e-9)continue
      const left=Math.max(0,Math.ceil((Math.min(a.x,b.x,c.x)-originX)/dx)),right=Math.min(nx,Math.floor((Math.max(a.x,b.x,c.x)-originX)/dx))
      const far=Math.max(0,Math.ceil((Math.min(a.z,b.z,c.z)-originZ)/dx)),near=Math.min(nz,Math.floor((Math.max(a.z,b.z,c.z)-originZ)/dx))
      for(let z=far;z<=near;z++)for(let x=left;x<=right;x++){
        const qx=originX+x*dx-a.x,qz=originZ+z*dx-a.z,u=(qx*cz-qz*cx)/det,v=(bx*qz-bz*qx)/det
        const k=z*(nx+1)+x
        if(u>=0&&v>=0&&u+v<=1)relief[k]=Math.max(relief[k],mossHeight[ia]*(1-u-v)+mossHeight[ib]*u+mossHeight[ic]*v)
      }
    }
    moss.visible=false
  }
  const gridVertex=new Uint32Array((n+1)**2),columns=new Uint16Array(attrs.position.count),rows=new Uint16Array(attrs.position.count)
  const oldWorld=Array.from({length:attrs.position.count},(_,i)=>{
    const q=new Vector3().fromBufferAttribute(attrs.position,i).applyMatrix4(terrain.matrixWorld)
    columns[i]=grid(q.x);rows[i]=grid(q.z);gridVertex[rows[i]*(n+1)+columns[i]]=i
    return q
  })
  const outer:number[]=[],originalIndex=source.index
  for(let i=0;i<(originalIndex?.count??attrs.position.count);i+=3){
    const a=originalIndex?originalIndex.getX(i):i,b=originalIndex?originalIndex.getX(i+1):i+1,c=originalIndex?originalIndex.getX(i+2):i+2
    const x=Math.min(columns[a],columns[b],columns[c]),z=Math.min(rows[a],rows[b],rows[c])
    if(x<xmin||x>=xmax||z<zmin||z>=zmax)outer.push(a,b,c)
  }
  const surround=source.clone();surround.setIndex(outer);terrain.geometry=surround;owned.push(surround)
  const positions:number[]=[],uv:number[]=[],indices:number[]=[],wet:number[]=[],cover:number[]=[]
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
    const wx=originX+x*dx,wz=originZ+z*dx,k=z*(nx+1)+x,edge=Math.min(x,z,nx-x,nz-z)
    const ix=xmin+Math.floor(x/sub),iz=zmin+Math.floor(z/sub),u=(x%sub)/sub,v=(z%sub)/sub
    const i=iz*(n+1)+ix,ia=gridVertex[i],ib=gridVertex[i+1],ic=gridVertex[i+n+1],it=gridVertex[i+n+2]
    const mix=(a:number,b:number,c:number,d:number)=>(a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v
    let h=edge?bed(wx,wz):mix(oldWorld[ia].y,oldWorld[ib].y,oldWorld[ic].y,oldWorld[it].y)
    for(const site of sites)h+=Math.max(0,lift(wx,wz,site))
    relief[k]*=Math.min(1,edge/3);h+=relief[k];heights[k]=h
    positions.push(mix(oldWorld[ia].x,oldWorld[ib].x,oldWorld[ic].x,oldWorld[it].x),h,mix(oldWorld[ia].z,oldWorld[ib].z,oldWorld[ic].z,oldWorld[it].z))
    uv.push(mix(attrs.uv.getX(ia),attrs.uv.getX(ib),attrs.uv.getX(ic),attrs.uv.getX(it)),mix(attrs.uv.getY(ia),attrs.uv.getY(ib),attrs.uv.getY(ic),attrs.uv.getY(it)))
    wet.push(mix(attrs._wetness.getX(ia),attrs._wetness.getX(ib),attrs._wetness.getX(ic),attrs._wetness.getX(it)))
    const m=mix(attrs._mosscover.getX(ia),attrs._mosscover.getX(ib),attrs._mosscover.getX(ic),attrs._mosscover.getX(it))
    cover.push(m+(1-m)*Math.min(1,relief[k]/.021))
    if(x&&z){const a=k-nx-2,b=k-nx-1,c=k-1;indices.push(a,c,k,a,k,b)}
  }
  const g=new BufferGeometry()
  if(id==='bamboo'){
    // Seepage follows the downhill toe. Local relief leaves raised grains dry.
    for(let z=1;z<nz;z++)for(let x=1;x<nx;x++){
      const wx=originX+x*dx,wz=originZ+z*dx
        if(wx<.76||wx>2.64||wz< -3.72||wz> -2.54)continue
      const k=z*(nx+1)+x,centre=-3.17+.11*Math.sin(5.3*(wx-1.31))
        const toe=Math.exp(-Math.pow((wx-1.65)/.81,4)-Math.pow((wz-centre)/.26,4))
        const leftHollow=Math.exp(-Math.pow((wx-1.35+.23*(wz+3.0))/.20,2)-((wz+2.99)/.26)**2)
        const rightHollow=Math.exp(-Math.pow((wx-2.01-.33*(wz+2.91))/.24,2)-((wz+3.00)/.33)**2)
        const reach=Math.max(toe,.93*leftHollow,.91*rightHollow)
      const neighbours=(heights[k-1]+heights[k+1]+heights[k-nx-1]+heights[k+nx+1])*.25
      const hollow=Math.min(1,Math.max(0,.66+(neighbours-heights[k])*43-relief[k]*12))
      wet[k]=Math.max(wet[k],reach*(.55+.45*hollow))
    }
  }
  for(const [key,array,count] of [['position',positions,3],['uv',uv,2],['_wetness',wet,1],['_mosscover',cover,1],['_nap',relief,1]] as const)
    g.setAttribute(key,new Float32BufferAttribute(array,count))
  g.setIndex(indices);g.computeVertexNormals();owned.push(g)
  const bank=new Mesh(g,terrain.material);bank.name='root_bank_soil';root.add(bank);bank.updateMatrixWorld(true)
  const at:HeightAt=(x,z)=>{
    const gx=(x-originX)/dx,gz=(z-originZ)/dx
    if(gx<0||gx>=nx||gz<0||gz>=nz)return bed(x,z)
    const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,i=iz*(nx+1)+ix
    return heights[i]*(1-Math.max(u,v))+(u>v?heights[i+1]:heights[i+nx+1])*Math.abs(u-v)+heights[i+nx+2]*Math.min(u,v)
  }
  const bark=root.getObjectByName('mature_bark')
  if(bark instanceof Mesh){
    const g=bark.geometry.clone(),vertices=g.attributes.position,inverse=bark.matrixWorld.clone().invert()
    // The authored root tubes are disconnected islands in the trunk mesh.
    // Preserve their direction and skin, laying only the lateral roots into soil.
    const parent=Array.from({length:vertices.count},(_,i)=>i)
    function find(i:number){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
    const idx=g.index
    if(idx)for(let i=0;i<idx.count;i+=3){const a=find(idx.getX(i));parent[find(idx.getX(i+1))]=a;parent[find(idx.getX(i+2))]=a}
    const spans=new Map<number,{min:number;max:number}>()
    for(let i=0;i<vertices.count;i++){
      p.fromBufferAttribute(vertices,i).applyMatrix4(bark.matrixWorld)
      const key=find(i),range=spans.get(key)??{min:Infinity,max:-Infinity}
      range.min=Math.min(range.min,p.y);range.max=Math.max(range.max,p.y);spans.set(key,range)
    }
    for(let i=0;i<vertices.count;i++){
      p.fromBufferAttribute(vertices,i).applyMatrix4(bark.matrixWorld)
      const old=original(p.x,p.z),floor=at(p.x,p.z),rel=p.y-old,range=spans.get(find(i))!
      if(range.max-range.min<1.8){
        const site=Math.hypot(p.x-sites[0][0],p.z-sites[0][1])<Math.hypot(p.x-sites[1][0],p.z-sites[1][1])?sites[0]:sites[1]
        const length=Math.hypot(p.x-site[0],p.z-site[1])
        const taper=Math.min(1,Math.max(0,(length-.20)/.69)),wet=Math.min(1,Math.max(0,(.14-floor)/.19))
        p.y=floor+rel*(.76-.24*taper)-.071*taper-.062*wet*taper
        g.attributes.uv.setY(i,length*1.53)
      }else p.y+=(floor-old)*Math.max(0,Math.min(1,(.63-rel)/.52))
      p.applyMatrix4(inverse);vertices.setXYZ(i,p.x,p.y,p.z)
    }
    g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();bark.geometry=g;owned.push(g)
  }
  const unregister=registerTerrainSurface(terrain,at)
  return {at,dispose:()=>{unregister();owned.forEach(g=>g.dispose())}}
}
