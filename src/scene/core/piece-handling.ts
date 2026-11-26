import { Box3, Group, Mesh, Object3D, PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { TABLE_BOUNDS } from '../../game/free-cut'
import type { CutShape, PieceMove, Quat, Vec3 } from '../../game/types'
import { useCoreStore } from '../../state/core-store'
import type { CoreWorld } from './CoreCanvas'
import { flowerOutline, flowerSupport } from './flower-rest'

const up=new Vector3(0,1,0)
function deskPose(id:string,model:Object3D,shape:CutShape,at:Vector3):PieceMove{
  const q=new Quaternion(...shape.resting)
  const tip=up.clone().applyQuaternion(model.children[0].quaternion).applyQuaternion(q)
  q.premultiply(new Quaternion().setFromAxisAngle(up,Math.PI-Math.atan2(tip.x,tip.z)))
  const box=new Box3(),point=new Vector3(),b=TABLE_BOUNDS
  for(const vertex of flowerOutline(model))box.expandByPoint(point.copy(vertex).applyQuaternion(q))
  const x=Math.max(b.left-box.min.x,Math.min(b.right-box.max.x,at.x))
  const z=Math.max(b.back-box.min.z,Math.min(b.front-box.max.z,at.z))
  const position=new Vector3(x,0,z)
  position.y=flowerSupport(model,position,q)
  return {id,landing:position.toArray() as Vec3,resting:q.toArray() as Quat}
}

/** A detached piece retains its immutable cut model and moves as one undoable placement. */
export function pieceHandling(canvas:HTMLCanvasElement,camera:PerspectiveCamera,world:CoreWorld,invalidate:()=>void){
  const ray=new Raycaster(),mouse=new Vector2(),surface=new Plane(up,0)
  let hand:{id:string;root:Group;shape:CutShape;offset:Vector3;height:number;pointer:number;x:number;y:number}|undefined
  const state=useCoreStore.getState
  function cancel(){
    if(!hand)return false
    hand.root.position.fromArray(hand.shape.landing);hand.root.quaternion.fromArray(hand.shape.resting)
    hand=undefined;world.active=null;canvas.style.cursor='';invalidate();return true
  }
  function cast(e:PointerEvent){
    const b=canvas.getBoundingClientRect()
    mouse.set((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2)
    ray.setFromCamera(mouse,camera)
  }
  function floor(){
    const [hit]=ray.intersectObjects([world.table,world.tray].filter((o):o is Object3D=>!!o),true)
    return hit?.point
  }
  function drop(){
    if(!hand)return
    const point=floor()
    if(!point)return
    const {id,root,shape,offset}=hand
    const pose=deskPose(id,root.children[0],shape,point.sub(offset))
    cancel();state().dispatch({type:'move-pieces',placements:[pose]})
  }
  const consume=(e:PointerEvent)=>{e.preventDefault();e.stopImmediatePropagation()}
  function down(e:PointerEvent){
    if(e.target!==canvas||e.button!==0||state().blocked||world.stroke||!['trim','arrange','tidy'].includes(state().ritual?.stage??''))return
    cast(e)
    if(hand){consume(e);drop();return}
    const current=state()
    if(world.active||!world.pieces.size||current.insertPreview||current.ritual?.stage==='arrange'&&current.heldId)return
    const roots=[...world.pieces.values()],rect=canvas.getBoundingClientRect(),center=mouse.clone()
    const focused=current.ritual?.stage==='trim'&&!!current.heldId
    const flowers=focused?current.history.present.flowers.filter(f=>f.location!=='vase'||f.id===current.heldId).map(f=>world.flowers.get(f.id)):Array.from(world.flowers.values())
    const blockers=[...flowers,focused?null:world.vase,focused?null:world.cup,world.scissors].filter((o):o is Group=>!!o)
    const frontSurface=()=>ray.intersectObjects(blockers,true).find(({object})=>{
      for(let o:Object3D|null=object;o;o=o.parent)if(!o.visible)return false
      if(!(object instanceof Mesh))return false
      const materials=Array.isArray(object.material)?object.material:[object.material]
      return materials.some(m=>m.visible&&(!m.transparent||m.opacity>.01)&&m.colorWrite)
    })?.distance??Infinity
    // Small CSS-pixel tolerance helps pick a fine stem, while nearer solid props keep priority.
    let hit=ray.intersectObjects(roots,true)[0]
    if(hit){if(frontSurface()<hit.distance)return}
    else{
      const front=frontSurface()
      for(const [x,y] of [[3,0],[-3,0],[0,3],[0,-3],[4,4],[-4,4],[4,-4],[-4,-4]]){
        mouse.set(center.x+x*2/rect.width,center.y-y*2/rect.height);ray.setFromCamera(mouse,camera)
        const nearby=ray.intersectObjects(roots,true)[0]
        if(nearby&&nearby.distance<front&&nearby.distance<=frontSurface()){hit=nearby;break}
      }
      cast(e);if(!hit)return
    }
    let root=hit.object
    while(root.parent&&!root.name.startsWith('core-debris-'))root=root.parent
    const id=root.name.slice('core-debris-'.length),shape=state().history.present.debris.find(d=>d.id===id)?.shape
    if(!shape||!(root instanceof Group))return
    consume(e);state().putDown()
    const offset=hit.point.clone().sub(root.position);offset.y=0
    hand={id,root,shape,offset,height:hit.point.y,pointer:e.pointerId,x:e.clientX,y:e.clientY}
    root.position.y+=.06;world.active={kind:'piece',id}
    canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';invalidate()
  }
  function move(e:PointerEvent){
    if(!hand||e.target!==canvas)return
    consume(e);cast(e);surface.constant=-hand.height
    const point=ray.ray.intersectPlane(surface,new Vector3())
    if(point){
      hand.root.position.x=Math.max(TABLE_BOUNDS.left,Math.min(TABLE_BOUNDS.right,point.x-hand.offset.x))
      hand.root.position.z=Math.max(TABLE_BOUNDS.back,Math.min(TABLE_BOUNDS.front,point.z-hand.offset.z))
      invalidate()
    }
  }
  function upEvent(e:PointerEvent){
    if(!hand||e.pointerId!==hand.pointer)return
    consume(e);cast(e)
    if(Math.hypot(e.clientX-hand.x,e.clientY-hand.y)>5)drop()
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)
  }
  world.cancelPiece=cancel
  world.gatherPieces=(tidy=false)=>{
    cancel();if(world.stroke)return
    const placements:PieceMove[]=[]
    for(const piece of state().history.present.debris){
      const model=world.pieces.get(piece.id)?.children[0]
      if(!model||!piece.shape)continue
      const i=placements.length
      const at=new Vector3(.38+(i%7)*.023,0,.12+Math.floor(i/7)%8*.017+Math.sin(i*2.4)*.009)
      placements.push(deskPose(piece.id,model,piece.shape,at))
    }
    const moved=state().dispatch(tidy?{type:'tidy',placements}:{type:'move-pieces',placements,gather:true})
    if(moved&&!tidy)state().tell('碎枝已归到右侧桌边。')
    invalidate()
  }
  const changed=useCoreStore.subscribe((s,p)=>{if(hand&&(s.epoch!==p.epoch||s.serial!==p.serial||s.ritual?.stage!==p.ritual?.stage))cancel()})
  window.addEventListener('pointerdown',down,true);window.addEventListener('pointermove',move,true)
  window.addEventListener('pointerup',upEvent,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('blur',cancel)
  return ()=>{
    cancel();changed();world.cancelPiece=undefined;world.gatherPieces=undefined
    window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move,true)
    window.removeEventListener('pointerup',upEvent,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',cancel)
  }
}
