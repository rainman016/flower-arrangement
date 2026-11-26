import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { type BufferGeometry, type Object3D, Box3, Euler, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { cuttingEye, deskView, propRotation, startGrab, beginTableCarry, moveOnTable, type TableCarry, turnGrab, restOnDesk, deskHit, localBounds, type Grab } from './desk-space'
import { useCoreStore } from '../../state/core-store'
import { BOX, DESK, inBox } from '../../game/desk-layout'
import { restFlower } from './flower-rest'
import type { Quat, Vec3 } from '../../game/types'
import { coreFlowerPose } from './core-transforms'
import type { CoreWorld } from './CoreCanvas'
import { createLooseFlowerPicker } from './loose-flower-picker'
import {arrivalFraming} from '../arrival-framing'

const up=new Vector3(0,1,0)
const smooth=(n:number)=>n*n*(3-2*n)
const state=useCoreStore.getState
type Prop='vase'|'scissors'|'cup'
type Hand={id:string;root:Group;grab:Grab;grip:Vector3;carry?:TableCarry}
type Motion=Hand&{pointer:number;x:number;y:number;lastX:number;lastY:number;moved:boolean;rotate:boolean}
// Integrate the opening ramp so the final transfer agrees with the animated water level.
export function pouredMl(elapsedMs:number){
  const ms=Math.max(0,elapsedMs-100),ramp=140
  return .012*(ms<ramp?ms*ms/(2*ramp):ms-ramp/2)
}
const isTool=(id:string):id is Prop=>id==='cup'||id==='scissors'||id==='vase'
// The clipped stem mesh also contains the bending applied when it rests on the table.
const stemLines=new WeakMap<BufferGeometry,Vector3[]>()
function stemLine(geometry:BufferGeometry){
  const cached=stemLines.get(geometry)
  if(cached)return cached
  geometry.computeBoundingBox()
  const {min,max}=geometry.boundingBox!,vertices=geometry.getAttribute('position')
  const points=Array.from({length:32},()=>new Vector3()),counts=points.map(()=>0),v=new Vector3()
  for(let i=0;i<vertices.count;i++){
    v.fromBufferAttribute(vertices,i)
    const band=Math.min(31,Math.floor((v.y-min.y)*32/Math.max(.0001,max.y-min.y)))
    points[band].add(v);counts[band]++
  }
  const line=points.flatMap((p,i)=>counts[i]?[p.multiplyScalar(1/counts[i])]:[])
  stemLines.set(geometry,line);return line
}
function carryContents(world:CoreWorld,prop:string){
  if(prop!=='cup'&&prop!=='vase')return
  const s=state(),w=s.history.present,root=world[prop],tool=w.tools
  if(!root||!tool)return
  const resting=prop==='vase'?new Vector3(w.vase.x,tool.vaseY,w.vase.z-.025):new Vector3(...tool.cup)
  const delta=root.quaternion.clone().multiply(propRotation(w,prop).invert())
  for(const f of w.flowers)if(f.location===prop&&s.heldId!==f.id){
    const stem=world.flowers.get(f.id),p=coreFlowerPose(f,w,false)
    if(stem){stem.position.copy(p.position).sub(resting).applyQuaternion(delta).add(root.position);stem.quaternion.copy(p.quaternion).premultiply(delta)}
  }
}
// The pointer controls x/z immediately while the cup finishes its short vertical lift or landing.
type CupLift={from:number;to:number;start:number;duration:number}
function cupHeight(lift:CupLift,now:number){
  const t=Math.min(1,Math.max(0,(now-lift.start)/lift.duration))
  return lift.to+(lift.from-lift.to)*(1-smooth(t))
}
export default function RitualControls({world}:{world:CoreWorld}){
  const {camera,gl,invalidate,size}=useThree()
  const view=useMemo(()=>deskView(size.width,size.height),[size.width,size.height])
  const arrival=useMemo(()=>arrivalFraming(size.width,size.height,view),[size.width,size.height,view])
  const live=useRef({elapsed:0,lookX:0,lookY:0,drag:false,x:0,y:0,flowStart:0,notified:false,offer:0,lastOffset:0,scene:'',stage:''})
  const framing=useRef({from:0,value:0,target:0,start:0,lift:0})
  const bottleFrame=useRef({key:'',layout:'',bounds:new Box3(),eye:new Vector3()})
  const active=useRef<Motion|null>(null),carrying=useRef<Hand|null>(null)
  const pourFocus=useRef(0)
  const sessionWater=useRef<{cupMl:number;vaseMl:number;spillMl:number}|null>(null)
  const pourPose=useRef({position:new Vector3(),rotation:new Quaternion(),lip:new Vector3(),mouth:new Vector3(),tilt:new Quaternion(),start:0,duration:0,arc:0})
  const lift=useRef<CupLift|null>(null)
  const recovery=useRef<{start:number;from:Vector3;rotation:Quaternion;target:Vector3;end:Quaternion}|null>(null)
  useFrame((_,delta)=>{
    const s=state(),ritual=s.ritual,work=s.history.present,t=live.current,now=performance.now()
    if(!ritual||!work.tools)return
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches
    if(t.stage!==ritual.stage||t.scene!==ritual.sceneId){
      t.elapsed=0;t.stage=ritual.stage;t.scene=ritual.sceneId
      if(ritual.stage==='arrival'){t.lookX=0;t.lookY=0}
    }
    t.elapsed+=Math.min(delta,.05)
    const elapsed=t.elapsed
    const approach=ritual.stage==='arrival'&&!reduced?1-smooth(Math.min(1,elapsed/4)):0
    const recenter=ritual.stage==='arrival'?1:ritual.stage==='opening'&&!reduced?1-smooth(Math.min(1,elapsed/1.25)):0
    const offering=s.offering&&ritual.stage==='bless'&&!reduced?Math.sin(Math.PI*Math.min(1,(now-s.offering)/1600)):0
    const focus=framing.current,target=Number((ritual.stage==='trim'||ritual.stage==='observe')&&!!s.heldId)
    if(focus.target!==target){
      focus.from=target||focus.value;focus.target=target;focus.start=now
    }
    const progress=reduced?1:Math.min(1,(now-focus.start)/340)
    focus.value=focus.from+(target-focus.from)*smooth(progress)
    if(progress<1)invalidate()
    const heldFrame=target&&s.heldId?world.flowers.get(s.heldId)?.userData.heldFrame:undefined
    if(target)focus.lift=heldFrame?.lift??0
    camera.position.copy(view.eye).lerp(cuttingEye,focus.value);camera.position.y+=approach*.045+focus.value*focus.lift;camera.position.z+=approach*.34-offering*.022
    const entrance=ritual.sceneId==='rain'?view:arrival
    const pitch=view.pitch+(entrance.pitch-view.pitch+t.lookY)*recenter
    camera.quaternion.setFromEuler(new Euler(pitch,t.lookX*recenter,0,'YXZ'))
    const fov=view.fov+(entrance.fov-view.fov)*recenter
    if(camera instanceof PerspectiveCamera){
      const zoom=(1+(target?world.zoom*2.7:0))*(heldFrame?.closeZoom??1)
      if(camera.fov!==fov||camera.zoom!==zoom){camera.fov=fov;camera.zoom=zoom;camera.updateProjectionMatrix()}
    }
    if(s.vaseFocus&&world.vase&&camera instanceof PerspectiveCamera){
      const arrangement=work.flowers.filter(f=>f.location==='vase')
      const cache=bottleFrame.current
      const key=[s.serial,s.epoch,size.width,size.height,...arrangement.map(f=>f.id)].join('/')
      if(cache.key!==key){
        const box=cache.bounds.setFromObject(world.vase)
        for(const f of arrangement){
          const root=world.flowers.get(f.id)
          const model=root?.getObjectByName('botanical-'+f.id)
          if(model){
            const pose=coreFlowerPose(f,work,false)
            const matrix=model.matrix.clone().compose(pose.position,pose.quaternion,new Vector3(1,1,1))
            box.union(localBounds(model).applyMatrix4(matrix))
          }
        }
        const center=box.getCenter(new Vector3()),span=box.getSize(new Vector3())
        const tan=Math.tan(camera.fov*Math.PI/360),portrait=size.width<size.height
        const distance=Math.max(span.y/(tan*(portrait?.94:1.38)),span.x/(tan*camera.aspect*(portrait?1.22:1.0)),.29)+span.z*.52
        cache.eye.copy(center).add(new Vector3(0,0,distance).applyQuaternion(camera.quaternion))
        cache.eye.x+=portrait?0:distance*tan*camera.aspect*.20
        cache.key=key
      }
      camera.position.copy(cache.eye)
      camera.updateMatrixWorld()
      const panel=gl.domElement.closest('.core-studio')?.querySelector<HTMLElement>('.vase-guide')
      const layout=panel?key+'/'+panel.offsetWidth+'/'+panel.offsetHeight:''
      if(panel&&cache.layout!==layout){
        const b=cache.bounds,points=[b.min.x,b.max.x].flatMap(x=>[b.min.y,b.max.y].flatMap(y=>
          [b.min.z,b.max.z].map(z=>new Vector3(x,y,z).project(camera))))
        const right=Math.max(...points.map(p=>(1+p.x)*size.width/2))
        const bottom=Math.max(...points.map(p=>(1-p.y)*size.height/2))
        const rim=world.vase.localToWorld(new Vector3(0,.179,0)).project(camera)
        const beside=right+20+panel.offsetWidth<size.width-12
        const x=beside?right+20:size.width-panel.offsetWidth-12
        const y=beside?(1-rim.y)*size.height/2-panel.offsetHeight*.35:bottom+12
        panel.style.left=Math.max(12,x)+'px'
        panel.style.top=Math.max(12,Math.min(size.height-panel.offsetHeight-12,y))+'px'
        cache.layout=layout
      }
    }else {bottleFrame.current.key='';bottleFrame.current.layout=''}
    const closePour=s.pourPhase==='flow'||s.pourPhase==='paused'
    const blend=reduced?Number(closePour):pourFocus.current+(Number(closePour)-pourFocus.current)*(1-Math.exp(-16*delta))
    pourFocus.current=Math.abs(blend-Number(closePour))<.002?Number(closePour):blend
    if(world.vase&&pourFocus.current>0){
      const eye=world.vase.localToWorld(new Vector3(.02,.145,0)).add(new Vector3(0,0,size.width<size.height?.54:.43).applyQuaternion(camera.quaternion))
      camera.position.lerp(eye,pourFocus.current)
    }
    if(pourFocus.current!==Number(closePour))invalidate()
    camera.updateMatrixWorld()
    if(ritual.stage==='arrival'){
      const sample=camera.userData.approach
      if(!sample||sample.scene!==ritual.sceneId)camera.userData.approach={scene:ritual.sceneId,first:camera.position.z,last:camera.position.z}
      else sample.last=camera.position.z
    }
    if(approach||recenter&&elapsed<1.3||offering>.001)invalidate()
    if(world.vase && active.current?.id!=='vase'&&carrying.current?.id!=='vase'){
      world.vase.position.set(work.vase.x,work.tools.vaseY,work.vase.z-.025-offering*.058)
    }
    if(offering||t.lastOffset){
      for(const f of work.flowers)if(f.location==='vase'){
        const root=world.flowers.get(f.id)
        if(root){root.position.copy(coreFlowerPose(f,work,false).position);root.position.z-=offering*.058}
      }
      t.lastOffset=offering
    }
    if(lift.current&&world.cup){
      const motion=lift.current
      world.cup.position.y=reduced?motion.to:cupHeight(motion,now)
      carryContents(world,'cup')
      if(now-motion.start>=motion.duration||reduced)lift.current=null
      else invalidate()
    }
    const capacity=Math.min(work.cupMl,130-work.vaseMl)
    const transferred=world.pouring?Math.min(work.cupMl,capacity+6,pouredMl(now-t.flowStart)):0
    const lost=Math.max(0,transferred-capacity)
    if(world.overflow){world.overflow.visible=lost>.03;world.overflow.scale.y=Math.min(1,lost/2)}
    if(world.pouring){
      world.previewMl=Math.min(capacity,transferred)
      if(!t.notified&&work.vaseMl+world.previewMl>=130*2/3){s.tell('水已约三分之二。可点「停止倒水」，也可继续添水。');t.notified=true}
      invalidate()
    }
    const level=(work.vaseMl+world.previewMl)/130
    if(closePour){
      const current=Math.round(work.vaseMl+world.previewMl)
      const label=gl.domElement.closest('main')?.querySelector<HTMLElement>('[data-water-live]')
      if(label&&label.dataset.level!==String(current)){
        label.dataset.level=String(current);label.textContent=current+' / 130 毫升'
      }
      const note=gl.domElement.closest('main')?.querySelector<HTMLElement>('[data-water-note]')
      const message=s.pourPhase==='paused'&&work.vaseMl>=130&&(work.spillMl??0)>0?'瓶已满，少量水已溢出。可以重新倒水。':lost>.03?'水沿瓶口溢出，正在收水。':work.vaseMl+world.previewMl>=129.99?'瓶已满，请停水。':work.cupMl-transferred<.01?'杯中水已倒完。':current>=117?'快满了，继续会溢出。':current>=87?'已到建议水量，可以停水。':'建议倒至约 87 毫升（三分之二）。'
      if(note&&note.textContent!==message)note.textContent=message
    }
    if(world.water){
      world.water.visible=level>0
      world.water.position.y=.012+.159*level
      const radius=level<.45?.024+.014*Math.sin(level/.45*Math.PI):.011+.016*Math.max(0,(.78-level)/.33)
      world.water.scale.setScalar(radius/.025)
    }
    if(world.cup&&s.pourPhase!=='carry'){
      const pose=pourPose.current
      const travel=reduced?1:Math.min(1,(now-pose.start)/Math.max(1,pose.duration))
      const blend=smooth(travel)
      const tip=world.pouring?smooth(Math.max(0,Math.min(1,(now-t.flowStart)/330))):0
      const tilt=.30+tip*(.77+.32*(1-(work.cupMl-transferred)/180))
      pose.tilt.setFromAxisAngle(new Vector3(0,0,1),tilt)
      world.cup.quaternion.slerpQuaternions(pose.rotation,pose.tilt,blend)
      const aligned=pose.mouth.clone().addScaledVector(up,.040).sub(pose.lip.clone().applyQuaternion(world.cup.quaternion))
      world.cup.position.lerpVectors(pose.position,aligned,blend)
      world.cup.position.y+=pose.arc*Math.sin(Math.PI*blend)
      if(travel<1)invalidate()
      world.cup.updateMatrixWorld(true)
    }else if(world.cup&&recovery.current){
      const a=recovery.current,mix=reduced?1:smooth(Math.min(1,(now-a.start)/160))
      world.cup.position.lerpVectors(a.from,a.target,mix);world.cup.quaternion.slerpQuaternions(a.rotation,a.end,mix)
      if(mix>=1)recovery.current=null
      else invalidate()
    }
    if(world.cupWater&&world.cup)world.cupWater.updateLevel(world.cup.quaternion,work.cupMl-transferred)
    const reveal=s.pourPhase!=='carry'
    if(world.vase){
      const vase=world.vase,target=reveal?.36:1,previous=vase.userData.revealOpacity??1
      if(vase.userData.pouring!==reveal||previous!==target){
        let opacity=reduced?target:target+(previous-target)*Math.exp(-20*delta)
        if(Math.abs(opacity-target)<.006)opacity=target
        vase.userData.pouring=reveal;vase.userData.revealOpacity=opacity
        vase.traverse(o=>{
          if(!(o instanceof Mesh)||o===world.overflow||o===world.water||o.name==='vase-water-volume')return
          for(const mat of Array.isArray(o.material)?o.material:[o.material]){
            const transparent=opacity<1
            if(mat.transparent!==transparent){mat.transparent=transparent;mat.depthWrite=!transparent;mat.needsUpdate=true}
            mat.opacity=opacity
          }
        })
        if(opacity!==target)invalidate()
      }
    }
    if(world.stream&&world.cup&&world.vase){
      world.stream.visible=world.pouring&&transferred>0
      if(world.stream.visible){
        const lip=world.cup.getObjectByName('glass_pour_lip')
        const b=world.vase.localToWorld(new Vector3(0,.179,0))
        const a=lip?.getWorldPosition(new Vector3())??world.cup.localToWorld(new Vector3(-.036,.103,0)),axis=b.clone().sub(a)
        world.stream.position.copy(a).lerp(b,.5);const width=.28+.72*Math.min(1,(now-t.flowStart-100)/140);world.stream.scale.set(width,axis.length(),width);world.stream.quaternion.setFromUnitVectors(up,axis.normalize())
      }
    }
    if(world.pouring&&transferred>=Math.min(work.cupMl,capacity+6))world.pourAction?.('stop')
  })
  useEffect(()=>{
    const canvas=gl.domElement,ray=new Raycaster(),t=live.current
    const cast=(e:PointerEvent)=>{const b=canvas.getBoundingClientRect();ray.setFromCamera(new Vector2(2*(e.clientX-b.left)/b.width-1,1-2*(e.clientY-b.top)/b.height),camera)}
    const refCamera=camera as PerspectiveCamera
    const pickBounds=new WeakMap<Group,{model:Object3D;bounds:Box3}>()
    const scratchBounds=new Box3()
    const isOfferingTarget=(hit:{id:string}|undefined)=>!!hit&&(hit.id==='vase'||state().history.present.flowers.some(f=>f.id===hit.id&&f.location==='vase'))
    const pick=(e:PointerEvent,padded=false)=>{
      const items=[world.vase,world.cup,world.scissors,...world.flowers.values()].filter((o):o is Group=>!!o)
      const rect=canvas.getBoundingClientRect()
      const nearby=items.filter(root=>{
        if(!root.children.length)return false
        const model=root.children[0]
        let entry=pickBounds.get(root)
        if(!entry||entry.model!==model){
          entry={model,bounds:localBounds(root)}
          pickBounds.set(root,entry)
        }
        root.updateWorldMatrix(true,false)
        return ray.ray.intersectsBox(scratchBounds.copy(entry.bounds).applyMatrix4(root.matrixWorld).expandByScalar(.035))
      })
      if(!nearby.length)return
      const offsets=padded?[[0,0],[4,0],[-4,0],[0,4],[0,-4],[6,4],[-6,4]]:[[0,0]]
      for(const [dx,dy] of offsets){
        ray.setFromCamera(new Vector2(2*(e.clientX+dx-rect.left)/rect.width-1,1-2*(e.clientY+dy-rect.top)/rect.height),camera)
        const h=ray.intersectObjects(nearby,true)[0]
        for(let o:Object3D|null=h?.object??null;o;o=o.parent){
          const id=o===world.cup?'cup':o===world.vase?'vase':o===world.scissors?'scissors':o.userData.role==='flower'?o.userData.id:null
          if(id){cast(e);return {id:id as string,root:o as Group,point:h.point}}
        }
      }
      cast(e)
      if(!padded)return
      // The gaps between discrete offset rays can be wider than the visible stem.
      const start=new Vector3(),end=new Vector3(),point=new Vector3(),viewPoint=new Vector3()
      let nearest=e.pointerType==='touch'?8:4,result:{root:Group;id:string;point:Vector3}|undefined
      for(const root of nearby){
        if(root.userData.role!=='flower')continue
        const stem=root.getObjectByName('part-stem')?.children[0]
        if(!(stem instanceof Mesh))continue
        const line=stemLine(stem.geometry)
        if(!line.length)continue
        start.copy(line[0]).applyMatrix4(stem.matrixWorld)
        for(let i=1;i<line.length;i++){
          end.copy(line[i]).applyMatrix4(stem.matrixWorld)
          const gap=ray.ray.distanceSqToSegment(start,end,undefined,point)
          const depth=-viewPoint.copy(point).applyMatrix4(camera.matrixWorldInverse).z
          const pixelsPerMetre=rect.height*camera.projectionMatrix.elements[5]/(2*depth)
          const pixels=Math.sqrt(Math.max(0,gap))*pixelsPerMetre
          if(depth>0&&pixels<nearest){
            nearest=pixels;result={root,id:root.userData.id,point:point.clone()}
          }
          start.copy(end)
        }
      }
      return result
    }
    const hitsVase=(e:PointerEvent)=>{
      if(!world.vase)return false
      const b=canvas.getBoundingClientRect(),rim=world.vase.localToWorld(new Vector3(0,.179,0)).project(camera)
      const dx=e.clientX-b.left-(rim.x+1)*b.width/2,dy=e.clientY-b.top-(1-rim.y)*b.height/2
      return Math.hypot(dx,dy)<Math.max(16,Math.min(30,b.height*.032))||ray.intersectObject(world.vase,true).length>0
    }
    const nearVase=(e:PointerEvent)=>{
      if(hitsVase(e))return true
      const lip=world.cup?.getObjectByName('glass_pour_lip')?.getWorldPosition(new Vector3())
      if(!lip||!world.vase)return false
      const rim=world.vase.localToWorld(new Vector3(0,.179,0))
      return Math.hypot(lip.x-rim.x,lip.z-rim.z)<.057&&Math.abs(lip.y-rim.y)<.13
    }
    const overPourArea=(e:PointerEvent)=>{
      if(!world.vase)return false
      const button=canvas.closest('.core-studio')?.querySelector('.cup-pour-actions')?.getBoundingClientRect()
      if(hitsVase(e))return true
      if(!button)return false
      const b=canvas.getBoundingClientRect(),rim=world.vase.localToWorld(new Vector3(0,.179,0)).project(camera)
      const x=b.left+(1+rim.x)*b.width/2,y=b.top+(1-rim.y)*b.height/2
      // Only bridge the short walk from the rim to its action, leaving the tray below available.
      return e.clientX>=Math.min(x,button.left)-8&&e.clientX<=Math.max(x,button.right)+8&&
        Math.abs(e.clientY-y)<=button.height/2+6
    }
    let leftPreview=false,returningToDesk=false
    const pourHint=()=>{
      const work=state().history.present
      if(work.flowers.some(f=>f.location==='cup'))return '杯里还有花。可点「先放下花枝」，也可以把杯子放回桌上，逐枝取花。'
      if(work.vaseMl>=130)return '花瓶已满。'
      if(work.cupMl<=0)return '杯中水已倒完。'
      return ''
    }
    const previewMaterial=new MeshBasicMaterial({color:'#e7ca82',transparent:true,opacity:.30,depthWrite:false})
    let footprint:Group|undefined,previewModel:Object3D|undefined
    const hideLanding=()=>{
      if(footprint)footprint.visible=false
      if(world.marker){world.marker.visible=false;world.marker.scale.setScalar(1)}
    }
    const resting=(hand:Hand,point:Vector3,anchor?:Vector3):{position:Vector3;quaternion:Quaternion;model?:Object3D}=>{
      const {id,root,grab}=hand
      if(isTool(id))return {position:new Vector3(...restOnDesk(root,grab.bounds,point)),quaternion:root.quaternion.clone()}
      const model=root.getObjectByName('botanical-'+id)!
      const flower=state().history.present.flowers.find(f=>f.id===id)!
      const heading=grab.turned||flower.location==='table'?root.quaternion:coreFlowerPose({...flower,location:'table'},state().history.present,false).quaternion
      return restFlower(model,point,heading,true,anchor)
    }
    const showLanding=(hand:Hand,point:Vector3|null)=>{
      if(!point||world.pouring){hideLanding();return}
      if(!isTool(hand.id)){
        const pose=resting(hand,point,hand.grip),model=pose.model!
        if(previewModel!==model){
          footprint?.removeFromParent();footprint=model.clone(true) as Group;previewModel=model
          footprint.traverse(o=>{if(o instanceof Mesh){o.material=previewMaterial;o.castShadow=false;o.receiveShadow=false;o.raycast=()=>{}}})
          hand.root.parent?.add(footprint)
        }
        footprint!.position.copy(pose.position);footprint!.quaternion.copy(pose.quaternion);footprint!.visible=true
      }
      if(world.marker){
        world.marker.visible=true;world.marker.position.copy(point);world.marker.position.y+=.002
        world.marker.quaternion.setFromUnitVectors(new Vector3(0,0,1),up);world.marker.scale.setScalar(1.65)
      }
    }
    // A held cup is aimed by its base on the support surface. Use that same footprint on release.
    const cupLanding=(hand:Hand)=>{
      const at=deskHit(ray.ray)
      if(!at)return null
      at.z+=(hand.carry?.depth??0)
      const [x,y,z]=restOnDesk(hand.root,hand.grab.bounds,at)
      return at.set(x,y,z)
    }
    const landingPoint=(hand:Hand)=>{
      if(hand.id==='cup')return cupLanding(hand)
      const point=deskHit(ray.ray)??(hand.carry?.withinDesk?new Vector3():null)
      if(point&&hand.carry){
        const anchor=hand.root.localToWorld(hand.carry.grip.clone())
        point.set(anchor.x,inBox(anchor.x,anchor.z)?BOX.base:DESK.top,anchor.z)
      }
      return point
    }
    const follow=(hand:Hand,depth=0)=>{
      if(hand.carry){
        if(hand.id==='cup'){
          if(depth)hand.carry.depth=Math.max(-.22,Math.min(.22,hand.carry.depth+depth))
          const at=cupLanding(hand)
          hand.carry.withinDesk=!!at
          if(at)hand.root.position.set(at.x,hand.carry.height,at.z)
          else if(depth){
            const next=hand.root.position.clone();next.z+=depth
            hand.root.position.z=restOnDesk(hand.root,hand.grab.bounds,next)[2]
          }
          hand.root.updateMatrixWorld(true)
        }else moveOnTable(hand.root,hand.grab.bounds,hand.carry,ray.ray,depth)
        if(hand.id==='cup'&&lift.current)hand.root.position.y=cupHeight(lift.current,performance.now())
      }
    }
    const approach=(pour:boolean)=>{
      const cup=world.cup,vase=world.vase,s=state()
      if(!cup||!vase||s.ritual?.stage!=='prepare'||!s.cupHeld||pourHint())return
      const pose=pourPose.current
      lift.current=null;recovery.current=null
      const lip=cup.getObjectByName('glass_pour_lip')
      pose.lip.copy(lip?cup.worldToLocal(lip.getWorldPosition(new Vector3())):new Vector3(-.036,.103,0))
      pose.mouth.copy(vase.localToWorld(new Vector3(0,.179,0)))
      const distance=cup.localToWorld(pose.lip.clone()).distanceTo(pose.mouth.clone().addScaledVector(up,.04))
      pose.position.copy(cup.position);pose.rotation.copy(cup.quaternion);pose.start=performance.now()
      pose.duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.min(680,distance*1350+(distance>.012?140:0))
      pose.arc=Math.min(.055,distance*.19)
      t.flowStart=pose.start+pose.duration;t.notified=s.history.present.vaseMl>=130*2/3
      if(pour&&!sessionWater.current)sessionWater.current={cupMl:s.history.present.cupMl,vaseMl:s.history.present.vaseMl,spillMl:s.history.present.spillMl??0}
      world.pouring=pour;world.previewMl=0
      useCoreStore.setState({pourPhase:pour?'flow':'ready',message:pour?'再点一下停水。':'杯沿已对准。点花瓶倒水，移开继续拿杯。'})
      hideLanding();invalidate()
    }
    world.pourAction=action=>{
      const s=state(),hand=carrying.current,phase=s.pourPhase
      if(!hand||hand.id!=='cup'||!s.cupHeld||s.ritual?.stage!=='prepare')return
      if(action==='start'){
        if(phase!=='flow')approach(true)
        return
      }
      if(action==='retry'){
        if(phase==='paused'&&sessionWater.current){
          s.dispatch({type:'restore-water',...sessionWater.current});approach(true)
        }
        return
      }
      if(phase==='carry'||(action==='stop'&&phase!=='flow'))return
      const cup=hand.root
      const transferred=phase==='flow'&&action==='stop'?Math.min(s.history.present.cupMl,pouredMl(performance.now()-t.flowStart)):0
      const amount=Math.min(transferred,130-s.history.present.vaseMl),lost=Math.min(6,transferred-amount)
      world.pouring=false;world.previewMl=0;leftPreview=true;returningToDesk=true
      if(action==='stop'){
        if(amount+lost>0)s.dispatch({type:'pour',ml:amount||lost,spill:lost})
        useCoreStore.setState({pourPhase:'paused',message:lost>0?'少量水已溢出，已停水。':'已停水。'})
        invalidate();return
      }
      sessionWater.current=null
      const from=cup.position.clone(),rotation=cup.quaternion.clone(),end=hand.grab.rotation.clone()
      const target=from.clone()
      target.y=hand.carry!.height
      recovery.current={start:performance.now(),from,rotation,target,end}
      cup.position.copy(from);cup.quaternion.copy(rotation)
      useCoreStore.setState({pourPhase:'carry'})
      s.tell('杯子仍在手中，点桌面放下。')
      invalidate()
    }
    const guideCup=(hand:Hand,e:PointerEvent)=>{
      if(hand.id==='cup'&&state().ritual?.stage==='prepare'&&!pourHint()){
        const near=nearVase(e)
        if(!near)leftPreview=false
        if(near&&!leftPreview&&!recovery.current&&overPourArea(e)){approach(false);return}
      }
      showLanding(hand,landingPoint(hand))
    }
    const endPress=()=>{
      const g=active.current;active.current=null
      if(g&&canvas.hasPointerCapture(g.pointer))canvas.releasePointerCapture(g.pointer)
      t.drag=false
      world.active=carrying.current?{kind:'carry',id:carrying.current.id}:null
      if(!carrying.current){
        sessionWater.current=null;world.pouring=false;world.previewMl=0
        if(state().pourPhase!=='carry')useCoreStore.setState({pourPhase:'carry'})
        recovery.current=null;hideLanding();canvas.style.cursor='default'}
      invalidate()
    }
    const restore=()=>{
      const w=state().history.present
      if(!w.tools)return
      for(const prop of ['vase','cup','scissors'] as const)world[prop]?.quaternion.copy(propRotation(w,prop))
      world.scissors?.position.fromArray(w.tools.scissors);world.cup?.position.fromArray(w.tools.cup)
      world.vase?.position.set(w.vase.x,w.tools.vaseY,w.vase.z-.025)
      for(const f of w.flowers){
        const root=world.flowers.get(f.id);if(!root)continue
        let pose=coreFlowerPose(f,w,false)
        if(f.location==='table')pose=restFlower(root.getObjectByName('botanical-'+f.id)!,pose.position,pose.quaternion,!f.tableRotation||Math.abs(up.clone().applyQuaternion(pose.quaternion).y)>.20)
        root.position.copy(pose.position);root.quaternion.copy(pose.quaternion)
      }
    }
    const abort=()=>{
      if(!active.current&&!carrying.current&&!t.drag)return false
      const flower=carrying.current&&!isTool(carrying.current.id)
      lift.current=null;carrying.current=null;endPress();state().holdCup(false)
      if(flower)state().putDown()
      restore();return true
    }
    world.abortRitual=abort
    const take=(hand:Hand)=>{
      carrying.current=hand;leftPreview=false;returningToDesk=false
      const height=hand.carry!.height
      if(hand.id==='cup'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        lift.current={from:hand.root.position.y,to:height,start:performance.now(),duration:155}
      }else hand.root.position.y=height
      hand.root.updateMatrixWorld(true)
      world.active={kind:'carry',id:hand.id}
      useCoreStore.setState({carriedProp:hand.id==='vase'||hand.id==='scissors'?hand.id:null})
      if(hand.id==='cup')state().holdCup(true)
      else if(!isTool(hand.id))state().select(hand.id)
      carryContents(world,hand.id);canvas.style.cursor='grabbing'
      state().tell(hand.id==='cup'?(pourHint()||'点花瓶倒水，点桌面放下。'):'已抬起。移向桌面任意位置，再点一下放下。')
    }
    world.takeCup=()=>{
      if(state().ritual?.stage!=='prepare'||state().blocked||!world.cup)return
      if(carrying.current?.id==='cup')return
      abort()
      const root=world.cup,point=root.localToWorld(new Vector3(0,.045,0))
      const projected=point.clone().project(camera)
      ray.setFromCamera(new Vector2(projected.x,projected.y),camera)
      const grab=startGrab(root,point,refCamera),grip=new Vector3()
      take({id:'cup',root,grab,grip,carry:beginTableCarry(root,grip,ray.ray,root.position.y+.08,point.y)})
      invalidate()
    }
    const place=(hand:Hand,target:Vector3,anchor?:Vector3)=>{
      const pose=resting(hand,target,anchor),position=pose.position.toArray() as Vec3,rotation=pose.quaternion.toArray() as Quat
      const command=isTool(hand.id)?{type:'set-prop' as const,prop:hand.id,position,rotation}:{type:'place-flower' as const,id:hand.id,position,rotation}
      const s=state(),work=s.history.present
      const releaseY=hand.root.position.y
      if(!s.dispatch(command)){
        const flower=work.flowers.find(f=>f.id===hand.id)
        const saved=isTool(hand.id)?(hand.id==='vase'?[work.vase.x,work.tools!.vaseY,work.vase.z-.025]:work.tools![hand.id]):flower?.location==='table'?flower.table:undefined
        if(!saved||saved.some((v,i)=>Math.abs(v-position[i])>1e-7))return
        if(!isTool(hand.id))s.putDown()
      }
      carrying.current=null;useCoreStore.setState({carriedProp:null})
      if(isTool(hand.id)){
        if(hand.id==='cup')lift.current=null
        hand.root.position.copy(pose.position)
        if(hand.id==='cup'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&releaseY>pose.position.y+.002){
          lift.current={from:releaseY,to:pose.position.y,start:performance.now(),duration:140}
          hand.root.position.y=releaseY
        }
        carryContents(world,hand.id)
      }
      if(hand.id==='cup')state().holdCup(false)
      hideLanding()
    }
    const intercept=(e:PointerEvent)=>{e.preventDefault();e.stopImmediatePropagation()}
    world.pickFlower=createLooseFlowerPicker(world,camera,canvas,()=>state().history.present.flowers)
    const down=(e:PointerEvent)=>{
      const s=state(),stage=s.ritual?.stage
      if(!stage||s.blocked||(e.button!==0&&e.button!==2))return
      cast(e)
      if(s.insertPreview){intercept(e);return}
      if(s.pourPhase==='paused'){intercept(e);return}
      if(s.vaseFocus)return
      // Whole-branch pickup and clipping belong to CoreControls in these two stages.
      if(stage==='observe'||stage==='trim')return
      if(stage==='arrival'){t.drag=true;t.x=e.clientX;t.y=e.clientY;canvas.setPointerCapture(e.pointerId);intercept(e);return}
      if(stage==='bless'){
        const hit=pick(e);if(isOfferingTarget(hit)){useCoreStore.setState({offering:performance.now()});s.updateRitual({line:1});invalidate()}
        intercept(e);return
      }
      if(['opening','done','return'].includes(stage)){intercept(e);return}
      if(stage==='arrange'&&s.heldId&&!carrying.current&&e.button===0&&!e.shiftKey)return
      const held=carrying.current,hit=held?null:pick(e,true),hand=held??hit
      if(!hand)return
      if(!held&&!isTool(hand.id)&&stage!=='prepare'&&stage!=='tidy')return
      if(!held&&s.heldId&&e.button===0&&!e.shiftKey&&stage!=='prepare'&&stage!=='tidy')return
      intercept(e)
      const grab=held?held.grab:startGrab(hand.root,hit!.point,refCamera)
      const g:Motion={id:hand.id,root:hand.root,grab,grip:held?.grip??grab.local.clone(),pointer:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,rotate:e.button===2||e.shiftKey}
      const inCup=s.history.present.flowers.some(f=>f.id===g.id&&f.location==='cup')
      g.carry=held?.carry
      if(!held&&!g.rotate){
        const grip=isTool(g.id)?new Vector3():g.grip
        const restY=g.id==='cup'&&lift.current?lift.current.to:g.root.position.y
        if(g.id==='cup')lift.current=null
        g.carry=beginTableCarry(g.root,grip,ray.ray,restY+(inCup?.12:.08),hit!.point.y)
      }
      if(held?.id==='cup'&&!g.rotate&&stage==='prepare'){
        if(s.pourPhase==='flow'){world.pourAction?.('stop');return}
        if(hitsVase(e)){
          const hint=pourHint()
          if(hint)s.tell(hint)
          else world.pourAction?.('start')
          return
        }
        if(s.pourPhase==='ready')world.pourAction?.('cancel')
        if(recovery.current){
          held.root.quaternion.copy(recovery.current.end)
          follow(held)
          held.root.updateMatrixWorld(true)
        }
      }
      recovery.current=null
      active.current=g;world.active={kind:'prop',id:g.id};canvas.style.cursor='grabbing';canvas.setPointerCapture(e.pointerId);invalidate()
    }
    const move=(e:PointerEvent)=>{
      const s=state(),g=active.current,held=carrying.current
      cast(e)
      if(t.drag&&s.ritual?.stage==='arrival'){
        t.lookX-=(e.clientX-t.x)*.005;t.lookY=Math.max(-.9,Math.min(.9,t.lookY+(e.clientY-t.y)*.004));t.x=e.clientX;t.y=e.clientY;intercept(e);invalidate();return
      }
      if(!g&&held){
        if(s.pourPhase==='paused'||s.pourPhase==='flow'||(s.pourPhase==='ready'&&overPourArea(e))){intercept(e);return}
        if(s.pourPhase==='ready')world.pourAction?.('cancel')
        if(held.id==='cup'&&returningToDesk&&deskHit(ray.ray)){
          const cup=held.root
          recovery.current={start:performance.now(),from:cup.position.clone(),rotation:cup.quaternion.clone(),target:cup.position.clone(),end:held.grab.rotation.clone()}
          returningToDesk=false
        }
        if(recovery.current){
          const a=recovery.current,pos=held.root.position.clone(),q=held.root.quaternion.clone()
          if(!deskHit(ray.ray)){hideLanding();intercept(e);return}
          held.root.quaternion.copy(a.end);follow(held);a.target.copy(held.root.position)
          held.root.position.copy(pos);held.root.quaternion.copy(q)
        }else follow(held)
        carryContents(world,held.id);guideCup(held,e)
        canvas.style.cursor='grabbing';intercept(e);invalidate();return
      }
      if(!g){
        if(['opening','return','done','arrival','bless'].includes(s.ritual?.stage??'')){
          const target=s.ritual?.stage==='bless'&&isOfferingTarget(pick(e))
          canvas.title=target?'送出祝愿':'';canvas.style.cursor=s.ritual?.stage==='arrival'?'grab':target?'pointer':'default';e.stopImmediatePropagation()
        }else if(['prepare','tidy'].includes(s.ritual?.stage??'')&&pick(e,true)){canvas.style.cursor='grab';e.stopImmediatePropagation()}
        return
      }
      intercept(e);if(e.pointerId!==g.pointer||(!g.moved&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<(e.pointerType==='touch'?9:5)))return
      g.moved=true
      if(g.rotate||e.shiftKey)turnGrab(g.root,g.grab,refCamera,e.clientX-g.lastX,e.clientY-g.lastY)
      else follow(g)
      if(g.carry)g.root.position.y=g.carry.height
      g.lastX=e.clientX;g.lastY=e.clientY;carryContents(world,g.id);showLanding(g,landingPoint(g));invalidate()
    }
    const upEvent=(e:PointerEvent)=>{
      const s=state(),g=active.current
      cast(e)
      if(t.drag){t.drag=false;intercept(e);return}
      if(!g||g.pointer!==e.pointerId)return
      intercept(e)
      const target=landingPoint(g),held=carrying.current
      if(held){
        if(!g.moved&&!g.rotate&&target)place(held,target,isTool(held.id)?undefined:held.grip)
        else if(g.grab.turned){
          held.grab.rotation.copy(g.root.quaternion)
          held.carry=beginTableCarry(g.root,held.carry!.grip,ray.ray,held.carry!.height,-held.carry!.plane.constant)
        }
      }else if(g.id==='scissors'&&s.scissors){/* Trim keeps its own raised scissors. */}
      else if(g.moved){
        if(!target&&!g.rotate)take(g)
        else place(g,g.rotate?g.grab.origin:target!,g.rotate||isTool(g.id)?undefined:g.grip)
      }else if(g.id==='vase'&&!g.rotate&&(s.ritual?.stage==='tidy'||s.ritual?.stage==='arrange'&&s.ritual.arranging)&&!s.heldId&&s.history.present.flowers.some(f=>f.location==='vase')){
        s.focusVase(true)
      }else if(!g.rotate&&!(s.ritual?.stage==='observe'&&g.id==='scissors'))take(g)
      endPress()
    }
    const wheel=(e:WheelEvent)=>{
      const g=active.current,hand=g??carrying.current
      if(!hand||state().pourPhase!=='carry')return
      recovery.current=null
      e.preventDefault();e.stopImmediatePropagation()
      if(e.altKey||e.shiftKey||g?.rotate)turnGrab(hand.root,hand.grab,refCamera,0,0,-e.deltaY*.005)
      else follow(hand,Math.max(-.08,Math.min(.08,e.deltaY*.0007)))
      if(hand.carry)hand.root.position.y=hand.id==='cup'&&lift.current?cupHeight(lift.current,performance.now()):hand.carry.height
      if(g)g.moved=true
      carryContents(world,hand.id);showLanding(hand,landingPoint(hand));invalidate()
    }
    const outsideCanvas=(e:PointerEvent)=>{
      if(!carrying.current||carrying.current.id==='cup'||active.current||e.target===canvas)return
      const rect=canvas.getBoundingClientRect()
      if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return
      cast(e)
      if(state().pourPhase!=='carry'||(e.target instanceof Element&&e.target.closest('.cup-pour-actions')))return
      recovery.current=null;const hand=carrying.current;follow(hand);carryContents(world,hand.id);hideLanding()
      invalidate()
    }
    window.addEventListener('pointermove',outsideCanvas,true)
    const menu=(e:Event)=>e.preventDefault()
    canvas.addEventListener('contextmenu',menu);canvas.addEventListener('wheel',wheel,{passive:false,capture:true})
    const suspend=()=>{if(world.pouring)world.pourAction?.('stop');abort()}
    const visibility=()=>{if(document.hidden)suspend()}
    const lost=()=>{if(active.current)abort()}
    canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);canvas.addEventListener('pointerup',upEvent,true)
    canvas.addEventListener('pointercancel',abort,true);canvas.addEventListener('lostpointercapture',lost,true)
    window.addEventListener('blur',suspend);document.addEventListener('visibilitychange',visibility)
    const unsub=useCoreStore.subscribe((s,prev)=>{if(s.epoch!==prev.epoch||s.ritual?.stage!==prev.ritual?.stage){lift.current=null;carrying.current=null;endPress();restore()}invalidate()})
    return()=>{window.removeEventListener('pointermove',outsideCanvas,true);footprint?.removeFromParent();previewMaterial.dispose();canvas.removeEventListener('wheel',wheel,true);canvas.removeEventListener('contextmenu',menu);unsub();world.pickFlower=undefined;world.abortRitual=undefined;world.pourAction=undefined;world.takeCup=undefined;canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);canvas.removeEventListener('pointerup',upEvent,true);canvas.removeEventListener('pointercancel',abort,true);canvas.removeEventListener('lostpointercapture',lost,true);window.removeEventListener('blur',suspend);document.removeEventListener('visibilitychange',visibility)}
  },[world,gl,camera,invalidate])
  return null
}

