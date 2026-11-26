import { stockLength, nodeHeight, flowerParts, flowerDetails, sectionableDetail, attachmentFraction } from '../content/catalog'
import type { FlowerState, PiecePlacement } from './types'

export const MIN_STEM = .001
// Measured v8 tabletop, inset by 5 mm; object footprints are checked by the scene.
export const TABLE_BOUNDS = {left:-.595,right:.595,back:-.495,front:.365}
export const sectionEnd = (flower:FlowerState,part:string) => flower.sections?.[part] ?? 1
export function cutProblem(flower:FlowerState,target:string,at:number):string|undefined {
  if(flower.location==='vase')return '先取出花枝，再修剪。'
  if(!Number.isFinite(at))return '剪口位置无效。'
  if(target==='stem') {
    if(at<.001-1e-8||flower.length-at<MIN_STEM-1e-8)return '请把剪口留在花茎上。'
    return
  }
  const detail=flowerDetails(flower).find(p=>p.id===target)
  if(detail&&at!==0&&!sectionableDetail(flower.kind,target))return '请从花头连接处剪下。'
  let ancestor=detail
  while(ancestor){
    const end=sectionEnd(flower,ancestor.parent)
    if(flower.removed.includes(ancestor.id)||flower.removed.includes(ancestor.parent)||attachmentFraction(flower,ancestor)>=end&&end<1)return '这个部位已经不在花枝上。'
    const next=flowerDetails(flower).find(d=>d.id===ancestor!.parent)
    if(!next)break
    ancestor=next
  }
  const part=flowerParts(flower).find(p=>p.id===(ancestor?.parent??target))
  if(!part||flower.removed.includes(part.id)||nodeHeight(flower,part.height)-(stockLength(flower)-flower.length)<-1e-8)return '这个部位已经不在花枝上。'
  if(at<0||at>sectionEnd(flower,target)-.001+1e-8)return '把剪刀向枝条里面移一点。'
}
export function validPlacement(p:PiecePlacement):boolean {
  const vector=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10)
  const quaternion=(q:unknown)=>vector(q,4)&&Math.abs((q as number[]).reduce((sum,x)=>sum+x*x,0)-1)<.01
  return Boolean(p)&&vector(p.origin,3)&&vector(p.landing,3)&&quaternion(p.rotation)&&quaternion(p.resting)&&(p.contact===undefined||vector(p.contact,3))
    &&p.landing[0]>=TABLE_BOUNDS.left&&p.landing[0]<=TABLE_BOUNDS.right&&p.landing[2]>=TABLE_BOUNDS.back&&p.landing[2]<=TABLE_BOUNDS.front&&p.landing[1]>=.7&&p.landing[1]<1.2
}
