import { useLayoutEffect, useRef } from 'react'
import { Euler, Group, Object3D, Quaternion, Vector3 } from 'three'
import { BASE_Y } from '../../content/catalog'
import type { Arrangement } from '../../game/types'
import { useGameStore } from '../../state/game-store'
import { MOTION, useSceneMotion } from '../motion/SceneMotion'
import { actionAnchor } from '../motion/useToolMotion'
import BotanicalPart from './BotanicalPart'
import { flowerTransform } from './Flower'

export default function CutDebris({debris:d,index,kit}:{debris:Arrangement['debris'][number];index:number;kit:Object3D}){
  const group=useRef<Group>(null),motion=useSceneMotion(),action=useGameStore(s=>s.visualAction)
  const flower=useGameStore(s=>s.history.present.flowers.find(f=>f.id===d.flowerId))
  const kind=flower?.kind||'yellow',isStem=d.part==='stem'
  const stemLength=useRef(action?.command.type==='cut-length'?(action.before.flowers.find(f=>f.id===d.flowerId)?.length||.3)-action.command.length:.028)
  const target=new Vector3(.055+(index%6)*.025,BASE_Y+.003+Math.floor(index/6)*.0015,.06+Math.floor(index/6)%5*.022)
  const rotation=new Quaternion().setFromEuler(new Euler(Math.PI/2,0,index*1.7))
  useLayoutEffect(()=>{
    const obj=group.current;if(!obj)return
    const finish=()=>{obj.position.copy(target);obj.quaternion.copy(rotation)}
    const justCut=action&&(action.command.type==='cut-part'||action.command.type==='cut-length')&&!action.before.debris.some(x=>x.id===d.id)&&action.after.debris.some(x=>x.id===d.id)
    if(!justCut){finish();return}
    const f=action.before.flowers.find(f=>f.id===d.flowerId)!,pose=flowerTransform(f,action.before,action.heldId===f.id)
    const origin=isStem?pose.position:actionAnchor(action)
    const side=d.part==='leaf-1'?1:-1
    const original=isStem?pose.quaternion.clone():pose.quaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(0,(f.slot%3-1)*.2,-side*.85)))
    const delay=MOTION.approach+MOTION.close,total=delay+MOTION.fall
    return motion.run(obj,total,t=>{
      const fall=Math.max(0,(t*total-delay)/MOTION.fall),drop=fall*fall
      obj.position.lerpVectors(origin,target,drop);obj.quaternion.slerpQuaternions(original,rotation,fall)
    },finish,'debris')
  },[action,motion,d.id,index])
  return <group ref={group} name={'debris-'+d.id} raycast={()=>null}>
    {isStem?<mesh position={[0,stemLength.current/2,0]} castShadow><cylinderGeometry args={[.001,.0013,stemLength.current,7]}/><meshStandardMaterial color="#64773a"/></mesh>:<>
      <group scale={d.part==='leaf-0'?.88:d.part==='branch-0'?.76:1}><BotanicalPart kit={kit} name={kind==='grass'?'flower_grass_leaf':'flower_leaf'}/></group>
      {d.part==='branch-0'&&kind!=='grass'&&<><mesh position={[0,.028,0]} castShadow><cylinderGeometry args={[.0006,.0008,.056,6]}/><meshStandardMaterial color="#64773a"/></mesh><group position={[0,.057,0]} scale={.55}><BotanicalPart kit={kit} name={'flower_'+kind+'_head'}/></group></>}
    </>}
  </group>
}
