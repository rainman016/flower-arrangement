import {Box3,Matrix4,Mesh,Object3D,Vector3} from 'three'
import type {HeightAt} from './terrain-height'

/** Continue the authored grove around the player with the same rooted prototypes. */
export function bambooSurround(root:Object3D,ground:HeightAt,kit?:Object3D){
  const footprints=new Map<string,{width:number;height:number;base:number}>()
  for(const kind of ['fern','ground_herb_0','ground_herb_1','sedge_0','understory']){
    let source=kind==='fern'?kit?.getObjectByName('forest_fern_0'):undefined
    if(!source)root.traverse(node=>{if(node.userData.gardenPrototype===kind)source=node})
    if(!source)continue
    source.updateWorldMatrix(true,true)
    const box=new Box3(),local=source.userData.gardenPrototype?source.matrixWorld.clone().invert():new Matrix4()
    source.traverse(node=>{if(node instanceof Mesh){node.geometry.computeBoundingBox();box.union(node.geometry.boundingBox!.clone().applyMatrix4(local.clone().multiply(node.matrixWorld)))}})
    if(!box.isEmpty()){const size=box.getSize(new Vector3());footprints.set(kind,{width:Math.max(.01,size.x,size.z),height:Math.max(.01,size.y),base:box.min.y})}
  }
  let seed=81731,planted=0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const add=(kind:string,x:number,z:number,width:number,height=width)=>{
    const plant=new Object3D();plant.name='bamboo_surround_'+planted++
    plant.userData.prototype=kind
    const footprint=footprints.get(kind),sx=footprint?width/footprint.width:width,sy=footprint?height/footprint.height:height
    plant.position.set(x,ground(x,z)-.028-(footprint?.base??0)*sy,z)
    plant.rotation.set((random()-.5)*.07,random()*Math.PI*2,(random()-.5)*.07)
    plant.scale.set(sx,sy,sx*(.83+random()*.30))
    root.add(plant);plant.updateMatrixWorld(true)
  }
  const herbs=['fern','ground_herb_0','ground_herb_1','sedge_0','understory']
  // A seated eye sees mostly the first few metres when turning sideways.
  // Low fronds soften the clearing edge without putting tall culms by the desk.
  for(const radius of [2.35,3.5]){
    const count=Math.round(Math.PI*2*radius/.85)
    for(let k=0;k<count;k++){
      const angle=(k+.2+random()*.55)/count*Math.PI*2
      if(Math.cos(angle)>.20)continue
      for(let j=0;j<4;j++){
        const a=angle+(random()-.5)*.27,r=radius+(random()-.5)*.65
        const x=Math.sin(a)*r,z=-Math.cos(a)*r,size=.80+random()*.40
        if(Math.hypot(x,z)<1.95)continue
        add(j%2===0?'fern':herbs[1+k%3],x,z,size,.24+random()*.16)
      }
    }
  }
  for(const [band,radius] of [4.7,7.8,11.4,16.2,21.8,27.3].entries()){
    const count=Math.round(Math.PI*2*radius/3.5)
    for(let k=0;k<count;k++){
      const angle=(k+.28+random()*.45)/count*Math.PI*2
      // Leave the agreed front composition intact. Side pockets overlap the
      // existing margins, while the rear is fully planted instead of bare hills.
      if(Math.cos(angle)>.48)continue
      const r=radius+(random()-.5)*1.65,x=Math.sin(angle)*r,z=-Math.cos(angle)*r
      add('grove_'+k%3,x,z,.62+random()*.24,.76+random()*.30)
      const offset=.70+random()*.55
      add('grove_'+(k+1)%3,x+Math.cos(angle)*offset,z+Math.sin(angle)*offset,
        .54+random()*.32,.24+random()*.29)
      const population=band<3?13:10
      for(let j=0;j<population;j++){
        const a=random()*Math.PI*2,d=Math.sqrt(random())*(band<2?1.85:2.50)
        const px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d
        if(Math.hypot(px,pz)<3.3)continue
        const size=.95+random()*.55
        add(herbs[(k+j)%herbs.length],px,pz,size,.29+random()*.27)
      }
    }
  }
  // Only the table-side strip is thinned. Keep the distinctive left fern clump
  // farther behind the table and preserve the ground cover around the player.
  let shortened=0,omitted=0
  const p=new Vector3()
  root.traverse(node=>{
    if(!/^(fern|understory|ground_herb_\d|sedge_\d)$/.test(node.userData.prototype??''))return
    node.getWorldPosition(p)
    if(node.name.startsWith('bamboo_surround_'))return
    if(p.z< -3.5||p.z>-.9||Math.abs(p.x)<1.15||Math.abs(p.x)>3.4||Math.hypot(p.x,p.z)>3.9)return
    const sample=Math.sin(p.x*24.71+p.z*13.13)*43758.5453
    const fraction=sample-Math.floor(sample),front=p.z> -2.35,fern=node.userData.prototype==='fern'
    if(front&&Math.abs(p.x)<2.1&&fraction<.42){node.userData.bambooOmit=true;omitted++;return}
    const width=fern?.84:front?.67:.81,height=fern?(p.x>0?.70:.82):front?.49:.66
    node.scale.multiply(new Vector3(width,height,width))
    if(front){
      const oldGround=ground(p.x,p.z)
      p.x+=Math.sign(p.x)*.07;p.z-=.13;p.y+=ground(p.x,p.z)-oldGround
      node.position.copy(node.parent!.worldToLocal(p))
    }
    node.updateMatrixWorld(true);shortened++
  })
  root.userData.bambooSurround={planted,shortened,omitted}
}

