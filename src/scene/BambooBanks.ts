import {BufferGeometry,Color,DoubleSide,Euler,Float32BufferAttribute,Matrix4,Mesh,MeshStandardMaterial,Object3D,PerspectiveCamera,Ray,Raycaster,Vector2,Vector3} from 'three'
import {deskView} from './core/desk-space'
import {DESK} from '../game/desk-layout'
import type {HeightAt} from './terrain-height'
import {bambooTurn} from './BambooTurn'

// Author planting from the confirmed seated composition, then store everything
// on the actual ground. No camera transform is used after construction.
const regions=[
  {name:'left',polygon:[[0,.245],[.30,.24],[.435,.29],[.422,.35],[.393,.425],[.35,.50],[.19,.61],[.07,.80],[0,.91]]},
  {name:'right',polygon:[[.53,.27],[.69,.245],[1,.245],[1,.92],[.93,.80],[.82,.61],[.65,.51],[.575,.43],[.544,.35]]},
] as const
function inside(x:number,y:number,polygon:readonly (readonly number[])[]){
  let result=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j]
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result
  }
  return result
}
const bounded=(v:number)=>Math.max(0,Math.min(1,v))
const deskClearance=(x:number,z:number)=>Math.hypot(Math.max(DESK.left-x,0,x-DESK.right),Math.max(DESK.back-z,0,z-DESK.front))

