import {Color,Float32BufferAttribute,IcosahedronGeometry,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Object3D,Vector3,type Texture} from 'three'
import {filterWoodlandSun} from './CanopyLight.ts'
import {creekUnderstory} from './CreekUnderstory.ts'
import {creekReflectedGrove} from './CreekReflectedGrove.ts'
import {creekMarginDeposits,creekMarginFlow} from './CreekShallows.ts'
import {creekBeforeFarHeight} from './CreekFarShore.ts'
import {creekContactBand} from './CreekContactBand.ts'
import type {HeightAt} from './terrain-height'

type Placement={matrix:Matrix4;tint:Color}

// These are world-space plants and stones following the loaded channel, including
// its bend. No camera-facing planes or reference image are used for the bank.
export function creekBankGrowth(root:Object3D,ground:HeightAt,level:number,openings:Texture,time:{value:number},kit:Object3D,garden:Object3D){
  const stream=root.getObjectByName('creek_surface')
  if(!(stream instanceof Mesh))return ()=>{}
  stream.updateWorldMatrix(true,false)
  const rows=new Map<number,{left:Vector3;right:Vector3}>(),p=new Vector3()
  const {uv,position}=stream.geometry.attributes
  for(let i=0;i<position.count;i++){
    const u=uv.getX(i)
    if(u>.001&&u<.999)continue
    const v=uv.getY(i),row=rows.get(v)??{left:new Vector3(),right:new Vector3()}
    p.fromBufferAttribute(position,i).applyMatrix4(stream.matrixWorld)
    row[u<.5?'left':'right'].copy(p);rows.set(v,row)
  }
  const authoredRows=stream.userData.creekPlantingRows as {left:number[];right:number[]}[]|undefined
  const sections=(authoredRows?authoredRows.map(r=>({left:new Vector3().fromArray(r.left),right:new Vector3().fromArray(r.right)})):[...rows.values()]).filter(({left,right})=>{
    const x=(left.x+right.x)*.5,z=(left.z+right.z)*.5
    return x>-6.8&&x<6.1&&z>-11&&z<-2
  })
  let seed=184639
  const pick=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const gravel:Placement[]=[]
  const cobbles:Placement[]=[],chips:Placement[]=[],barStones:{x:number;z:number;radius:number}[]=[]
  const farStones:Placement[]=[]
  const pivot=new Object3D(),normal=new Vector3(),up=new Vector3(0,1,0)
  const minerals=[0x927542,0x856944,0xa58b59,0x6a7057,0x98784d,0x5c6654,0xae9867]
  function save(list:Placement[],colour:number,shade=1){
    pivot.updateMatrix();list.push({matrix:pivot.matrix.clone(),tint:new Color(colour).multiplyScalar(shade)})
  }
  const bank=root.getObjectByName('root_bank_soil'),scatterGround=bank instanceof Mesh?creekBeforeFarHeight(bank)??ground:ground
  const planting=creekUnderstory(root,kit,garden,ground,sections,level,openings,time,scatterGround)
  const releaseContact=creekContactBand(root,kit,ground,sections,level,openings,time)
  const releaseGrove=creekReflectedGrove(root)
  const legacyBar=root.getObjectByName('submerged_stream_pebbles'),legacyShown=legacyBar?.visible
  if(legacyBar)legacyBar.visible=false
  // A denser near-bank gravel bar grades to isolated deeper stones. Reject dry
  // ground and buried crowns, so each accepted pebble is genuinely under water.
  const occupied=new Set<string>()
  for(let i=0;i<4200&&sections.length;i++){
    const row=sections[Math.floor(pick()*sections.length)]
    const side=pick()<.90?.59+.39*pick():.12+.26*pick()
    p.copy(row.left).lerp(row.right,side);p.x+=(pick()-.5)*.16;p.z+=(pick()-.5)*.16
    const y=ground(p.x,p.z),depth=level-scatterGround(p.x,p.z),key=Math.floor(p.x/.075)+','+Math.floor(p.z/.075)
    if(depth<.026||depth>.32||occupied.has(key))continue
    const radius=Math.max(0,Math.min(.014+.045*pick()**.85,depth*.90,(level-y)*.90)),height=radius*(.31+.21*pick())
    occupied.add(key)
    pivot.position.set(p.x,y+height*.14,p.z);pivot.rotation.set(pick()*.24,pick()*6.28,pick()*.18)
    pivot.scale.set(radius,height,radius*(.68+.31*pick()))
    const mineral=minerals[Math.floor(pick()*minerals.length)],shade=.68+.27*pick()
    if(level-y>=.026)save(gravel,mineral,shade)
  }
  // Two physical scales share the existing smooth low-poly pebble template.
  // Larger stones interrupt the current; chips fill gaps and are occluded by
  // their neighbours in the world-depth atlas instead of a painted gravel layer.
  for(const small of [false,true])for(const bar of creekMarginDeposits){
    for(let i=0;i<(small?230:110);i++){
      const angle=pick()*Math.PI*2,r=Math.sqrt(pick())*.90,u=Math.cos(angle)*r*bar.length,v=Math.sin(angle)*r*bar.width
      const x=bar.x+creekMarginFlow.x*u-creekMarginFlow.z*v,z=bar.z+creekMarginFlow.z*u+creekMarginFlow.x*v
      const y=ground(x,z),depth=level-y,radius=small?.014+.025*pick():.046+.045*pick()
      if(depth<.10||depth>.30||barStones.some(stone=>Math.hypot(x-stone.x,z-stone.z)<(stone.radius+radius)*(small?.83:.91)))continue
      const height=radius*(small?.34+.16*pick():.32+.14*pick())
      normal.set((ground(x-.035,z)-ground(x+.035,z))/.07,1,(ground(x,z-.035)-ground(x,z+.035))/.07).normalize()
      if(normal.y<(small?.65:.80)||radius*Math.sqrt(1-normal.y*normal.y)+height*1.2>=depth-.012)continue
      pivot.position.set(x,y+height*.17,z)
      pivot.quaternion.setFromUnitVectors(up,normal)
      pivot.rotateY(Math.atan2(creekMarginFlow.x,creekMarginFlow.z)+(pick()-.5)*.65)
      pivot.scale.set(radius*(.66+.17*pick()),height,radius)
      save(small?chips:cobbles,[0x8a8067,0x92744f,0x76745f,0xa68a5b,0x666b5b][Math.floor(pick()*5)],.82+.20*pick())
      barStones.push({x,z,radius})
    }
  }
  const shorePatches=root.getObjectByName('root_bank_soil')?.userData.creekFarShore?.patches as {x:number;z:number;nx:number;nz:number;actualShift:number}[]|undefined
  shorePatches?.forEach((shore,index)=>{
    for(let i=0;i<(index===1||index===3?2:1);i++){
      const along=(pick()-.5)*.30,inward=shore.actualShift+.035+.06*pick()
      const x=shore.x+shore.nx*inward-shore.nz*along,z=shore.z+shore.nz*inward+shore.nx*along,y=ground(x,z)
      const radius=.075+.065*pick(),height=radius*(.38+.25*pick())
      normal.set((ground(x-.035,z)-ground(x+.035,z))/.07,1,(ground(x,z-.035)-ground(x,z+.035))/.07).normalize()
      pivot.position.set(x,y-height*.12,z);pivot.quaternion.setFromUnitVectors(up,normal);pivot.rotateY(pick()*Math.PI*2)
      pivot.scale.set(radius*(.73+.25*pick()),height,radius)
      save(farStones,[0x4c4a37,0x5a4d35,0x535442,0x605a43][Math.floor(pick()*4)],.78+.13*pick())
    }
  })
  const gravelMaterial=new MeshStandardMaterial({roughness:.91,vertexColors:true,envMapIntensity:.34})
  const farStoneMaterial=new MeshStandardMaterial({roughness:.52,vertexColors:true,envMapIntensity:.36})
  for(const material of [gravelMaterial,farStoneMaterial])
    filterWoodlandSun(material,openings,'creek',false,false,null,false,time)
  const pebble=new IcosahedronGeometry(1,1),pos=pebble.attributes.position,colours:number[]=[]
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),relief=.055*Math.sin(x*5+z*3)*Math.cos(y*4)
    pos.setXYZ(i,x*(1+relief)+.05*y,y*(1+relief*.4),z*(1-relief)-.04*x*x)
    const shade=.77+.15*(y+1)*.5+.07*Math.sin(x*7.5+z*8.1)
    colours.push(shade,shade*.98,shade*.94)
  }
  // The stock icosphere has smooth shared-direction normals. Recomputing the
  // normals on its unindexed triangles would turn each pebble into a faceted ball.
  pebble.setAttribute('color',new Float32BufferAttribute(colours,3))
  const meshes:InstancedMesh[]=[]
  for(const [name,geometry,material,placements,shadow] of [
    ['creek_shallow_mineral_bar',pebble,gravelMaterial,gravel,false],
    ['creek_margin_cobbles',pebble,gravelMaterial,cobbles,true],
    ['creek_margin_chips',pebble,gravelMaterial,chips,false],
    ['creek_far_shore_stones',pebble,farStoneMaterial,farStones,true],
  ] as const){
    const mesh=new InstancedMesh(geometry,material,placements.length)
    placements.forEach(({matrix,tint},i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,tint)})
    mesh.name=name;mesh.userData.liveCreekBank=true;mesh.receiveShadow=true;mesh.castShadow=shadow;mesh.raycast=()=>{}
    mesh.computeBoundingSphere();root.add(mesh);meshes.push(mesh)
  }
  root.userData.creekBankGrowth={plants:planting.planted,prototypes:planting.counts,farBankPlants:planting.farBankPlants,nearBankPlants:planting.nearBankPlants,syntheticRoots:0,stones:0,gravel:gravel.length,marginCobbles:cobbles.length,marginChips:chips.length,farShoreStones:farStones.length}
  return ()=>{
    planting.dispose()
    releaseContact()
    releaseGrove()
    if(legacyBar)legacyBar.visible=legacyShown!
    for(const mesh of meshes){mesh.removeFromParent();mesh.dispose()}
    pebble.dispose()
    for(const material of [gravelMaterial,farStoneMaterial])material.dispose()
  }
}
