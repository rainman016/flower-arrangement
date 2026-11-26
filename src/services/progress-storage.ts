import { ASSET_VERSION, restoredScene } from '../content/catalog'
import { HISTORY_LIMIT } from '../game/history'
import { isArrangement,isSession } from '../game/rules'
import type { Entry,History,Session } from '../game/types'
export const STORAGE_KEY='yixihua:five-forms:v2'
export const LEGACY_KEY='yixihua:flower-study:v1'
export interface ProgressStorage{getItem(key:string):string|null;setItem(key:string,value:string):void}
export type LoadedProgress={history?:History;session?:Session;problem?:string;raw?:string}
function entries(v:unknown):v is Entry[]{
  return Array.isArray(v)&&v.length<=HISTORY_LIMIT&&v.every((e)=>e&&typeof e.label==='string'&&e.label.length<120&&isArrangement(e.state))
}
export function decodeProgress(raw:string):LoadedProgress{
  try{
    const v=JSON.parse(raw),h=v.history
    if(v.schemaVersion!==2||v.assetVersion!==ASSET_VERSION)return {raw,problem:'发现其他版本的进度，原数据已保留。'}
    if(!isSession(v.session)||!h||!isArrangement(h.present)||!entries(h.past)||!entries(h.future))return {raw,problem:'保存的进度不完整，原数据已保留。'}
    // Admit only the documented serializable fields.
    const clean=(s:History['present']):History['present']=>({
      flowers:s.flowers.map((f)=>({id:f.id,kind:f.kind,location:f.location,length:f.length,removed:[...f.removed],pose:{yaw:f.pose.yaw,tilt:f.pose.tilt,depth:f.pose.depth,x:f.pose.x,z:f.pose.z},slot:f.slot})),
      nextId:s.nextId,cupMl:s.cupMl,vaseMl:s.vaseMl,vase:{x:s.vase.x,z:s.vase.z,yaw:s.vase.yaw},debris:s.debris.map((d)=>({id:d.id,flowerId:d.flowerId,part:d.part})),
    })
    return {session:{sceneId:restoredScene(v.session.sceneId),chapter:v.session.chapter,wish:v.session.wish},history:{present:clean(h.present),past:h.past.map((e:Entry)=>({state:clean(e.state),label:e.label})),future:h.future.map((e:Entry)=>({state:clean(e.state),label:e.label}))}}
  }catch{return {raw,problem:'保存的进度无法读取，原数据已保留。'}}
}
export function loadProgress(storage:ProgressStorage):LoadedProgress{
  try{const raw=storage.getItem(STORAGE_KEY);return raw?decodeProgress(raw):{}}catch{return {problem:'浏览器限制了本地存储，进度暂时无法保存。'}}
}
export function saveProgress(storage:ProgressStorage,history:History,session:Session):string|undefined{
  try{storage.setItem(STORAGE_KEY,JSON.stringify({schemaVersion:2,assetVersion:ASSET_VERSION,session,history}));return undefined}catch{return '保存失败，作品仍在当前页面。请保持页面打开后重试。'}
}
export function browserStorage():ProgressStorage{return {getItem:(k)=>window.localStorage.getItem(k),setItem:(k,v)=>window.localStorage.setItem(k,v)}}