/** A clump can have several culm feet across a slope; anchor height alone is insufficient. */
export function seatBambooGroves(root:Object3D,ground:HeightAt){
  const prototypes=new Map<string,Object3D>(),p=new Vector3(),matrix=new Matrix4(),local=new Matrix4()
  root.traverse(node=>{if(String(node.userData.gardenPrototype??'').startsWith('grove_'))prototypes.set(node.userData.gardenPrototype,node)})
  const anchors:Object3D[]=[]
  root.traverse(node=>{if(String(node.userData.prototype??'').startsWith('grove_'))anchors.push(node)})
  let seated=0
  for(const anchor of anchors){
    anchor.getWorldPosition(p)
    if(Math.hypot(p.x,p.z)>25||(!anchor.name.startsWith('bamboo_surround_')&&p.z<0&&Math.abs(p.x)<4))continue
    const prototype=prototypes.get(anchor.userData.prototype);if(!prototype)continue
    const inverse=prototype.matrixWorld.clone().invert();let gap=-Infinity
    prototype.traverse(mesh=>{
      if(!(mesh instanceof Mesh)||!mesh.name.endsWith('_culm'))return
      const vertices=mesh.geometry.attributes.position
      mesh.geometry.computeBoundingBox();const base=mesh.geometry.boundingBox!.min.y+.07
      local.multiplyMatrices(inverse,mesh.matrixWorld);matrix.multiplyMatrices(anchor.matrixWorld,local)
      for(let i=0;i<vertices.count;i++)if(vertices.getY(i)<=base){
        p.fromBufferAttribute(vertices,i).applyMatrix4(matrix);gap=Math.max(gap,p.y-ground(p.x,p.z))
      }
    })
    if(gap>-.025){anchor.getWorldPosition(p);p.y-=gap+.025;anchor.position.copy(anchor.parent!.worldToLocal(p));anchor.updateMatrixWorld(true);seated++}
  }
  root.userData.bambooSeatedGroves=seated
}

/** Settle the actual scan footprint, including prototype transforms, into soil. */
export function seatBambooRocks(root:Object3D,kit:Object3D,ground:HeightAt,include:(anchor:Object3D)=>boolean=()=>true){
  const point=new Vector3(),world=new Matrix4(),stats:{kind:string;before:number;after:number}[]=[]
  for(const kind of ['rock','ledge']){
    const prototypes:Object3D[]=[]
    kit.traverse(node=>{if(new RegExp('^forest_'+kind+'_\\d+$').test(node.name))prototypes.push(node)})
    if(!prototypes.length)continue
    const anchors:Object3D[]=[]
    root.traverse(node=>{if(node.userData.prototype===kind&&include(node))anchors.push(node)})
    anchors.forEach((anchor,index)=>{
      const gaps:number[]=[]
      prototypes[index%prototypes.length].traverse(mesh=>{
        if(!(mesh instanceof Mesh))return
        world.multiplyMatrices(anchor.matrixWorld,mesh.matrixWorld)
        const positions=mesh.geometry.attributes.position,step=Math.max(1,Math.floor(positions.count/400))
        for(let i=0;i<positions.count;i+=step){
          point.fromBufferAttribute(positions,i).applyMatrix4(world)
          gaps.push(point.y-ground(point.x,point.z))
        }
      })
      if(!gaps.length)return
      gaps.sort((a,b)=>a-b)
      const before=gaps[Math.floor((gaps.length-1)*.12)],shift=Math.min(0,-.018-before)
      if(shift<-.001){
        anchor.getWorldPosition(point);point.y+=shift
        anchor.position.copy(anchor.parent!.worldToLocal(point));anchor.updateMatrixWorld(true)
      }
      stats.push({kind,before,after:before+shift})
    })
  }
  root.userData.bambooStoneContact=stats
}
