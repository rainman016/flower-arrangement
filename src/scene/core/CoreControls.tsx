import {pieceHandling} from './piece-handling'
import {stockLength} from '../../content/catalog'
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Box3, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { BASE_Y, flowerParts } from '../../content/catalog'
import { MIN_STEM, cutProblem, sectionEnd, TABLE_BOUNDS } from '../../game/free-cut'
import { canArrange } from '../../services/ritual-progress'
import { availablePose, fitDepth, poseProblem } from '../../game/rules'
import type { FlowerState, PiecePlacement, Pose, Quat, Vec3 } from '../../game/types'
import { useCoreStore } from '../../state/core-store'
import { stemPoint } from '../objects/BotanicalStem'
import { centerObject, createPiece, disposeGeometry } from './botanical-geometry'
import { deskHit, localBounds, moveGrab, propRotation, startGrab, turnGrab, type Grab } from './desk-space'
import { restFlower, surfaceHeight } from './flower-rest'
import { coreFlowerPose, heldInsertionPose, heldScissors, SCISSORS_REST } from './core-transforms'
import { cutDrop } from './cut-drop'
import { shearStroke } from './shear-stroke'
import type { CoreWorld } from './CoreCanvas'

type Candidate={id:string;target:string;at:number;point:Vector3;normal:Vector3;problem?:string}
type Gesture={kind:string;id?:string;pointer:number;x:number;y:number;moved:boolean;start:Vector3;rotation:Quaternion;tipOffset?:Vector2;plane:Plane;pose?:Pose;table?:Vec3;cut?:Candidate;grab?:Grab;spin?:boolean;lastX?:number;lastY?:number;freeRotation?:Quaternion;tableRotation?:Quat;mouthDepth?:number;atMouth?:boolean;timer?:ReturnType<typeof setTimeout>}
const yAxis=new Vector3(0,1,0),zAxis=new Vector3(0,0,1),scissorTip=new Vector3(0,-.0014,-.09)
export default function CoreControls({world,kit}:{world:CoreWorld;kit:Object3D}) {
  const {gl,camera,invalidate}=useThree()
  useEffect(()=>{
    const canvas=gl.domElement,ray=new Raycaster(),pointer=new Vector2()
    const ghostMaterial=new MeshBasicMaterial({color:'#ffdc82',toneMapped:false,transparent:true,opacity:.72,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})
    const clipping=new Plane()
    const slicedMaterial=ghostMaterial.clone()
    const clipVector={value:new Vector3()},clipOffset={value:0}
    slicedMaterial.onBeforeCompile=shader=>{
      shader.uniforms.cutNormal=clipVector;shader.uniforms.cutOffset=clipOffset
      shader.vertexShader='varying vec3 cutWorld;\n'+shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\ncutWorld=(modelMatrix*vec4(transformed,1.)).xyz;')
      shader.fragmentShader='varying vec3 cutWorld;uniform vec3 cutNormal;uniform float cutOffset;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(dot(cutWorld,cutNormal)+cutOffset>0.)discard;')
    }
    clipVector.value=clipping.normal
    let gesture:Gesture|null=null,ghostKey='',lastMessage=''
    let hoverFrame=0
    let pendingHover:PointerEvent|undefined
    let touchCut:Candidate|undefined
    const hint=()=>canvas.closest('.core-studio')?.querySelector<HTMLElement>('.desk-trim-trigger')
    const showHint=(show:boolean)=>{const node=hint();if(node)node.toggleAttribute('data-near',show)}
    const trimMode=()=>{const s=useCoreStore.getState();return s.ritual?.stage==='trim'&&!!s.heldId&&s.scissors}

    const tell=(message:string)=>{if(message!==lastMessage){lastMessage=message;useCoreStore.getState().tell(message)}}
    const cast=(x:number,y:number)=>{
      const box=canvas.getBoundingClientRect();pointer.set((x-box.left)/box.width*2-1,-(y-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera)
    }
    const project=(v:Vector3,b=canvas.getBoundingClientRect())=>{const p=v.clone().project(camera);return new Vector2(b.left+(p.x+1)*b.width/2,b.top+(1-p.y)*b.height/2)}
    const role=(object:Object3D):{kind:string;id?:string}|undefined=>{
      for(let o:Object3D|null=object;o;o=o.parent)if(o.userData.role)return {kind:o.userData.role,id:o.userData.id}
    }
    const pick=()=>{
      const stage=useCoreStore.getState().ritual?.stage
      if(stage&&!useCoreStore.getState().vaseFocus&&!['prepare','observe','trim','arrange'].includes(stage))return
      const scissors=!stage||stage==='trim'?world.scissors:null
      const focused=!!useCoreStore.getState().heldId&&(stage==='observe'||stage==='trim')
      const state=useCoreStore.getState()
      const flowers=state.vaseFocus?state.history.present.flowers.filter(f=>f.location==='vase').flatMap(f=>world.flowers.get(f.id)??[]):[...world.flowers.values()]
      const items=[...flowers,scissors,focused?null:world.vase].filter((o):o is Group=>!!o)
      items.forEach(o=>o.updateMatrixWorld(true))
      for(const hit of ray.intersectObjects(items,true)){
        if(state.vaseFocus&&hit.object instanceof Mesh&&!Array.isArray(hit.object.material)&&hit.object.material.opacity===0)continue
        const r=role(hit.object);if(r)return {...r,point:hit.point}
      }
      const supports=[world.table,world.tray].filter((o):o is Object3D=>!!o)
      const hit=ray.intersectObjects(supports,true)[0]
      return hit?{kind:'table',id:undefined,point:hit.point}:undefined
    }
    const support=(x:number,z:number)=>{
      const down=new Raycaster(new Vector3(x,2,z),new Vector3(0,-1,0))
      return down.intersectObjects([world.table,world.tray].filter((o):o is Object3D=>!!o),true)[0]?.point.y??BASE_Y
    }
    const overlays=new Map<string,Object3D[]>()
    let overlayPlant:Object3D|undefined
    const clearPreview=()=>{
      ghostKey=''
      if(world.ghost){world.ghost.clear();world.ghost.visible=false}
      if(world.marker){
        world.marker.visible=false;world.marker.scale.setScalar(1)
        world.marker.getObjectByName('cut-contrast-rim')!.visible=false
      }
    }
    const layOnTable=(root:Group,f:FlowerState,position:Vec3):Vec3=>{
      const pose=coreFlowerPose({...f,location:'table',table:position,tableRotation:useCoreStore.getState().ritual?.stage==='trim'?undefined:f.tableRotation},useCoreStore.getState().history.present,false)
      if(useCoreStore.getState().ritual){
        const rest=restFlower(root.getObjectByName('botanical-'+f.id)!,new Vector3(...position),pose.quaternion)
        root.position.copy(rest.position);root.quaternion.copy(rest.quaternion);return root.position.toArray() as Vec3
      }
      root.position.copy(pose.position);root.quaternion.copy(pose.quaternion);root.updateMatrixWorld(true)
      const model=root.getObjectByName('botanical-'+f.id)!,box=new Box3().setFromObject(model),b=TABLE_BOUNDS
      root.position.x+=Math.max(b.left-box.min.x,Math.min(0,b.right-box.max.x))
      root.position.z+=Math.max(b.back-box.min.z,Math.min(0,b.front-box.max.z))
      root.updateMatrixWorld(true);box.setFromObject(model)
      const floor=Math.max(...[[box.min.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z],[box.max.x,box.min.z],[root.position.x,root.position.z]].map(([x,z])=>support(x,z)))
      root.position.y+=floor+.001-box.min.y;root.updateMatrixWorld(true)
      return root.position.toArray() as Vec3
    }
    const restore=()=>{
      const s=useCoreStore.getState()
      world.flowers.forEach((root,id)=>{
        const f=s.history.present.flowers.find(f=>f.id===id);if(!f)return
        const p=coreFlowerPose(f,s.history.present,s.heldId===id,s.turn,world.zoom,root.userData.heldFrame)
        if(s.ritual&&f.location==='table'&&s.heldId!==id){
          const rest=restFlower(root.getObjectByName('botanical-'+id)!,p.position,p.quaternion,!f.tableRotation||Math.abs(yAxis.clone().applyQuaternion(p.quaternion).y)>.20)
          root.position.copy(rest.position);root.quaternion.copy(rest.quaternion)
        }else{root.position.copy(p.position);root.quaternion.copy(p.quaternion)}
      })
      if(world.scissors){world.scissors.position.set(...(s.scissors?heldScissors(s.history.present,trimMode()):(s.history.present.tools?.scissors??SCISSORS_REST)));world.scissors.quaternion.copy(s.scissors?new Quaternion().setFromEuler(new Euler(Math.PI/2,0,.65,'ZXY')):s.history.present.tools?propRotation(s.history.present,'scissors'):new Quaternion().setFromEuler(new Euler(0,.3,0)))}
      if(world.scissors&&trimMode()&&s.heldId)world.scissors.position.y+=world.flowers.get(s.heldId)?.userData.heldFrame?.lift??0
      invalidate()
    }
    const releaseCapture=(g:Gesture)=>{if(g.timer)clearTimeout(g.timer);try{canvas.releasePointerCapture(g.pointer)}catch{/* Already released. */}}
    const cancel=()=>{
      if(world.cancelPiece?.())return true
      if(world.stroke){
        const pending=!world.stroke.closed
        world.stroke=undefined;clearPreview();restore();return pending
      }
      touchCut=undefined
      const g=gesture;if(!g){clearPreview();invalidate();return (world.active?.kind==='prop'||world.active?.kind==='carry'&&!useCoreStore.getState().cupHeld)?(world.abortRitual?.()??false):false}
      gesture=null;world.active=null;releaseCapture(g);clearPreview();restore();canvas.style.cursor='default';tell('已取消这次操作，花枝保持原样。');return true
    }
    const detachPieces=pieceHandling(canvas,camera as PerspectiveCamera,world,invalidate)
    world.sideFlower=()=>{
      const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===s.heldId)
      const root=f&&world.flowers.get(f.id)
      if(!root||!f||world.stroke)return
      const q=coreFlowerPose({...f,location:'table',tableRotation:undefined},s.history.present,false).quaternion
      const plant=root.getObjectByName('botanical-'+f.id)!
      const first=restFlower(plant,new Vector3(-.44,BASE_Y,.29),q)
      const footprint=localBounds(first.model).applyMatrix4(new Matrix4().makeRotationFromQuaternion(first.quaternion))
      const occupied=s.history.present.flowers.filter(other=>other.id!==f.id&&other.location==='table').flatMap(other=>{
        const model=world.flowers.get(other.id)?.getObjectByName('botanical-'+other.id)
        return model?[new Box3().setFromObject(model)]:[]
      })
      for(const tool of [world.vase,world.cup,world.scissors,world.tray])if(tool)occupied.push(new Box3().setFromObject(tool))
      let best=Infinity,at=first.position
      for(const z of [.29,.17,.05,-.07])for(const x of [-.44,-.54,-.34,-.24,-.14,-.49,-.39,-.29,-.19]){
        const spot=new Vector3(x,BASE_Y,z),box=footprint.clone().translate(spot)
        if(box.min.x<TABLE_BOUNDS.left||box.max.z>TABLE_BOUNDS.front)continue
        let overlap=0
        for(const item of occupied){
          const w=Math.min(box.max.x,item.max.x+.006)-Math.max(box.min.x,item.min.x-.006)
          const d=Math.min(box.max.z,item.max.z+.006)-Math.max(box.min.z,item.min.z-.006)
          if(w>0&&d>0)overlap+=w*d
        }
        if(overlap<best){best=overlap;at=spot}
        if(!best)break
      }
      const rest=restFlower(plant,at,q)
      s.parkScissors();s.dispatch({type:'place-flower',id:f.id,position:rest.position.toArray() as Vec3,rotation:rest.quaternion.toArray() as Quat})
    }
    world.cancel=cancel
    const cutPoint=(root:Group,f:FlowerState,target:string,at:number)=>{
      const part=root.getObjectByName('part-'+target)!
      if(target!=='stem')return part.localToWorld(new Vector3(0,at*Number(part.userData.extent),0))
      const length=stockLength(f),offset=length-f.length
      const p=stemPoint(offset+at,length).sub(stemPoint(offset,length))
      const bend=root.getObjectByName('botanical-'+f.id)?.userData.stemBend as Vector2|undefined
      if(bend){const weight=.5*p.y*p.y/f.length;p.x+=weight*bend.x;p.z+=weight*bend.y}
      return root.localToWorld(p)
    }
    const partBounds=new WeakMap<Object3D,Box3>()
    const boundsFor=(part:Object3D)=>{
      let box=partBounds.get(part)
      if(!box){box=localBounds(part);partBounds.set(part,box)}
      return box
    }
    const physicalEnd=(part:Object3D,f:FlowerState,target:string)=>target==='stem'?f.length:
      target.startsWith('leaf')?Math.min(sectionEnd(f,target),boundsFor(part).max.y/Number(part.userData.extent)):sectionEnd(f,target)
    const detailCache=new WeakMap<Object3D,Object3D[]>()
    const detailNodes=(part:Object3D)=>{
      const cached=detailCache.get(part);if(cached)return cached
      const nodes:Object3D[]=[];part.traverse(o=>{if(o.userData.detail)nodes.push(o)})
      detailCache.set(part,nodes);return nodes
    }
    const worldBox=new Box3()
    const findCut=(screen:Vector2,direct=false):Candidate|undefined=>{
      const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===s.heldId),root=f&&world.flowers.get(f.id)
      if(!f||!root)return
      root.updateWorldMatrix(true,true)
      const bounds=canvas.getBoundingClientRect()
      const candidate=(part:Object3D,target:string,value:number):Candidate=>{
        const end=physicalEnd(part,f,target)
        const at=part.userData.detail&&!part.userData.extent?0:target==='stem'?Math.max(.001,Math.min(end-MIN_STEM,value)):Math.max(0,Math.min(end-.001,value))
        return {id:f.id,target,at,point:cutPoint(root,f,target,at),normal:yAxis.clone().applyQuaternion(part.getWorldQuaternion(new Quaternion())),problem:cutProblem(f,target,at)}
      }
      let nearest=22,result:Candidate|undefined
      for(const target of ['stem',...flowerParts(f).map(p=>p.id)]){
        const part=root.getObjectByName('part-'+target);if(!part)continue
        const end=physicalEnd(part,f,target),steps=target==='stem'?14:1
        let a=project(cutPoint(root,f,target,0),bounds)
        for(let i=1;i<=steps;i++){
          const b=project(cutPoint(root,f,target,end*i/steps),bounds),line=b.clone().sub(a)
          const ratio=Math.max(0,Math.min(1,screen.clone().sub(a).dot(line)/Math.max(.01,line.lengthSq())))
          const distance=screen.distanceTo(a.clone().addScaledVector(line,ratio))
          if(distance<=nearest){
            nearest=distance
            const at=(i-1+ratio)*end/steps
            result=candidate(part,target,at)
          }
          a=b
        }
      }
      if(direct){
        const plant=root.getObjectByName('botanical-'+f.id)!
        const laterals=plant.children.filter(part=>part.name.startsWith('part-')&&part.name!=='part-stem')
        const parts=laterals.filter(part=>ray.ray.intersectsBox(worldBox.copy(boundsFor(part)).applyMatrix4(part.matrixWorld)))
        const hit=ray.intersectObjects(parts,true)[0]
        const stemHit=result?.target==='stem'?ray.intersectObject(plant.getObjectByName('part-stem')!,true)[0]:undefined
        if(hit&&(!stemHit||hit.distance<=stemHit.distance)){
          let part=hit.object
          while(part.parent&&part.userData.target===undefined)part=part.parent
          const target=part.userData.target
          if(!part.userData.detail&&target.includes('branch')&&screen.distanceToSquared(project(part.getWorldPosition(new Vector3()),bounds))<=25)return candidate(part,target,0)
          const at=part.userData.extent?part.worldToLocal(hit.point.clone()).y/Number(part.userData.extent):0
          const found=candidate(part,target,at)
          if(part.userData.extent&&at>0&&Math.abs(found.at-at)<.001)found.point.copy(hit.point)
          return found
        }
        // The crossing itself is shared by two stems. A cut here prunes the lateral flush.
        for(const part of laterals){
          const junction=project(part.getWorldPosition(new Vector3()),bounds)
          if(!part.name.startsWith('part-leaf')&&screen.distanceToSquared(junction)<=25)return candidate(part,part.name.slice(5),0)
        }
        // Give thin flower stalks a small screen-space picking area all the way to their blossom.
        // Keep the literal stem and the shaft of a side branch available for a cut at any height.
        if(!stemHit&&(!result||nearest>2)){
          let best=10
          for(const part of laterals){
            for(const child of detailNodes(part)){
              if(child.userData.branchAttachment===undefined)continue
              const junction=project(child.getWorldPosition(new Vector3()),bounds)
              const end=sectionEnd(f,child.userData.target)
              const tip=project(child.localToWorld(child.userData.extent?new Vector3(0,child.userData.extent*end,0):boundsFor(child).getCenter(new Vector3())),bounds)
              const axis=tip.sub(junction),toPointer=screen.clone().sub(junction)
              const t=Math.max(0,Math.min(1,toPointer.dot(axis)/Math.max(.01,axis.lengthSq())))
              const gap=toPointer.addScaledVector(axis,-t).length()
              if(gap<best&&t>.06){
                best=gap;result=candidate(child,child.userData.target,t*end)
              }
            }
          }
        }
      }
      return result
    }
    const partLabel=(id:string)=>id==='side-bloom'||id==='upper-bloom'||id==='side-panicle'?'只剪这个花序 · 点击剪下':'只剪这条侧枝 · 点击剪下'
    const preview=(c:Candidate|undefined)=>{
      if(!c){clearPreview();if(trimMode())tell('指向枝叶看剪口，拖动可转花。');return}
      if(world.marker){
        const marker=world.marker,centered=trimMode()
        marker.visible=true;marker.position.copy(c.point)
        marker.getObjectByName('cut-contrast-rim')!.visible=centered
        if(centered){
          marker.quaternion.copy(camera.quaternion)
          const depth=-c.point.clone().applyMatrix4(camera.matrixWorldInverse).z
          const worldPerPixel=2*depth/(camera.projectionMatrix.elements[5]*canvas.clientHeight)
          marker.scale.setScalar(8*worldPerPixel/.007)
        }else marker.quaternion.setFromUnitVectors(zAxis,c.normal)
        ;(marker.material as MeshBasicMaterial).color.set(c.problem?'#eb8f78':'#ffe4a3')
      }
      if(c.problem){if(world.ghost)world.ghost.visible=false;tell(c.problem);return}
      const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===c.id)!,root=world.flowers.get(c.id)!
      const plant=root.getObjectByName('botanical-'+f.id)!
      const ghost=world.ghost
      if(ghost){
        const key=plant.uuid+':'+c.target
        if(key!==ghostKey){
          ghost.clear()
          if(overlayPlant!==plant){overlays.clear();overlayPlant=plant}
          let cached=overlays.get(c.target)
          if(!cached){
            cached=[]
            const selected=plant.getObjectByName('part-'+c.target)!
            const parts=c.target==='stem'?plant.children.filter(o=>o.name.startsWith('part-')):[selected]
            for(const part of parts){
              const overlay=part.clone(true)
              overlay.userData.sourcePart=part
              overlay.traverse(o=>{if(o instanceof Mesh){
                o.material=part===selected&&!!part.userData.extent?slicedMaterial:ghostMaterial
                o.castShadow=false;o.receiveShadow=false;o.renderOrder=5;o.raycast=()=>{}
              }})
              for(const child of overlay.children)if(child.userData.branchAttachment!==undefined){
                child.traverse(o=>{if(o instanceof Mesh)o.material=ghostMaterial})
              }
              cached.push(overlay)
            }
            overlays.set(c.target,cached)
          }
          ghost.add(...cached)
          ghostKey=key
        }
        ghost.position.copy(root.position);ghost.quaternion.copy(root.quaternion);ghost.scale.copy(root.scale)
        const part=plant.getObjectByName('part-'+c.target)!
        clipping.normal.copy(c.normal).multiplyScalar(c.target==='stem'?1:-1)
        clipOffset.value=-clipping.normal.dot(c.point)
        for(const overlay of ghost.children){
          const source=overlay.userData.sourcePart as Object3D
          if(source.userData.detail){
            new Matrix4().copy(plant.matrixWorld).invert().multiply(source.matrixWorld).decompose(overlay.position,overlay.quaternion,overlay.scale)
          }else{overlay.position.copy(source.position);overlay.quaternion.copy(source.quaternion)}
          overlay.visible=source===part||source.position.y<c.at
          if(c.target!=='stem')for(const child of overlay.children){
            const attachment=child.userData.branchAttachment
            if(attachment!==undefined)child.visible=attachment>=c.at
          }
        }
        ghost.visible=true
      }
      if(trimMode()){
        tell(c.target==='stem'?'剪短主茎 · 点击剪下':c.target==='side-bud'?'只剪这个花苞 · 点击剪下':c.at>0?'点这一节剪下 · 金色部分落下':c.target.includes('leaf')?'从叶柄剪下':partLabel(c.target))
        return
      }
      tell(c.target==='stem'?'松开剪下 · 保留约 '+Math.round((f.length-c.at)*100)+' 厘米':'松开剪下预览部分 · 可以撤销')
    }
    const piecePlacement=(c:Candidate,f:FlowerState):PiecePlacement=>{
      const object=createPiece(kit,f,c.target,c.target==='stem'?0:c.at,c.target==='stem'?c.at:sectionEnd(f,c.target))
      const source=world.flowers.get(f.id)!,reference=object.children[0]
      const anchor=reference.position.clone(),localRotation=reference.quaternion.clone()
      const center=centerObject(object)
      source.updateWorldMatrix(true,true)
      const part=source.getObjectByName('part-'+c.target)!
      const rotation=part.getWorldQuaternion(new Quaternion()).multiply(localRotation.clone().invert())
      const origin=c.target==='stem'?source.localToWorld(center):
        part.localToWorld(center.sub(anchor).applyQuaternion(localRotation.invert()))
      const placement=cutDrop(object,origin,rotation)
      disposeGeometry(object)
      return placement
    }
    const snip=(c:Candidate)=>{
      const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===c.id)
      if(!f||c.problem||world.stroke||!world.scissors||s.heldId!==c.id||!s.scissors)return false
      const commit=()=>{
        const current=useCoreStore.getState()
        clearPreview()
        if(current.heldId!==f.id||!current.scissors||current.history.present.flowers.find(x=>x.id===f.id)!==f)return false
        return current.dispatch({type:'free-cut',id:f.id,target:c.target,at:c.at,placement:piecePlacement(c,f)})
      }
      touchCut=undefined
      const root=world.flowers.get(f.id)!
      const localCut=root.worldToLocal(c.point.clone())
      world.stroke=shearStroke(world.scissors,()=>root.localToWorld(localCut.clone()),c.normal,camera.getWorldDirection(new Vector3()),commit)
      invalidate();return true
    }
    world.cut=(target,at,commit)=>{
      if(world.stroke)return false
      const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===s.heldId),root=f&&world.flowers.get(f.id)
      if(!f||!root||!s.scissors){tell('先拿近花枝，再拿起花剪。');return false}
      const part=root.getObjectByName('part-'+target);if(!part){tell('这个部位已经不在花枝上。');return false}
      part.updateWorldMatrix(true,false)
      if(part.userData.detail&&!part.userData.extent)at=0
      else if(target.startsWith('leaf'))at=Math.max(0,Math.min(at,physicalEnd(part,f,target)-.001))
      const point=cutPoint(root,f,target,at)
      const c:Candidate={id:f.id,target,at,point,normal:yAxis.clone().applyQuaternion(part.getWorldQuaternion(new Quaternion())),problem:cutProblem(f,target,at)}
      preview(c);invalidate()
      if(c.problem)return false
      if(commit&&trimMode())return snip(c)
      if(commit){clearPreview();return s.dispatch({type:'free-cut',id:f.id,target,at,placement:piecePlacement(c,f)})}
      return true
    }
    const mouthFrame=(x:number,y:number,touch:boolean,latched=false)=>{
      const vase=world.vase!
      const mouth=vase.localToWorld(new Vector3(0,.179,0)),center=project(mouth)
      const lip=project(vase.localToWorld(new Vector3(.017,.179,0)))
      const radius=Math.min(55,Math.max(touch?36:28,lip.distanceTo(center)+18))+(latched?8:0)
      return {mouth,center,radius,near:Math.hypot(x-center.x,y-center.y)<=radius}
    }
    const nearPose=(f:FlowerState,frame:ReturnType<typeof mouthFrame>,x:number,y:number,rotation?:Quaternion,depth?:number)=>{
      const vase=world.vase!,pose=heldInsertionPose(f,vase.quaternion,rotation)
      const localX=project(vase.localToWorld(new Vector3(.017,.179,0))).sub(frame.center)
      const localZ=project(vase.localToWorld(new Vector3(0,.179,.017))).sub(frame.center)
      const dx=(x-frame.center.x)/frame.radius,dy=(y-frame.center.y)/frame.radius
      localX.normalize();localZ.normalize()
      pose.x=.011*(dx*localX.x+dy*localX.y);pose.z=.011*(dx*localZ.x+dy*localZ.y)
      if(depth!==undefined)pose.depth=depth
      return availablePose(useCoreStore.getState().history.present,f,pose)
    }
    const down=(e:PointerEvent)=>{
      if((e.button!==0&&e.button!==2)||gesture||world.stroke||useCoreStore.getState().blocked)return
      cast(e.clientX,e.clientY)
      const armed=trimMode()
      const current=useCoreStore.getState()
      if(current.insertPreview||current.ritual?.stage==='arrange'&&!current.ritual.arranging)return
      canvas.title=''
      let hit=pick()
      if(current.ritual?.stage==='observe'&&current.heldId){
        const root=world.flowers.get(current.heldId)
        if(root)hit={kind:'flower',id:current.heldId,point:root.getWorldPosition(new Vector3())}
      }else if(!current.heldId&&(current.ritual?.stage==='observe'||current.ritual?.stage==='trim')){
        const loose=world.pickFlower?.(e)
        if(loose)hit={kind:'flower',id:loose.id,point:loose.point}
        else if(hit?.kind==='flower')return
      }
      const c=armed?findCut(new Vector2(e.clientX,e.clientY),true):undefined
      if(armed&&!c&&hit?.kind==='scissors')return
      if(armed&&!c&&hit?.kind==='table'){touchCut=undefined;clearPreview();invalidate();return}
      if(armed&&c)hit={kind:'flower',id:c.id,point:c.point}
      if(current.ritual?.stage==='arrange'&&current.ritual.arranging&&current.heldId&&e.button===0&&
          (hit?.kind==='vase'||(!hit||hit.kind==='table')&&mouthFrame(e.clientX,e.clientY,e.pointerType==='touch').near)){
        hit={kind:'mouth',id:current.heldId,point:world.vase!.localToWorld(new Vector3(0,.179,0))}
      }
      if(!hit||armed&&hit.id!==current.heldId)return
      if(hit.id&&!canArrange(current.ritual)&&current.history.present.flowers.some(f=>f.id===hit.id&&f.location==='vase')){
        current.select(hit.id);return
      }
      e.preventDefault();canvas.setPointerCapture(e.pointerId)
      const s=useCoreStore.getState(),object=hit.kind==='scissors'?world.scissors:hit.id?world.flowers.get(hit.id):null
      const g:Gesture={kind:hit.kind,id:hit.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,moved:false,start:object?.position.clone()??hit.point.clone(),rotation:object?.quaternion.clone()??new Quaternion(),plane:new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),hit.point)}
      if(object&&hit.kind!=='mouth'&&s.ritual&&s.ritual.stage!=='observe'&&s.ritual.stage!=='trim'){
        g.grab=startGrab(object,hit.point,camera as PerspectiveCamera);g.lastX=e.clientX;g.lastY=e.clientY
        g.spin=e.button===2||e.shiftKey;g.freeRotation=object.quaternion.clone()
      }
      if(hit.kind==='flower'){
        const f=s.history.present.flowers.find(f=>f.id===hit.id)!
        g.kind=s.heldId===hit.id?(s.ritual?.stage==='arrange'&&!g.spin?'move':'rotate'):f.location==='vase'?'pose':'pending'
        if(g.kind==='pending'&&(!s.ritual||s.ritual.stage==='arrange'))g.timer=setTimeout(()=>{
          if(gesture!==g||g.moved)return
          g.kind='move';world.active={kind:'move',id:g.id};useCoreStore.getState().parkScissors();canvas.style.cursor='grabbing';tell('拖向瓶口或桌面，松开放下。')
        },300)
      }
      if(hit.kind==='grip'){g.kind=s.vaseFocus?'pose':'move';s.parkScissors()}
      if(hit.kind==='scissors'){
        if(!s.scissors)g.kind='lift-scissors'
        else{
          const tip=world.scissors!.localToWorld(scissorTip.clone())
          g.tipOffset=project(tip).sub(new Vector2(e.clientX,e.clientY))
          g.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),tip)
        }
      }
      if(g.spin&&g.id&&s.history.present.flowers.find(f=>f.id===g.id)?.location!=='vase'){if(g.timer)clearTimeout(g.timer);g.kind=s.heldId===g.id?'rotate':'move'}
      if(armed){g.kind='rotate';g.cut=e.button===0&&!e.shiftKey?c:undefined}
      gesture=g;world.active={kind:g.kind,id:g.id};canvas.style.cursor='grabbing';invalidate()
    }
    const move=(e:PointerEvent)=>{
      if(world.stroke||useCoreStore.getState().insertPreview)return
      cast(e.clientX,e.clientY)
      const g=gesture
      if(!g){
        const s=useCoreStore.getState()
        if(trimMode()){
          const c=findCut(new Vector2(e.clientX,e.clientY),true)
          preview(c);canvas.style.cursor=c?(c.problem?'not-allowed':'crosshair'):'default'
          invalidate();return
        }
        if(s.ritual?.stage==='observe'||s.ritual?.stage==='trim'&&!s.heldId){
          const flower=!s.heldId&&world.pickFlower?.(e)
          canvas.title=s.heldId?'拖动转动花枝':flower?'点击拿起这一枝':''
          canvas.style.cursor=s.heldId||flower?'grab':'default'
          if(world.marker?.visible){world.marker.visible=false;invalidate()}
          return
        }
        const hit=pick()
        showHint(s.ritual?.stage==='trim'&&!!s.heldId&&!s.scissors&&hit?.kind==='scissors')
        canvas.style.cursor=hit&&hit.kind!=='table'&&hit.kind!=='vase'?'grab':s.heldId?'crosshair':'default'
        if(world.marker&&s.ritual){
          const b=TABLE_BOUNDS,p=hit?.point
          const placing=Boolean(s.heldId&&!s.scissors&&hit?.kind==='table'&&p&&p.x>=b.left&&p.x<=b.right&&p.z>=b.back&&p.z<=b.front&&p.y<.82)
          if(placing&&p){
            world.marker.position.copy(p);world.marker.position.y+=.001
            world.marker.quaternion.setFromUnitVectors(zAxis,yAxis)
            ;(world.marker.material as MeshBasicMaterial).color.set('#e6cb85')
          }
          if(world.marker.visible||placing)invalidate()
          world.marker.visible=placing
        }
        return
      }
      if(e.pointerId!==g.pointer)return
      const dx=e.clientX-g.x,dy=e.clientY-g.y
      if(Math.hypot(dx,dy)<5&&!g.moved)return
      if(!g.moved&&trimMode()){clearPreview();touchCut=undefined;g.cut=undefined}
      g.moved=true
      if(g.kind==='pending'){
        if(g.timer)clearTimeout(g.timer)
        if(!g.grab){
          const s=useCoreStore.getState()
          if(g.id&&(s.ritual?.stage==='trim'||s.ritual?.stage==='observe')){
            gesture=null;world.active=null;releaseCapture(g)
            s.select(g.id);invalidate()
          }else g.kind='ignore'
          return
        }
        g.kind='move';world.active={kind:'move',id:g.id}
      }
      const s=useCoreStore.getState(),root=g.id?world.flowers.get(g.id):undefined,f=s.history.present.flowers.find(f=>f.id===g.id)
      if(g.kind==='rotate'&&root){
        root.quaternion.copy(new Quaternion().setFromAxisAngle(yAxis,dx*.009)).multiply(g.rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),dy*.009))
        if(s.ritual&&f){
          const pose=coreFlowerPose(f,s.history.present,true,root.quaternion.toArray() as Quat,world.zoom,root.userData.heldFrame)
          root.position.copy(pose.position)
        }
      }else if(g.kind==='scissors'&&world.scissors&&g.tipOffset){
        cast(e.clientX+g.tipOffset.x,e.clientY+g.tipOffset.y)
        const tip=ray.ray.intersectPlane(g.plane,new Vector3());if(!tip)return
        g.cut=findCut(project(tip))
        const aimed=g.cut&&!g.cut.problem?g.cut.point:tip
        world.scissors.position.copy(aimed).sub(scissorTip.clone().applyQuaternion(g.rotation));preview(g.cut)
      }else if(g.kind==='move'&&root&&f){
        g.pose=undefined;g.table=undefined
        if(g.grab&&g.freeRotation){
          root.quaternion.copy(g.freeRotation)
          if(g.spin||e.shiftKey){
            turnGrab(root,g.grab,camera as PerspectiveCamera,e.clientX-g.lastX!,e.clientY-g.lastY!)
            g.freeRotation.copy(root.quaternion)
          }else moveGrab(root,g.grab,ray.ray)
        }
        if(s.ritual?.stage==='arrange'&&s.ritual.arranging&&g.grab){
          const frame=mouthFrame(e.clientX,e.clientY,e.pointerType==='touch',g.atMouth)
          const tip=project(root.position)
          const useTip=!frame.near&&root.position.distanceTo(frame.mouth)<.065&&tip.distanceTo(frame.center)<frame.radius
          g.atMouth=!g.spin&&!e.shiftKey&&(frame.near||useTip)
          if(g.atMouth){
            const turned=g.grab.turned||s.heldId===f.id&&s.turn.some((v,i)=>Math.abs(v-[0,0,0,1][i])>.0001)
            g.pose=nearPose(f,frame,useTip?tip.x:e.clientX,useTip?tip.y:e.clientY,turned?g.freeRotation:undefined,g.mouthDepth)
            if(g.pose){
              const next=coreFlowerPose({...f,location:'vase',pose:g.pose},s.history.present,false)
              root.position.copy(next.position);root.quaternion.copy(next.quaternion)
            }
            if(world.marker){
              const marker=world.marker;marker.visible=true
              marker.position.copy(world.vase!.localToWorld(new Vector3(g.pose?.x??0,.181,g.pose?.z??0)))
              marker.quaternion.copy(camera.quaternion)
              ;(marker.material as MeshBasicMaterial).color.set(g.pose?'#ebcd8c':'#eb8f78')
            }
            tell(g.pose?'松手插入，滚轮可调深浅。':'瓶口已满，可移开花枝或取消。')
          }else{
            const floor=deskHit(ray.ray),at=g.spin?g.grab.origin:g.grab.depthChanged?root.position:floor
            if(at){
              g.table=at.toArray() as Vec3
              g.tableRotation=(g.grab.turned?root.quaternion:coreFlowerPose({...f,location:'table'},s.history.present,false).quaternion).toArray() as Quat
            }
            if(world.marker){world.marker.visible=!!at;if(at){
              world.marker.position.set(at.x,surfaceHeight(at.x,at.z)+.002,at.z)
              world.marker.quaternion.setFromUnitVectors(zAxis,yAxis)
              ;(world.marker.material as MeshBasicMaterial).color.set('#e6cb85')
            }}
            tell('移向瓶口插花，或在桌面松手放下。')
          }
          g.lastX=e.clientX;g.lastY=e.clientY;invalidate();return
        }
        const vase=world.vase!,mouth=vase.localToWorld(new Vector3(0,.179,0))
        const normal=yAxis.clone().applyQuaternion(vase.quaternion)
        const hit=ray.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal,mouth),new Vector3())
        if(!g.spin&&(!s.ritual||s.ritual.stage==='arrange'&&s.ritual.arranging)&&hit&&hit.distanceTo(mouth)<.055){
          const local=vase.worldToLocal(hit)
          const turned=g.grab?.turned||s.heldId===f.id&&s.turn.some((v,i)=>Math.abs(v-[0,0,0,1][i])>.0001)
          const pose=heldInsertionPose(f,vase.quaternion,turned?g.freeRotation??new Quaternion(...s.turn):undefined)
          pose.x=local.x*.26;pose.z=local.z*.26
          const problem=poseProblem(s.history.present,f,pose)
          const p=coreFlowerPose({...f,location:'vase',pose},s.history.present,false);root.position.copy(p.position);root.quaternion.copy(p.quaternion)
          if(!problem){g.pose=pose;tell('松开，将花枝安放在这里。')}else tell(problem)
        }else{
          const floor=ray.intersectObjects([world.table,world.tray].filter((o):o is Object3D=>!!o),true)[0]?.point,b=TABLE_BOUNDS
          if(g.grab){
            const at=g.spin?g.grab.origin:g.grab.depthChanged?root.position:floor??root.position
            const q=g.grab.turned?root.quaternion.clone():coreFlowerPose({...f,location:'table'},s.history.present,false).quaternion
            const rest=restFlower(root.getObjectByName('botanical-'+f.id)!,at,q,true,g.spin?undefined:g.grab.local)
            g.table=rest.position.toArray() as Vec3;g.tableRotation=rest.quaternion.toArray() as Quat
            if(world.marker){world.marker.visible=true;world.marker.position.set(g.table[0],support(g.table[0],g.table[2])+.002,g.table[2]);world.marker.quaternion.setFromUnitVectors(zAxis,yAxis)}
          }else if(floor&&floor.x>=b.left&&floor.x<=b.right&&floor.z>=b.back&&floor.z<=b.front&&floor.y<.82){
            g.table=layOnTable(root,f,[floor.x,floor.y+.012,floor.z])
          }else{const p=ray.ray.intersectPlane(g.plane,new Vector3());if(p)root.position.copy(p)}

        }
      }else if(g.kind==='pose'&&root&&f){
        const pose={...f.pose}
        if(s.mode==='free'){
          const tilt=pose.tilt*Math.PI/180,yaw=pose.yaw*Math.PI/180
          const delta=new Vector3(dx*.0015,0,dy*.0015).applyQuaternion(world.vase!.quaternion.clone().invert())
          const x=Math.tan(tilt)*Math.cos(yaw)+delta.x,z=Math.tan(tilt)*Math.sin(yaw)+delta.z
          pose.tilt=Math.min(12,Math.atan(Math.hypot(x,z))*180/Math.PI)
          if(x||z)pose.yaw=(Math.atan2(z,x)*180/Math.PI+360)%360
        }
        if(s.mode==='yaw')pose.yaw=((f.pose.yaw+dx*.4)%360+360)%360
        if(s.mode==='tilt')pose.tilt=Math.max(0,Math.min(12,f.pose.tilt-dy*.06))
        if(s.mode==='depth')pose.depth=fitDepth(f.pose.depth+dy*.0003,f.length)
        if(s.mode==='point'){pose.x+=dx*.00004;pose.z+=dy*.00004}
        const problem=poseProblem(s.history.present,f,pose)
        const valid=problem?(s.mode==='free'?availablePose(s.history.present,f,pose):undefined):pose
        if(valid){
          g.pose=valid
          const next=coreFlowerPose({...f,pose:valid},s.history.present,false)
          root.position.copy(next.position);root.quaternion.copy(next.quaternion)
        }
        tell(valid?'松开确认这次调整。':problem!)
      }
      g.lastX=e.clientX;g.lastY=e.clientY;invalidate()
    }
    const up=(e:PointerEvent)=>{
      const g=gesture;if(!g||e.pointerId!==g.pointer)return
      if(useCoreStore.getState().ritual?.stage==='arrange'&&(pendingHover||g.moved)&&g.kind!=='mouth'){
        dropQueuedHover();move(e)
      }
      gesture=null;world.active=null;releaseCapture(g);clearPreview();canvas.style.cursor='default'
      const s=useCoreStore.getState();let committed=false
      const held=s.history.present.flowers.find(f=>f.id===s.heldId)
      const onPlacedFlower=s.history.present.flowers.some(f=>f.id===g.id&&f.location==='table')
      if(!g.moved&&!g.spin&&s.ritual?.stage==='prepare'&&held&&(g.id===held.id||onPlacedFlower)){
        const floor=ray.intersectObjects([world.table,world.tray].filter((o):o is Object3D=>!!o),true)[0]?.point
        if(floor&&floor.y<.82){
          const root=world.flowers.get(held.id)!
          committed=s.dispatch({type:'place-flower',id:held.id,position:layOnTable(root,held,[floor.x,floor.y+.012,floor.z])})
        }
      }
      if(committed){invalidate();return}
      if(trimMode()&&g.kind==='rotate'&&!g.moved&&g.cut){
        const c=g.cut
        if(c.problem){preview(c);return}
        if(e.pointerType==='touch'&&(!touchCut||touchCut.target!==c.target||project(touchCut.point).distanceTo(project(c.point))>10)){
          touchCut=c;preview(c);tell('再点一次剪下，拖动可转花。');invalidate();return
        }
        const confirmed=e.pointerType==='touch'&&touchCut?touchCut:c
        preview(confirmed);snip(confirmed);return
      }
      const tappedMouth=held&&!g.moved&&!g.spin&&s.ritual?.stage==='arrange'&&s.ritual.arranging&&mouthFrame(e.clientX,e.clientY,e.pointerType==='touch').near
      if(!g.moved&&held&&(g.kind==='mouth'||tappedMouth)){
        const turned=s.turn.some((v,i)=>Math.abs(v-[0,0,0,1][i])>.0001)
        const pose=availablePose(s.history.present,held,heldInsertionPose(held,world.vase!.quaternion,turned?new Quaternion(...s.turn):undefined))
        if(pose){s.previewInsert(pose);tell('合意就确认插入，也可取消。');committed=true}
        else tell('瓶口暂时没有可用的位置。')
      }
      else if(g.kind==='pending'&&!g.moved&&g.id){s.select(g.id);committed=true}
      else if(g.kind==='lift-scissors'&&!g.moved){showHint(false);s.takeScissors();committed=true}
      else if(g.kind==='rotate'&&g.id&&g.moved){const object=world.flowers.get(g.id)!;s.setTurn(object.quaternion.toArray() as Quat);committed=true}
      else if(g.kind==='scissors'){
        const c=g.cut,f=s.history.present.flowers.find(f=>f.id===c?.id)
        if(g.moved&&c&&!c.problem&&f)committed=s.dispatch({type:'free-cut',id:f.id,target:c.target,at:c.at,placement:piecePlacement(c,f)})
        else tell('没有剪下，花枝保持原样。')
      }else if(g.kind==='move'&&g.id&&g.moved){
        if(g.pose)committed=s.dispatch({type:'insert',id:g.id,pose:g.pose})
        else if(g.table){
          if(s.ritual?.stage==='arrange'&&g.grab&&g.tableRotation){
            const model=world.flowers.get(g.id)!.getObjectByName('botanical-'+g.id)!
            const rest=restFlower(model,new Vector3(...g.table),new Quaternion(...g.tableRotation),true,g.spin?undefined:g.grab.local)
            g.table=rest.position.toArray() as Vec3;g.tableRotation=rest.quaternion.toArray() as Quat
          }
          committed=s.dispatch({type:'place-flower',id:g.id,position:g.table,rotation:g.tableRotation})
        }
        else tell('没有有效落点，已回到原位。')
      }else if(g.kind==='pose'&&g.id){
        if(g.moved&&g.pose)committed=s.dispatch({type:'adjust',id:g.id,pose:g.pose});else if(!g.moved){s.select(g.id);committed=true}
      }else if(g.kind==='table'&&!g.moved){
        if(s.scissors){s.parkScissors();committed=true}
        else if(s.heldId){const p=g.start,b=TABLE_BOUNDS,f=s.history.present.flowers.find(f=>f.id===s.heldId)!,root=world.flowers.get(s.heldId)!;if(p.x>=b.left&&p.x<=b.right&&p.z>=b.back&&p.z<=b.front&&p.y<.82)committed=s.dispatch({type:'place-flower',id:s.heldId,position:layOnTable(root,f,[p.x,p.y+.012,p.z]),rotation:root.quaternion.toArray() as Quat})}
      }
      if(!committed)restore()
      invalidate()
    }
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&cancel()){e.preventDefault();e.stopImmediatePropagation()}}
    const wheel=(e:WheelEvent)=>{
      if(useCoreStore.getState().insertPreview){e.preventDefault();return}
      if(world.stroke)return
      cast(e.clientX,e.clientY)
      const g=gesture,dragged=g?.id?world.flowers.get(g.id):null
      if(g?.grab&&dragged&&(g.kind==='move'||g.kind==='rotate'||g.kind==='pending')){
        e.preventDefault();if(g.timer)clearTimeout(g.timer)
        if(g.atMouth&&g.pose){
          const f=useCoreStore.getState().history.present.flowers.find(f=>f.id===g.id)!
          const frame=mouthFrame(e.clientX,e.clientY,false,true)
          const depth=fitDepth(g.pose.depth+e.deltaY*.000045,f.length)
          const pose=availablePose(useCoreStore.getState().history.present,f,{...g.pose,depth})
          if(pose&&frame.near){
            g.pose=pose;g.mouthDepth=pose.depth
            const next=coreFlowerPose({...f,location:'vase',pose},useCoreStore.getState().history.present,false)
            dragged.position.copy(next.position);dragged.quaternion.copy(next.quaternion)
          }
          invalidate();return
        }
        if(g.kind==='pending')g.kind='move'
        if(e.altKey||e.shiftKey||g.spin||g.kind==='rotate'){
          turnGrab(dragged,g.grab,camera as PerspectiveCamera,0,0,-e.deltaY*.005)
          if(g.kind==='rotate'&&dragged.userData.heldFrame){
            const work=useCoreStore.getState().history.present,flower=work.flowers.find(f=>f.id===g.id)!
            const pose=coreFlowerPose(flower,work,true,dragged.quaternion.toArray() as Quat,world.zoom,dragged.userData.heldFrame)
            dragged.position.copy(pose.position)
          }
          g.rotation.copy(dragged.quaternion);g.freeRotation?.copy(dragged.quaternion);g.x=e.clientX;g.y=e.clientY
        }else moveGrab(dragged,g.grab,ray.ray,Math.max(-.08,Math.min(.08,e.deltaY*.0007)))
        g.moved=true
        if(g.kind==='move'){
          if(useCoreStore.getState().ritual?.stage==='arrange'){
            g.table=dragged.position.toArray() as Vec3;g.tableRotation=dragged.quaternion.toArray() as Quat;invalidate();return
          }
          const rest=restFlower(dragged.getObjectByName('botanical-'+g.id)!,dragged.position,dragged.quaternion)
          g.table=rest.position.toArray() as Vec3;g.tableRotation=rest.quaternion.toArray() as Quat
        }
        invalidate();return
      }
      if(gesture)return
      const hit=pick(),s=useCoreStore.getState()
      if(!s.heldId||(!['observe','trim'].includes(s.ritual?.stage??'')&&hit?.id!==s.heldId))return
      e.preventDefault();world.zoom=Math.max(-.055,Math.min(.055,world.zoom-e.deltaY*.00015))
      const f=s.history.present.flowers.find(f=>f.id===s.heldId)!,root=world.flowers.get(f.id)!,p=coreFlowerPose(f,s.history.present,true,root.quaternion.toArray() as Quat,world.zoom,root.userData.heldFrame)
      root.position.copy(p.position);invalidate()
    }
    const hidden=()=>{if(document.hidden)cancel()}
    const unsubscribe=useCoreStore.subscribe((s,previous)=>{
      if(s.heldId!==previous.heldId)world.zoom=0
      if(s.heldId!==previous.heldId||s.scissors!==previous.scissors){touchCut=undefined;world.stroke=undefined;clearPreview();showHint(false)}
      if(s.epoch!==previous.epoch)cancel()
    })
    const leave=(e:PointerEvent)=>{
      canvas.title=''
      if(!gesture)dropQueuedHover()
      if(!(e.relatedTarget instanceof Element&&e.relatedTarget.closest('.desk-trim-trigger')))showHint(false)
      if(e.pointerType!=='touch'&&!gesture&&!world.stroke&&trimMode()){clearPreview();invalidate()}
    }
    const dropQueuedHover=()=>{if(hoverFrame)cancelAnimationFrame(hoverFrame);hoverFrame=0;pendingHover=undefined}
    const track=(event:PointerEvent)=>{
      const arranging=useCoreStore.getState().ritual?.stage==='arrange'
      if(!arranging&&(gesture||!trimMode())){dropQueuedHover();move(event);return}
      pendingHover=event
      if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{
        hoverFrame=0;const last=pendingHover;pendingHover=undefined
        if(last&&(useCoreStore.getState().ritual?.stage==='arrange'||!gesture&&trimMode()))move(last)
      })
    }
    canvas.addEventListener('pointerleave',leave)
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',track);canvas.addEventListener('pointerup',up)
    const lostCore=()=>{if(gesture)cancel()}
    canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',lostCore);canvas.addEventListener('wheel',wheel,{passive:false})
    window.addEventListener('keydown',key);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden)
    return()=>{
      detachPieces();world.sideFlower=undefined;cancel();unsubscribe();clearPreview();dropQueuedHover();slicedMaterial.dispose();ghostMaterial.dispose();world.cancel=()=>false
      canvas.removeEventListener('pointerleave',leave)
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',track);canvas.removeEventListener('pointerup',up)
      canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',lostCore);canvas.removeEventListener('wheel',wheel)
      window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden)
    }
  },[camera,gl,world,kit,invalidate])
  return null
}
