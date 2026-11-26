import {flowerParts,flowerDetails} from '../content/catalog'
import { ASSET_VERSION } from '../content/catalog'
import { isArrangement } from '../game/rules'
import { HISTORY_LIMIT, initialHistory } from '../game/history'
import { cutProblem, sectionEnd, TABLE_BOUNDS, validPlacement } from '../game/free-cut'
import type { Arrangement, FlowerState, History } from '../game/types'
export const CORE_KEY='yixihua:core-interaction:v1'
export function coreInitial():History {
  const h=initialHistory()
  h.present.flowers=h.present.flowers.map(f=>({...f,location:'table'}))
  h.present.vaseMl=110;h.present.cupMl=70
  return h
}
function validFlower(f:FlowerState) {
  return (!f.sections||Object.entries(f.sections).every(([key,v])=>[...flowerParts(f),...flowerDetails(f)].some(part=>part.id===key)&&Number.isFinite(v)&&v>=0&&v<=1))
    &&(!f.table||Array.isArray(f.table)&&f.table.length===3&&f.table.every(Number.isFinite)&&f.table[0]>=TABLE_BOUNDS.left&&f.table[0]<=TABLE_BOUNDS.right&&f.table[1]>=.74&&f.table[1]<=1.26&&f.table[2]>=TABLE_BOUNDS.back&&f.table[2]<=TABLE_BOUNDS.front)
}
function validWork(s:Arrangement):boolean {
  return isArrangement(s)&&s.flowers.every(validFlower)&&s.debris.every(d=>{
    if(!d.shape)return true
    const p=d.shape,f=p.flower
    return validPlacement(p)&&(p.target==='stem'||(f&&[...flowerParts(f),...flowerDetails(f)].some(part=>part.id===p.target)))&&Number.isFinite(p.from)&&Number.isFinite(p.to)&&p.from>=0&&p.to>p.from&&p.to<=1
      &&!!f&&isArrangement({...s,flowers:[f],debris:[]})&&validFlower(f)
      &&!cutProblem(f,p.target,p.target==='stem'?p.to:p.from)
      &&(p.target==='stem'?p.from===0:p.to===sectionEnd(f,p.target))
  })
}
export function decodeCore(raw:string):History|undefined {
  try {
    const v=JSON.parse(raw),h=v.history
    if(v.schemaVersion!==1||v.assetVersion!==ASSET_VERSION||!h||!validWork(h.present))return
    if(!['past','future'].every(k=>Array.isArray(h[k])&&h[k].length<=HISTORY_LIMIT&&h[k].every((e:{state:Arrangement;label:string})=>typeof e.label==='string'&&e.label.length<120&&validWork(e.state))))return
    return h
  }catch{return}
}
export function encodeCore(history:History){return JSON.stringify({schemaVersion:1,assetVersion:ASSET_VERSION,history})}
