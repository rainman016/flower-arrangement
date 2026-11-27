import { Box3, CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, TubeGeometry, Vector3 } from 'three'
import { stockLength, nodeHeight, flowerParts, flowerDetails, sectionableDetail } from '../../content/catalog'
import { sectionEnd } from '../../game/free-cut'
import type { FlowerState } from '../../game/types'
import { stemPoint } from '../objects/BotanicalStem'
import { prepareSection } from './detail-section'
import { sliceY } from './clip-geometry'
import { foxtail, seedPanicle } from './grass-heads'
import { specimen } from '../../content/specimens'
import { specimenLeaf, specimenHead } from './specimen-geometry'
import { wildflowerHead } from './wildflower-head'

const stemMaterial=new MeshStandardMaterial({color:'#566638',roughness:.76})
const calyxMaterial=new MeshStandardMaterial({color:'#798047',roughness:.88})
const budMaterial=new MeshStandardMaterial({color:'#c19238',roughness:.74})
function bake(object:Object3D):Group {
  object.updateMatrixWorld(true)
  const result=new Group()
  object.traverse(child=>{
    if(!(child instanceof Mesh)||!child.visible)return
    const mesh=new Mesh(child.geometry.clone().applyMatrix4(child.matrixWorld),child.material)
    mesh.castShadow=true;mesh.receiveShadow=true;result.add(mesh)
  })
  return result
}
function model(kit:Object3D,name:string):Group {
  const source=kit.getObjectByName(name)
  if(!source)throw Error('缺少花材模型：'+name)
  const object=source.clone(true);object.position.set(0,0,0)
  return bake(object)
}
function leaf(kit:Object3D,kind:FlowerState['kind']):Group {
  const profile=specimen(kind)
  if(profile)return specimenLeaf(profile)
  const object=model(kit,kind==='grass'?'flower_grass_leaf':'flower_leaf')
  const box=new Box3().setFromObject(object),size=box.getSize(new Vector3())
  // The leaf asset has its petiole at local X/Z zero. Keep that point on the node.
  object.position.y=-box.min.y
  const root=new Group();root.add(object)
  const length=.067/Math.max(.001,size.y)
  root.scale.set(length*(kind==='grass'?.86:kind==='yellow'?1.02:.83),length,length)
  const normalized=bake(root);disposeGeometry(object)
  return normalized
}
function clipped(object:Group,from:number,to:number):Group {
  const result=new Group()
  object.traverse(child=>{
    if(!(child instanceof Mesh))return
    const geometry=sliceY(child.geometry,from,to)
    if(!geometry.getAttribute('position').count){geometry.dispose();return}
    const mesh=new Mesh(geometry,child.material);mesh.castShadow=true;mesh.receiveShadow=true;result.add(mesh)
  })
  disposeGeometry(object);return result
}
function cylinder(length:number,radius:number):Group {
  const geometry=new CylinderGeometry(radius*.75,radius,length,10,1,false);geometry.translate(0,length/2,0)
  const root=new Group();root.add(new Mesh(geometry,stemMaterial));return root
}
function sprig(root:Group,start:Vector3,end:Vector3,radius:number){
  const middle=start.clone().lerp(end,.51)
  middle.y+=.003
  const line=new CatmullRomCurve3([start,middle,end])
  root.add(new Mesh(new TubeGeometry(line,7,radius,6,false),stemMaterial))
}
function bud(point:Vector3,scale:number){
  const root=new Group(),calyx=new Mesh(new SphereGeometry(.0034,10,7),calyxMaterial)
  calyx.scale.set(.89,1.18,.89);root.add(calyx)
  const petals=new Mesh(new SphereGeometry(.00245,10,7),budMaterial)
  petals.scale.y=.87;petals.position.y=.0026;root.add(petals)
  root.position.copy(point);root.scale.setScalar(scale);return root
}
function tip(f:FlowerState,point:Vector3,scale:number,angle:number){
  const profile=specimen(f.kind)
  const head=profile?specimenHead(profile):wildflowerHead(f.kind==='white'||f.kind==='daisy',f.kind==='daisy')
  head.position.copy(point)
  head.scale.setScalar(scale*(f.headScale??1))
  head.rotation.order='YXZ'
  const pitch=f.kind==='yellow'?-.11:.50
  head.rotation.set(pitch,.44+.75*angle,.12*Math.sin(angle))
  return head
}
function crown(f:FlowerState){
  const root=new Group()
  if(f.kind==='grass'){const head=foxtail();head.scale.multiplyScalar(f.headScale??1);root.add(head);return root}
  root.add(tip(f,new Vector3(),1,.25))
  return root
}
function fullStem(flower:FlowerState):Group {
  const length=stockLength(flower),offset=length-flower.length,base=stemPoint(offset,length)
  const curve=new CatmullRomCurve3(Array.from({length:41},(_,i)=>stemPoint(length*i/40,length)))
  const radius=flower.kind==='grass'?.00091:flower.kind==='yellow'?.00127:.00110
  const tube=new TubeGeometry(curve,72,radius,8,false),root=new Group()
  const points=tube.getAttribute('position'),vertex=new Vector3()
  for(let ring=0;ring<=72;ring++){
    const t=ring/72,axis=curve.getPointAt(t),taper=1-.36*t
    for(let side=0;side<=8;side++){
      const i=ring*9+side
      vertex.fromBufferAttribute(points,i).sub(axis).multiplyScalar(taper).add(axis)
      points.setXYZ(i,vertex.x,vertex.y,vertex.z)
    }
  }
  tube.computeVertexNormals()
  const sliced=sliceY(tube,offset,length);tube.dispose();sliced.translate(-base.x,-base.y,-base.z)
  root.add(new Mesh(sliced,stemMaterial));return root
}
export function partAnchor(f:FlowerState,id:string) {
  const base=stemPoint(stockLength(f)-f.length,stockLength(f))
  return stemPoint(nodeHeight(f,flowerParts(f).find(p=>p.id===id)!.height),stockLength(f)).sub(base)
}
// Keep a leaf or blossom attached at its own petiole when the parent shaft is shortened.
function addDetail(parent:Group,f:FlowerState,id:string,at:number,anchor:Vector3,items:Object3D[]){
  if(f.removed.includes(id)){
    for(const item of items){item.removeFromParent();disposeGeometry(item)}
    return
  }
  const group=new Group()
  group.name='part-'+id
  group.position.copy(anchor)
  group.userData={target:id,extent:0,branchAttachment:at,detail:true}
  for(const item of items){item.position.sub(anchor);group.add(item)}
  if(sectionableDetail(f.kind,id))prepareSection(group,f,id)
  parent.add(group)
}
function part(kit:Object3D,f:FlowerState,id:string,from:number,to:number):Group {
  const root=new Group();root.name='part-'+id
  root.position.copy(partAnchor(f,id))
  if(id==='crown-branch'){
    const stock=stockLength(f)
    const delta=stemPoint(stock,stock).add(new Vector3(.019,-.012,.002)).sub(stemPoint(stock-.040,stock))
    const length=delta.length(),up=new Vector3(0,1,0)
    root.quaternion.setFromUnitVectors(up,delta.clone().normalize())
    const inverse=root.quaternion.clone().invert(),shaft=new Group()
    sprig(shaft,new Vector3(),delta,.00049)
    ;(shaft.children[0] as Mesh).geometry.applyQuaternion(inverse)
    root.userData={target:id,extent:length}
    root.add(clipped(shaft,from*length,to*length))
    if(to===1){
      const flower=tip(f,new Vector3(0,length,0),.93,-.72)
      flower.quaternion.premultiply(inverse);addDetail(root,f,'upper-bloom',1,flower.position.clone(),[flower])
    }
    return root
  }
  const turn=f.kind==='white'?-.99:f.kind==='grass'?.03:.55
  root.rotation.order='YXZ'
  root.rotation.set(0,turn+(id==='branch-0'?0:id==='leaf-0'?-.72:.97)+(f.slot%3-1)*.10,
    id==='branch-0'?(f.kind==='grass'?.147:f.kind==='yellow'?.45:-.91):id==='leaf-1'?-.38:.20)
  const branchLength=f.kind==='grass'?.109:f.kind==='yellow'?.064:.031
  const leafLength=id==='leaf-0'?.035:.068
  root.userData={target:id,extent:id==='branch-0'?branchLength:leafLength}
  if(id==='branch-0'){
    root.add(clipped(cylinder(branchLength,.00076),from*branchLength,to*branchLength))
    const nodes=f.kind==='grass'?[.23,.56]:[.19,.43,.66]
    nodes.forEach((at,i)=>{
      if(at<from||at>=to)return
      const anchor=new Vector3(0,at*branchLength,0)
      const foliage=leaf(kit,f.kind);foliage.position.y=at*branchLength
      foliage.rotation.set(.13+i*.15,i*2.40+.31,(i%2?-.62:.58))
      foliage.scale.setScalar((f.kind==='grass'?.64:.50)-i*.095);addDetail(root,f,'side-leaf-'+i,at,anchor,[foliage])
      if(f.kind==='grass'&&i===0){
        const start=new Vector3(0,at*branchLength,0),end=start.clone().add(new Vector3(.086,.054,-.013))
        const twig=new Group();sprig(twig,start,end,.00047)
        const panicle=seedPanicle();panicle.position.copy(end);panicle.rotation.z=-.56;panicle.scale.setScalar(.73*(f.headScale??1));addDetail(root,f,'side-panicle',at,start,[twig,panicle])
      }
      if(at===.66){
        const start=new Vector3(0,at*branchLength,0),end=start.clone().add(new Vector3(-.012,.013,.006))
        const twig=new Group();sprig(twig,start,end,.00050)
        const profile=specimen(f.kind)
        const young=profile?specimenLeaf(profile):bud(end,.56)
        if(profile){young.position.copy(end);young.scale.setScalar(.23)}
        addDetail(root,f,'side-bud',at,start,[twig,young])
      }
    })
    if(to===1){
      const end=new Vector3(0,branchLength,0)
      if(f.kind==='grass'){const panicle=seedPanicle();panicle.position.copy(end);panicle.scale.multiplyScalar(f.headScale??1);root.add(panicle)}
      else root.add(tip(f,end,f.kind==='yellow'?.87:.72,-.63))
      addDetail(root,f,'side-bloom',1,end,[root.children.at(-1)!])
    }
  }else{
    const foliage=leaf(kit,f.kind);foliage.position.y=.008
    foliage.scale.x=id==='leaf-0'?1.16:.90
    foliage.rotation.y=id==='leaf-0'?-.18:.30
    const complete=new Group();complete.add(cylinder(.014,.00065),foliage)
    complete.scale.setScalar(leafLength/.077)
    const flat=bake(complete);disposeGeometry(complete)
    root.add(clipped(flat,from*leafLength,to*leafLength))
  }
  return root
}
export function createPlant(kit:Object3D,f:FlowerState):Group {
  const root=new Group();root.name='botanical-'+f.id
  const stem=fullStem(f);stem.name='part-stem';stem.userData={target:'stem',extent:f.length,originalLength:stockLength(f)};root.add(stem)
  const original=stockLength(f),base=stemPoint(original-f.length,original)
  const head=crown(f);head.name='flower-crown';head.position.copy(stemPoint(original,original).sub(base));root.add(head)
  for(const p of flowerParts(f))if(!f.removed.includes(p.id)&&nodeHeight(f,p.height)-(original-f.length)>=-1e-8&&sectionEnd(f,p.id)>0)root.add(part(kit,f,p.id,0,sectionEnd(f,p.id)))
  root.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true}})
  return root
}
/** Rebuild the exact removed connected section from its immutable pre-cut snapshot. */
export function createPiece(kit:Object3D,f:FlowerState,target:string,from:number,to:number):Group {
  const root=new Group()
  if(target==='stem'){
    root.add(clipped(fullStem(f),from,to))
    for(const p of flowerParts(f)){
      const height=nodeHeight(f,p.height)-(stockLength(f)-f.length)
      if(height>=from-1e-8&&height<to-1e-8&&!f.removed.includes(p.id)&&sectionEnd(f,p.id)>0)root.add(part(kit,f,p.id,0,sectionEnd(f,p.id)))
    }
  }else{
    const detail=flowerDetails(f).find(d=>d.id===target)
    if(detail){
      const parent=flowerDetails(f).find(d=>d.id===detail.parent)?.parent??detail.parent
      // Rebuild from the pre-cut specimen. Preserve all previous cuts on siblings.
      const branch=part(kit,f,parent,0,sectionEnd(f,parent))
      const selected=branch.getObjectByName('part-'+target)!
      branch.updateMatrixWorld(true)
      root.attach(selected);disposeGeometry(branch)
      if(from>0){
        const low=from*selected.userData.extent
        for(const child of [...selected.children]){
          if(child.userData.branchAttachment!==undefined){
            if(child.userData.branchAttachment<from){selected.remove(child);disposeGeometry(child)}
          }else if(child instanceof Mesh){
            const original=child.geometry;child.geometry=sliceY(original,low,Infinity);original.dispose()
          }
        }
      }
    }else root.add(part(kit,f,target,from,to))
  }
  root.updateMatrixWorld(true)
  return root
}
export function centerObject(root:Group):Vector3 {
  const center=new Box3().setFromObject(root).getCenter(new Vector3())
  root.children.forEach(c=>c.position.sub(center));root.updateMatrixWorld(true);return center
}
export function disposeGeometry(root:Object3D) {
  const geometries=new Set<Mesh['geometry']>()
  root.traverse(o=>{if(o instanceof Mesh)geometries.add(o.geometry)})
  geometries.forEach(g=>g.dispose())
}
