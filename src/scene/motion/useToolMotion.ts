import { useLayoutEffect, type RefObject } from 'react'
import { Euler, Group, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { BASE_Y, FLOWERS, MOUTH_Y, PARTS } from '../../content/catalog'
import { useGameStore, type VisualAction } from '../../state/game-store'
import type { Arrangement, CutPreview } from '../../game/types'
import { flowerTransform } from '../objects/Flower'
import { stemPoint } from '../objects/BotanicalStem'
import { easeMove, easeOut, MOTION, useSceneMotion } from './SceneMotion'

export function cutAnchor(before:Arrangement,id:string,part:string|undefined,length:number|undefined,heldId:string|null){
  const f=before.flowers.find(f=>f.id===id);if(!f)return new Vector3(0,1,0)
  const height=part?(PARTS.find(p=>p.id===part)?.height||.1)-(FLOWERS[f.kind].length-f.length):f.length-(length||f.length)
  const pose=flowerTransform(f,before,heldId===id)
  return stemPoint(height,f.length).applyQuaternion(pose.quaternion).add(pose.position)
}
export function actionAnchor(action:VisualAction){
  const c=action.command
  return c.type==='cut-part'?cutAnchor(action.before,c.id,c.part,undefined,action.heldId):c.type==='cut-length'?cutAnchor(action.before,c.id,undefined,c.length,action.heldId):new Vector3()
}
type Refs={cup:RefObject<Group|null>;scissors:RefObject<Group|null>;cupWater:RefObject<Mesh|null>;surface:RefObject<Mesh|null>;vaseWater:RefObject<Mesh|null>;stream:RefObject<Mesh|null>;ripple:RefObject<Mesh|null>}
export const cupHome=()=>{
  const s=useGameStore.getState(),canLift=s.tool==='cup'&&!s.history.present.flowers.some(f=>f.location==='cup')
  return new Vector3(...(canLift?[.13,.88,.12]:[-.17,BASE_Y,-.02]) as [number,number,number])
}
export const scissorsHome=()=>new Vector3(...(useGameStore.getState().tool==='scissors'?[.17,.85,.16]:[.19,.781,.015]) as [number,number,number])
export const scissorsTurn=()=>new Quaternion().setFromEuler(useGameStore.getState().tool==='scissors'?new Euler(-.7,0,-.2):new Euler(0,.45,0))
export function useToolMotion(refs:Refs,model:Object3D){
  const action=useGameStore(s=>s.visualAction),preview=useGameStore(s=>s.cutPreview),tool=useGameStore(s=>s.tool),epoch=useGameStore(s=>s.motionEpoch)
  const motion=useSceneMotion()
  useLayoutEffect(()=>{
    const {cup,scissors,cupWater,surface,vaseWater,stream,ripple}=refs
    if(!cup.current||!scissors.current)return
    const halves=[model.getObjectByName('scissors_half_0'),model.getObjectByName('scissors_half_1')]
    const open=(angle:number)=>halves.forEach((half,i)=>{if(half)half.rotation.y=(i===0?-1:1)*angle})
    const water=(cupMl:number,vaseMl:number)=>{
      const h=cupMl/180*.052
      if(cupWater.current){cupWater.current.visible=cupMl>0;cupWater.current.position.y=.007+h/2;cupWater.current.scale.set(.9+.1*cupMl/180,h,.9+.1*cupMl/180)}
      if(surface.current){surface.current.visible=cupMl>0;surface.current.position.y=.007+h;surface.current.scale.setScalar(.9+.1*cupMl/180)}
      if(vaseWater.current){vaseWater.current.visible=vaseMl>0;vaseWater.current.position.y=.055+vaseMl/130*.04}
    }
    const clean=(resetBlades=true)=>{const s=useGameStore.getState().history.present;water(s.cupMl,s.vaseMl);if(resetBlades)open(0);if(stream.current)stream.current.visible=false;if(ripple.current)ripple.current.visible=false}
    const initialOpening=Math.abs(halves[0]?.rotation.y||0)
    clean(false)
    const command=action?.command
    if(command?.type==='pour'&&tool==='cup'){
      const object=cup.current,from=object.position.clone(),turn=object.quaternion.clone()
      const after=action!.after,before=action!.before,tilt=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.95)
      const mouth=new Vector3(after.vase.x,MOUTH_Y+.006,after.vase.z-.025)
      const lip=new Vector3(-.036,.103,0),over=mouth.clone().add(new Vector3(0,.079,0)).sub(lip.clone().applyQuaternion(tilt))
      const finish=()=>{object.position.copy(cupHome());object.quaternion.identity();clean()}
      const stop=motion.run(object,MOTION.pour,t=>{
        const ms=t*MOTION.pour,flow=Math.max(0,Math.min(1,(ms-250)/700))
        if(ms<250){const u=easeMove(ms/250);object.position.lerpVectors(from,over,u);object.quaternion.slerpQuaternions(turn,tilt,u);motion.phase('approach')}
        else if(ms<950){object.position.copy(over);object.quaternion.copy(tilt);motion.phase('pour')}
        else{const u=easeMove((ms-950)/250);object.position.lerpVectors(over,cupHome(),u);object.quaternion.slerpQuaternions(tilt,new Quaternion(),u);motion.phase('return')}
        water(before.cupMl+(after.cupMl-before.cupMl)*flow,before.vaseMl+(after.vaseMl-before.vaseMl)*flow)
        const flowing=ms>=250&&ms<950
        if(stream.current){
          const top=lip.clone().applyQuaternion(object.quaternion).add(object.position),delta=mouth.clone().sub(top)
          stream.current.visible=flowing;stream.current.position.copy(top).addScaledVector(delta,.5)
          stream.current.quaternion.setFromUnitVectors(new Vector3(0,1,0),delta.clone().normalize())
          const width=.0018*(.9+.1*Math.sin(ms*.025));stream.current.scale.set(width,delta.length(),width)
        }
        if(ripple.current){ripple.current.visible=flowing;ripple.current.position.copy(mouth);const r=.005+.008*((ms%220)/220);ripple.current.scale.set(r,r,r)}
      },finish,'pour')
      return()=>{stop();clean()}
    }
    const cutting=command?.type==='cut-part'||command?.type==='cut-length'
    const p:CutPreview|null=preview
    if(tool==='scissors'&&(cutting||p)){
      const state=useGameStore.getState(),point=cutting?actionAnchor(action!):cutAnchor(state.history.present,p!.id,p!.kind==='part'?p!.part:undefined,p!.kind==='length'?p!.length:undefined,state.held?state.selectedId:null)
      const object=scissors.current,from=object.position.clone(),turn=object.quaternion.clone(),aim=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2+.2)
      const bladeAnchor=model.getObjectByName('scissors_cut')?.position.clone()||new Vector3(0,.008,-.09)
      const end=point.clone().sub(bladeAnchor.applyQuaternion(model.quaternion).applyQuaternion(aim))
      const total=cutting?MOTION.approach+MOTION.close+MOTION.move:MOTION.approach
      const finish=()=>{if(cutting){object.position.copy(scissorsHome());object.quaternion.copy(scissorsTurn());open(0)}else{object.position.copy(end);object.quaternion.copy(aim);open(.22)}}
      const stop=motion.run(object,total,t=>{
        const ms=t*total
        if(ms<=MOTION.approach){const u=easeMove(ms/MOTION.approach);object.position.lerpVectors(from,end,u);object.quaternion.slerpQuaternions(turn,aim,u);open(initialOpening+(.22-initialOpening)*easeOut(ms/MOTION.approach));motion.phase('aim')}
        else if(ms<=MOTION.approach+MOTION.close){object.position.copy(end);object.quaternion.copy(aim);open(.22*(1-easeOut((ms-MOTION.approach)/MOTION.close)));motion.phase('snip')}
        else{const u=easeMove((ms-MOTION.approach-MOTION.close)/MOTION.move);object.position.lerpVectors(end,scissorsHome(),u);object.quaternion.slerpQuaternions(aim,scissorsTurn(),u);open(0);motion.phase('return')}
      },finish,cutting?'cut':'aim')
      return()=>{stop();const next=useGameStore.getState(),c=next.visualAction?.command;clean(!(next.tool==='scissors'&&(next.cutPreview||c?.type==='cut-part'||c?.type==='cut-length')))}
    }
    open(0)
    return()=>clean()
  },[action,preview,tool,epoch,motion,model])
}
