import type { History,SceneId } from '../game/types'
import { BOX, CUP_START, SHEARS_START, VASE_START, migrateDesk } from '../game/desk-layout'
import { CUP_FLOWERS, restoredScene } from '../content/catalog'
import { initialHistory } from '../game/history'
import { decodeCore, encodeCore } from './core-progress'

export const STAGES=['arrival','opening','prepare','observe','trim','arrange','tidy','bless','return','done'] as const
export type Stage=typeof STAGES[number]
export type Ritual={sceneId:SceneId;stage:Stage;wish:string;line:number;arranging?:boolean;observed?:boolean}
export const canArrange=(ritual:Ritual|null)=>!ritual||(ritual.stage==='arrange'&&ritual.arranging===true)
export const RITUAL_KEY='yixihua:five-forms:v1'
export const freshRitual=(sceneId:SceneId='bamboo'):Ritual=>({sceneId,stage:'arrival',wish:'',line:0})
export function ritualHistory(){
  const history=initialHistory()
  // The three stems chosen for a fresh table have individual lengths. Existing cuts remain measured in metres.
  for(const flower of history.present.flowers)flower.length=CUP_FLOWERS[flower.kind].length
  history.present.vase={x:VASE_START[0],z:VASE_START[2]+.025,yaw:0}
  history.present.tools={layout:2,vaseY:BOX.base,cup:[...CUP_START],scissors:[...SHEARS_START]}
  return history
}
export function encodeRitual(history:History,ritual:Ritual){
  return JSON.stringify({...JSON.parse(encodeCore(history)),ritual})
}
export function decodeRitual(raw:string){
  const history=decodeCore(raw)
  if(!history?.present.tools)return
  const ritual=JSON.parse(raw).ritual as Ritual
  if(!ritual||!STAGES.includes(ritual.stage)||!['bamboo','rain','creek'].includes(ritual.sceneId)||typeof ritual.wish!=='string'||ritual.wish.length>200||!Number.isInteger(ritual.line)||ritual.line<0||ritual.line>8)return
  const maxLine=ritual.stage==='opening'?3:['observe','trim','arrange','return'].includes(ritual.stage)?2:['bless','tidy'].includes(ritual.stage)?1:0
  if(ritual.line>maxLine||(ritual.observed!==undefined&&typeof ritual.observed!=='boolean')||(ritual.arranging!==undefined&&typeof ritual.arranging!=='boolean'))return
  if(['done','return','bless'].includes(ritual.stage)&&!history.present.flowers.some(f=>f.location==='vase'))return
  return {history:{present:migrateDesk(history.present),past:history.past.map(e=>({...e,state:migrateDesk(e.state)})),future:history.future.map(e=>({...e,state:migrateDesk(e.state)}))},ritual:{...ritual,sceneId:restoredScene(ritual.sceneId)}}
}

