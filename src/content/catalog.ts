import type { FlowerKind, FlowerState, SceneId } from '../game/types'
import { SPECIMENS, type SpecimenId } from './specimens'
function specimenEntries<T>(map:(id:SpecimenId)=>T){
  return Object.fromEntries((Object.keys(SPECIMENS) as SpecimenId[]).map(id=>[id,map(id)])) as Record<SpecimenId,T>
}
const manifest = __FLOWER_ASSETS__
export const ASSET_VERSION = manifest.version
export const LIMITS = manifest.limits
export const FLOWERS: Record<FlowerKind, { name: string; detail: string; length: number; color: string }> = {
  ...specimenEntries(id=>({name:SPECIMENS[id].label,detail:SPECIMENS[id].category,length:Math.max(.30,SPECIMENS[id].length),color:SPECIMENS[id].accent})),
  yellow: { name: '黄野菊', detail: '一抹暖黄，轻轻舒展', length: .29, color: '#d5aa48' },
  white: { name: '白野花', detail: '细小花瓣，自有留白', length: .30, color: '#f3eedb' },
  daisy: { name: '小雏菊', detail: '白色细瓣围着一颗金黄花心', length: .245, color: '#fffaf0' },
  grass: { name: '野草穗', detail: '细长线条，顺势生长', length: .35, color: '#8b9260' },
}
export const SCENES: { id: SceneId; name: string; detail: string; preview: string; environment: string }[] = [
  { id: 'bamboo', name: '竹林清风', detail: '竹影之间，安放这一枝花。', preview: 'preview-bamboo', environment: 'environment-bamboo' },
  { id: 'creek', name: '溪畔观流', detail: '听水缓行，看花自在生长。', preview: 'preview-creek', environment: 'environment-creek' },
]
// Saved flower arrangements retain their stage and history when a setting is retired.
export const restoredScene = (id: SceneId): SceneId => id === 'rain' ? 'creek' : id

export const MAX_FLOWERS = 12
export const CUP_FLOWERS: Record<FlowerKind, { label: string; length: number }> = {
  ...specimenEntries(id=>({label:SPECIMENS[id].label,length:SPECIMENS[id].length})),
  daisy: {label:'小雏菊',length:.222}, grass: {label:'狗尾巴草',length:.254},
  yellow: {label:'黄野菊',length:.209}, white: {label:'五瓣白野花',length:.254},
}
export const BASE_Y = .774
export const MOUTH_Y = BASE_Y + .179
export const PARTS = [{ id: 'leaf-0', name: '下侧叶', height: .10 }, { id: 'leaf-1', name: '中侧叶', height: .17 }, { id: 'branch-0', name: '上侧枝', height: .22 }]
export function assetUrl(id: string) {
  const item = manifest.assets.find((a) => a.id === id)
  if (!item) throw new Error('未找到素材：' + id)
  return import.meta.env.BASE_URL + item.file
}

export const MATERIAL_LIMITS={minLength:.14,maxLength:.42,minHead:.7,maxHead:1.4}
export function stockLength(f:{kind:FlowerKind;stockLength?:number}){
  return f.stockLength??FLOWERS[f.kind].length
}
export function nodeHeight(f:{kind:FlowerKind;stockLength?:number},height:number){
  return height*stockLength(f)/FLOWERS[f.kind].length
}

export function flowerParts(f:{kind:FlowerKind;stockLength?:number}){
  if(f.kind!=='white')return PARTS
  // The smaller top flower forks four centimetres below the main bloom.
  return [...PARTS,{id:'crown-branch',name:'花顶小侧枝',height:FLOWERS.white.length*(1-.04/stockLength(f))}]
}

export function hasCuts(f:FlowerState){
  const original=stockLength(f)*CUP_FLOWERS[f.kind].length/FLOWERS[f.kind].length
  return f.removed.length>0||Object.keys(f.sections??{}).length>0||f.length<original-.00001
}
const sideDetails=[
  {id:'side-leaf-0',name:'侧枝下叶',parent:'branch-0',at:.19},
  {id:'side-leaf-1',name:'侧枝中叶',parent:'branch-0',at:.43},
  {id:'side-leaf-2',name:'侧枝上叶',parent:'branch-0',at:.66},
  {id:'side-bud',name:'侧枝花苞',parent:'branch-0',at:.66},
  {id:'side-bloom',name:'侧枝花头',parent:'branch-0',at:1},
]
const whiteDetails=[...sideDetails,{id:'upper-bloom',name:'顶侧花头',parent:'crown-branch',at:1}]
const grassDetails=[
  {...sideDetails[0],at:.23},{...sideDetails[1],at:.56},
  {id:'side-panicle',name:'侧生细穗',parent:'branch-0',at:.23},
  {id:'side-bloom',name:'枝端细穗',parent:'branch-0',at:1},
]
// Centreline of the seed head in the side branch's attachment frame (metres).
export function paniclePoint(id:string,t:number,headScale:number){
  const side=id==='side-panicle',scale=headScale*(side?.73:1)
  const x=-.0003*t*t*scale,y=.082*t*scale,z=-.006*t*t*scale
  const c=side?Math.cos(.56):1,s=side?Math.sin(.56):0
  return [x*c+y*s+(side?.086:0),-x*s+y*c+(side?.054:0),z+(side?-.013:0)] as const
}
export function attachmentFraction(f:{kind:FlowerKind;headScale?:number},detail:{id:string;at:number;parent:string}){
  if(!detail.id.includes('-twig-'))return detail.at
  const end=paniclePoint(detail.parent,1,f.headScale??1),p=paniclePoint(detail.parent,detail.at,f.headScale??1)
  return (p[0]*end[0]+p[1]*end[1]+p[2]*end[2])/(end[0]**2+end[1]**2+end[2]**2)
}
const grassCutDetails=[...grassDetails,...['side-panicle','side-bloom'].flatMap(parent=>
  Array.from({length:19},(_,i)=>({id:parent+'-twig-'+i,name:'细穗小枝 '+(i+1),parent,at:.14+i*.043})))]
export function sectionableDetail(kind:FlowerKind,id:string){
  return id.includes('leaf')||id==='side-bud'||kind==='grass'&&(id.startsWith('side-panicle')||id.startsWith('side-bloom'))
}
export function flowerDetails(f:{kind:FlowerKind}){
  return f.kind==='grass'?grassCutDetails:f.kind==='white'?whiteDetails:sideDetails
}