export function bambooBanks(root:Object3D,ground:HeightAt){
  root.updateMatrixWorld(true)
  const surfaces=['terrain','root_bank_soil'].map(name=>root.getObjectByName(name)).filter((o):o is Mesh=>o instanceof Mesh)
  const obstacles:Mesh[]=[]
  root.traverse(o=>{if(o instanceof Mesh&&(o.userData.exposedShoulder||o.userData.outcropFoot))obstacles.push(o)})
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80)
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  const ray=new Raycaster(),point=new Vector3(),uv=new Vector2()
  const buckets=new Map<number,[Vector3,Vector3,Vector3][]>(),cell=.5
  const key=(x:number,z:number)=>Math.floor(x/cell)*2048+Math.floor(z/cell)
  for(const mesh of surfaces){
    const position=mesh.geometry.attributes.position,index=mesh.geometry.index!
    const vertices=Array.from({length:position.count},(_,i)=>new Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld))
    for(let i=0;i<index.count;i+=3){
      const a=vertices[index.getX(i)],b=vertices[index.getX(i+1)],c=vertices[index.getX(i+2)]
      const x0=Math.min(a.x,b.x,c.x),x1=Math.max(a.x,b.x,c.x),z0=Math.min(a.z,b.z,c.z),z1=Math.max(a.z,b.z,c.z)
      if(x1< -13||x0>13||z1< -14||z0>2)continue
      for(let x=Math.floor(x0/cell);x<=Math.floor(x1/cell);x++)for(let z=Math.floor(z0/cell);z<=Math.floor(z1/cell);z++){
        const id=x*2048+z,list=buckets.get(id)??[];list.push([a,b,c]);buckets.set(id,list)
      }
    }
  }
  const intersection=new Vector3(),march=new Vector3()
  function localHit(test:Ray,x:number,z:number){
    let distance=Infinity,hit:Vector3|undefined
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const [a,b,c] of buckets.get(key(x+dx*cell,z+dz*cell))??[]){
      if(!test.intersectTriangle(a,b,c,false,intersection))continue
      const d=intersection.distanceTo(test.origin)
      if(d<distance){distance=d;hit=intersection.clone()}
    }
    return hit?{point:hit,distance}:undefined
  }
  function groundHit(test:Ray){
    // The registered height field only brackets the hit. Placement uses the
    // exact visible mesh triangle in its spatial bucket, including root relief.
    for(let distance=.12;distance<29;distance+=.16){
      test.at(distance,march)
      if(march.z< -14||Math.abs(march.x)>13)return undefined
      if(march.y-ground(march.x,march.z)>.022)continue
      const hit=localHit(test,march.x,march.z)
      if(hit)return hit
    }
  }
  let seed=731982
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const coverAt=(x:number,y:number)=>{
    let coverage=0
    for(const region of regions){
      if(!inside(x,y,region.polygon))continue
      let edge=1
      for(let i=0;i<region.polygon.length;i++){
        const a=region.polygon[i],b=region.polygon[(i+1)%region.polygon.length],dx=b[0]-a[0],dy=b[1]-a[1]
        const t=bounded(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy))
        edge=Math.min(edge,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t))
      }
      coverage=Math.max(coverage,bounded(edge/.035))
    }
    return coverage
  }
  // A vertex field blends the living bank into the existing soil, including
  // under the blades. It is not a separate floating ground decal.
  for(const surface of surfaces){
    const vertices=surface.geometry.attributes.position,cover=new Float32Array(vertices.count)
    for(let i=0;i<vertices.count;i++){
      point.fromBufferAttribute(vertices,i).applyMatrix4(surface.matrixWorld).applyMatrix4(projection)
      if(point.z>-1&&point.z<1)cover[i]=coverAt((point.x+1)*.5,(1-point.y)*.5)
    }
    surface.geometry.setAttribute('_bambooBankCover',new Float32BufferAttribute(cover,1))
  }
  type Batch={p:number[];c:number[];ix:number[];bend:number[];phase:number[]}
  const batch=():Batch=>({p:[],c:[],ix:[],bend:[],phase:[]})
  const grassNear=batch(),grassFar=batch(),fernNear=batch(),fernFar=batch()
  const batches=[['bamboo_bank_grass_near',grassNear],['bamboo_bank_grass_far',grassFar],
    ['bamboo_bank_fern_near',fernNear],['bamboo_bank_fern_far',fernFar]] as const
  const tone=new Color(),baseTone=new Color(),up=new Vector3(0,1,0),p=new Vector3()
  const roots:Vector3[]=[],anchors:{screen:number[];world:number[];radius:number;region:string}[]=[]
  const bladeHeights:number[]=[],frontHeights:number[]=[],clearances:number[]=[]
  let blades=0,fronds=0,understoryLeaves=0
  const understorySites:{screen:number[];world:number[];radius:number}[]=[]
  function vertex(batch:Batch,v:Vector3,t:number,tint:Color,shade:number,phase:number,wind=.014){
    batch.p.push(v.x,v.y,v.z);tone.copy(tint).multiplyScalar(shade)
    batch.c.push(tone.r,tone.g,tone.b);batch.bend.push(t*t*wind);batch.phase.push(phase)
    return batch.p.length/3-1
  }
  function blade(x:number,z:number,height:number,heading:number){
    const grass=z< -3.5?grassFar:grassNear
    const base=new Vector3(x,ground(x,z)-.005,z),direction=new Vector3(Math.cos(heading),0,Math.sin(heading))
    const side=new Vector3(-direction.z,0,direction.x),lean=height*(.75+1.15*random()),width=.0012+.0020*random()
    const middle=base.clone().addScaledVector(direction,lean*.40).addScaledVector(up,height*.57)
    const tip=base.clone().addScaledVector(direction,lean).addScaledVector(up,height*(.53+.19*random()))
    baseTone.setHex([0x3d5025,0x4e602c,0x657035,0x42552a,0x6c693a][blades%5])
    const a=vertex(grass,base,0,baseTone,.48,heading,height*.14)
    vertex(grass,p.copy(middle).addScaledVector(side,-width),.55,baseTone,.87,heading,height*.14)
    vertex(grass,p.copy(middle).addScaledVector(side,width),.55,baseTone,.79,heading,height*.14)
    vertex(grass,tip,1,baseTone,.96,heading,height*.14)
    // Two open triangles form one bent leaf; no thickness or hidden rib faces.
    grass.ix.push(a,a+2,a+1,a+1,a+2,a+3)
    const rise=Math.max(middle.y,tip.y)-base.y
    bladeHeights.push(rise);if(z> -1.5)frontHeights.push(rise)
    clearances.push(deskClearance(x,z))
    roots.push(base);blades++
  }
  function fern(x:number,z:number,size:number,heading:number){
    const ferns=z< -3.5?fernFar:fernNear
    const origin=new Vector3(x,ground(x,z)-.006,z),axis=new Vector3(Math.cos(heading),0,Math.sin(heading)),side=new Vector3(-axis.z,0,axis.x)
    const length=size*(.72+.39*random()),height=size*(.65+.36*random())
    const curve=(t:number)=>origin.clone().addScaledVector(axis,length*t*t).addScaledVector(up,height*(1.64*t-.96*t*t))
    const tint=new Color([0x45622a,0x587232,0x667d39,0x3e5e29][fronds%4])
    let previous=-1
    for(let row=0;row<=12;row++){
      const t=row/12,center=curve(t),w=.0017*(1-.7*t)
      const k=vertex(ferns,p.copy(center).addScaledVector(side,-w),t,tint,.65,heading)
      vertex(ferns,p.copy(center).addScaledVector(side,w),t,tint,.88,heading)
      if(previous>=0)ferns.ix.push(previous,k,previous+1,previous+1,k,k+1)
      previous=k
      if(row<2||row===12)continue
      for(const sign of [-1,1]){
        const a=curve(t+(sign===1?.015:0)),span=size*(.06+.21*Math.sin(Math.PI*t))*(.76+.28*random())
        const tip=a.clone().addScaledVector(side,sign*span).addScaledVector(axis,span*(.43+.39*t)).addScaledVector(up,span*(.16-.38*t))
        const mid=a.clone().lerp(tip,.46).addScaledVector(up,span*.16),width=span*(.16+.035*random())
        const i=vertex(ferns,a,t,tint,.61,heading)
        vertex(ferns,p.copy(mid).addScaledVector(axis,-width),t,tint,.81,heading)
        vertex(ferns,p.copy(mid).addScaledVector(axis,width),t,tint,.90,heading)
        vertex(ferns,tip,t,tint,.99,heading)
        ferns.ix.push(i,i+2,i+1,i+1,i+2,i+3)
      }
    }
    roots.push(origin);fronds++
  }
  for(let row=0;row<24;row++)for(let col=0;col<39;col++){
    const x=(col+.24+.52*random())/39,y=.252+(row+.15+.7*random())*.0255
    const region=regions.find(r=>inside(x,y,r.polygon))
    if(!region||random()>coverAt(x,y)*.82)continue
    uv.set(x*2-1,1-y*2);ray.setFromCamera(uv,camera)
    const hit=groundHit(ray.ray)
    if(!hit||hit.point.z>1||hit.point.z< -12.5)continue
    const stone=ray.intersectObjects(obstacles,false)[0]
    if(stone&&stone.distance<hit.distance+.025)continue
    const center=hit.point,radius=.10+.25*random()*random(),foreground=bounded((center.z+2.6)/2.4)
    if(deskClearance(center.x,center.z)<.16+radius*.45||random()<foreground*.48)continue
    // World-space spacing leaves soil between unequal communities, including at
    // the foreground shoulders. Screen sampling only defines their broad extent.
    if(anchors.some(a=>Math.hypot(center.x-a.world[0],center.z-a.world[2])<(radius+a.radius)*.77))continue
    anchors.push({screen:[x,y],world:center.toArray(),radius,region:region.name})
    const count=14+Math.floor(20*random()),heading=random()*6.28,stretch=.55+.40*random()
    const stature=(.72+.53*random())*(1.-foreground*.36)
    for(let tuft=0;tuft<count;tuft++){
      const angle=random()*6.28,radial=Math.sqrt(random()),r=radius*radial
      if(random()<radial*radial*.70)continue
      const u=r*Math.cos(angle),v=r*Math.sin(angle)*stretch
      const px=center.x+u*Math.cos(heading)-v*Math.sin(heading),pz=center.z+u*Math.sin(heading)+v*Math.cos(heading)
      if(deskClearance(px,pz)<.14)continue
      point.set(px,ground(px,pz),pz).applyMatrix4(projection)
      if(random()>coverAt((point.x+1)*.5,(1-point.y)*.5))continue
      const height=(.038+.073*random()*random())*stature*(random()<.055?1.6:1.)
      for(let leaf=0;leaf<4;leaf++)blade(px+(random()-.5)*.012,pz+(random()-.5)*.012,height*(.65+.48*random()),heading+(random()-.5)*5.5)
    }
    if(random()<.25&&center.z< -1.65){
      const size=.11+.13*random()
      for(let f=0;f<4;f++)fern(center.x+(random()-.5)*.045,center.z+(random()-.5)*.045,size*(.64+.36*random()),f*1.57+heading)
    }
  }
  // Broad, low woodland patches close the empty shoulders with silhouettes,
  // rather than more fine grass. All geometry remains attached to world ground.
  const protectedPath=(v:Vector3)=>{
    point.copy(v).applyMatrix4(projection)
    const x=(point.x+1)*.5,y=(1-point.y)*.5
    const t=bounded((y-.24)/.28),center=.455+.035*t,half=.018+.080*t*t
    return y>.19&&y<.56&&Math.abs(x-center)<half
  }
  function broadLeaf(x:number,z:number,length:number,heading:number){
    const data=z< -3.5?fernFar:fernNear,base=new Vector3(x,ground(x,z)-.005,z)
    const axis=new Vector3(Math.cos(heading),0,Math.sin(heading)),side=new Vector3(-axis.z,0,axis.x)
    const tip=base.clone().addScaledVector(axis,length),mid=base.clone().addScaledVector(axis,length*.43)
    tip.y=ground(tip.x,tip.z)+.014+random()*.035
    mid.y=Math.max(ground(mid.x,mid.z)+.018,base.y+length*(.20+.16*random()))
    const width=length*(.13+.10*random()),left=mid.clone().addScaledVector(side,-width),right=mid.clone().addScaledVector(side,width)
    left.y=Math.max(left.y,ground(left.x,left.z)+.009);right.y=Math.max(right.y,ground(right.x,right.z)+.009)
    if([base,left,right,tip].some(protectedPath))return
    const tint=new Color([0x344827,0x46552d,0x526331,0x3a5128,0x62663a][understoryLeaves%5])
    const i=vertex(data,base,0,tint,.55,heading,.004)
    vertex(data,left,.45,tint,.86,heading,.004);vertex(data,right,.45,tint,.94,heading,.004)
    vertex(data,tip,1,tint,.82,heading,.004);data.ix.push(i,i+2,i+1,i+1,i+2,i+3)
    roots.push(base);understoryLeaves++
  }
  function shoulderFern(x:number,z:number,size:number,heading:number){
    const data=z< -3.5?fernFar:fernNear,start=data.p.length,indexStart=data.ix.length,rootStart=roots.length
    fern(x,z,size,heading)
    for(let i=start;i<data.p.length;i+=3){
      if(!protectedPath(p.fromArray(data.p,i)))continue
      data.p.length=start;data.c.length=start;data.ix.length=indexStart
      data.bend.length=start/3;data.phase.length=start/3;roots.length=rootStart;fronds--;return
    }
  }
  const shoulderSpots=[
    [.30,.235,.48],[.355,.245,.43],[.386,.275,.34],[.345,.302,.39],
    [.53,.202,.46],[.59,.218,.52],[.55,.243,.45],[.62,.254,.47],[.57,.281,.38],
    [.63,.307,.36],[.67,.343,.33],[.735,.343,.31],[.81,.355,.32],[.88,.345,.36],
    [.65,.391,.32],[.72,.425,.29],[.84,.438,.32],[.94,.410,.36],
    [.30,.385,.30],[.345,.428,.26],[.25,.473,.25],
  ] as const
  const downRay=new Raycaster();downRay.ray.direction.set(0,-1,0)
  for(const [x,y,radius] of shoulderSpots){
    ray.setFromCamera(uv.set(x*2-1,1-y*2),camera)
    const hit=groundHit(ray.ray)
    if(!hit||hit.point.z> -1.5||hit.point.z< -13)continue
    const stone=ray.intersectObjects(obstacles,false)[0]
    if(stone&&stone.distance<hit.distance+.025)continue
    const center=hit.point
    understorySites.push({screen:[x,y],world:center.toArray(),radius})
    for(let clump=0;clump<6;clump++){
      const a=random()*6.28,r=radius*Math.sqrt(random()),px=center.x+Math.cos(a)*r,pz=center.z+Math.sin(a)*r
      const py=ground(px,pz)
      downRay.ray.origin.set(px,8,pz)
      const rock=downRay.intersectObjects(obstacles,false)[0]
      if(rock&&rock.point.y>py+.035)continue
      const heading=random()*6.28,length=.085+.14*random()
      for(let leaf=0;leaf<6;leaf++)broadLeaf(px+(random()-.5)*.04,pz+(random()-.5)*.04,length*(.65+.55*random()),heading+leaf*1.05)
      // One larger fern per two low patches, with unequal frond lengths.
      if(clump%2===0)for(let f=0;f<5;f++)shoulderFern(px,pz,(.25+.20*random())*(.72+.30*random()),heading+f*1.26)
    }
  }
  const resources:{geometry:BufferGeometry;material:MeshStandardMaterial}[]=[]
  for(const [name,data] of batches){
    const geometry=new BufferGeometry()
    for(const [key,values,size] of [['position',data.p,3],['color',data.c,3],['_bend',data.bend,1],['_phase',data.phase,1]] as const)
      geometry.setAttribute(key,new Float32BufferAttribute(values,size))
    geometry.setIndex(data.ix);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.94})
    const mesh=new Mesh(geometry,material);mesh.name=name;mesh.userData.wind=true;root.add(mesh);resources.push({geometry,material})
  }
  // Measure root burial against actual mesh triangles, not just the height function.
  const burial:number[]=[];ray.ray.direction.set(0,-1,0)
  for(let i=0;i<roots.length;i+=Math.max(1,Math.floor(roots.length/160))){
    const rootPoint=roots[i];ray.ray.origin.set(rootPoint.x,8,rootPoint.z)
    const hit=localHit(ray.ray,rootPoint.x,rootPoint.z)
    if(hit)burial.push(rootPoint.y-hit.point.y)
  }
  const heights=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,min:sorted[0],median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted[sorted.length-1]}}
  const report={anchors:anchors.length,blades,fronds,understoryLeaves,understorySites,triangles:batches.reduce((sum,[,data])=>sum+data.ix.length/3,0),
    meshes:batches.map(([name,data])=>({name,triangles:data.ix.length/3,vertices:data.p.length/3})),
    patchDiameter:{min:Math.min(...anchors.map(a=>a.radius*2)),max:Math.max(...anchors.map(a=>a.radius*2))},
    bladeHeight:heights(bladeHeights),foregroundBladeHeight:heights(frontHeights),minimumDeskClearance:Math.min(...clearances),
    burial:{samples:burial.length,min:Math.min(...burial),max:Math.max(...burial),mean:burial.reduce((a,b)=>a+b,0)/burial.length},
    regions:regions.map(r=>({name:r.name,screenPolygon:r.polygon,count:anchors.filter(a=>a.region===r.name).length,
      examples:anchors.filter(a=>a.region===r.name).filter((_,i)=>i%36===0)}))}
  root.userData.bambooBankPlanting=report
  const turn=bambooTurn(root,ground,camera,(x,y)=>{ray.setFromCamera(uv.set(x*2-1,1-y*2),camera);return groundHit(ray.ray)?.point})
  return {report,turn,dispose:()=>{turn.dispose();resources.forEach(r=>{r.geometry.dispose();r.material.dispose()})}}
}
