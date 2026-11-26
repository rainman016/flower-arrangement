import { MIN_STEM } from './free-cut'
import { validRotation } from './desk-layout'
import { FLOWERS, MAX_FLOWERS, flowerParts, flowerDetails, attachmentFraction, MATERIAL_LIMITS, stockLength, nodeHeight } from '../content/catalog'
import type { Arrangement, FlowerState, Pose, Session } from './types'

export const defaultPose = (): Pose => ({ yaw: 0, tilt: 0, depth: .10, x: 0, z: 0 })
export const initialArrangement = (): Arrangement => ({
  flowers: (['yellow','white','grass'] as const).map((kind, i) => ({ id: 'f-' + (i+1), kind, location: 'cup', length: FLOWERS[kind].length, removed: [], pose: defaultPose(), slot: i })),
  nextId: 4, cupMl: 180, vaseMl: 0, vase: { x: 0, z: 0, yaw: 0 }, debris: [],
})
export function normalizePose(pose: Pose): Pose {
  return { ...pose, yaw: ((pose.yaw % 360) + 360) % 360 }
}
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
export function visibleParts(f: FlowerState) {
  const cut = stockLength(f) - f.length
  const stemParts=flowerParts(f).filter((p) => !f.removed.includes(p.id) && nodeHeight(f,p.height) - cut >= -1e-8)
  return stemParts
}
export function visibleCutTargets(f:FlowerState){
  const stemParts=visibleParts(f)
  const visible=new Set(stemParts.map(p=>p.id))
  const details=flowerDetails(f).filter(d=>{
    const end=f.sections?.[d.parent]??1
    if(!visible.has(d.parent)||f.removed.includes(d.id)||end<1&&attachmentFraction(f,d)>=end)return false
    visible.add(d.id);return true
  })
  return [...stemParts,...details]
}
const innerProfile = [[.008,.026],[.04,.039],[.06,.038],[.085,.030],[.105,.016],[.125,.010],[.155,.009],[.175,.014],[.18,.017]]
function radiusAt(y: number) {
  for (let i=1;i<innerProfile.length;i++) {
    const a=innerProfile[i-1], b=innerProfile[i]
    if (y<=b[0]) return a[1] + (b[1]-a[1]) * (y-a[0])/(b[0]-a[0])
  }
  return .017
}
export function stemAt(pose: Pose, y: number) {
  const tilt=pose.tilt*Math.PI/180, yaw=pose.yaw*Math.PI/180
  const shift=(.179-y)*Math.tan(tilt)
  return { x: pose.x - shift*Math.cos(yaw), z: pose.z - shift*Math.sin(yaw) }
}
export function insertionDepth(length:number){
  const max=Math.min(.145,Math.max(length*.45,length-.07))
  return {min:Math.min(.055,max*.8),max}
}
export function fitDepth(depth:number,length:number){
  const limits=insertionDepth(length)
  return Math.max(limits.min,Math.min(limits.max,depth))
}
export function poseProblem(state: Arrangement, flower: FlowerState, pose: Pose): string | undefined {
  if (!Object.values(pose).every(finite)) return '调整数值无效'
  const limits=insertionDepth(flower.length)
  if (pose.tilt<0 || pose.tilt>12 || pose.depth<limits.min-1e-8 || pose.depth>limits.max+1e-8) return '这个深度或倾角超出了花枝可用范围'
  const bottom=.179-pose.depth*Math.cos(pose.tilt*Math.PI/180)
  for (let i=0;i<=16;i++) {
    const y=bottom+(.179-bottom)*i/16, p=stemAt(pose,y)
    if (Math.hypot(p.x,p.z)+.0012>radiusAt(y)) return '花茎碰到瓶颈了，试着减小倾斜或移动插点'
  }
  for(const other of state.flowers){
    if(other.id===flower.id||other.location!=='vase')continue
    const low=Math.max(bottom,.179-other.pose.depth*Math.cos(other.pose.tilt*Math.PI/180))
    const p=stemAt(pose,low),q=stemAt(other.pose,low)
    const dx=p.x-q.x,dz=p.z-q.z,vx=pose.x-other.pose.x-dx,vz=pose.z-other.pose.z-dz
    const vv=vx*vx+vz*vz,t=vv?Math.max(0,Math.min(1,-(dx*vx+dz*vz)/vv)):0
    if(Math.hypot(dx+t*vx,dz+t*vz)<.0025)return '这里已有一枝花，换一个插点试试'
  }
}
export function availablePose(state: Arrangement, flower: FlowerState, pose:Pose={...flower.pose,tilt:0}): Pose | undefined {
  const depth=fitDepth(pose.depth,flower.length)
  const radius=Math.hypot(pose.x,pose.z),scale=radius>.014?.014/radius:1
  const x=pose.x*scale,z=pose.z*scale
  const tilt=Math.max(0,Math.min(12,pose.tilt))
  // Search outwards from the requested point before relaxing the lean. All candidates
  // use the same bottle and neighbouring-stem checks as the final placement.
  for(const lean of new Set([tilt,tilt*.65,tilt*.3,0])){
    const p=normalizePose({...pose,depth,tilt:lean,x,z})
    if(!poseProblem(state,flower,p))return p
    for(let ring=1;ring<=8;ring++){
      const steps=ring*6,r=ring*.003
      for(let i=0;i<steps;i++){
        const angle=2*Math.PI*i/steps
        p.x=x+r*Math.cos(angle);p.z=z+r*Math.sin(angle)
        if(Math.hypot(p.x,p.z)<=.016&&!poseProblem(state,flower,p))return p
      }
    }
  }
}
export function isArrangement(v: unknown): v is Arrangement {
  if (!v || typeof v!=='object') return false
  const s=v as Arrangement
  if (!Array.isArray(s.flowers)||s.flowers.length>MAX_FLOWERS||!Number.isInteger(s.nextId)||s.nextId<1||s.nextId>100000) return false
  if (![s.cupMl,s.vaseMl].every(finite)||s.cupMl<0||s.vaseMl<0||s.vaseMl>130||!finite(s.spillMl??0)||(s.spillMl??0)<0||Math.abs(s.cupMl+s.vaseMl+(s.spillMl??0)-180)>.001) return false
  if (!s.vase||![s.vase.x,s.vase.z,s.vase.yaw].every(finite)||Math.abs(s.vase.x)>(s.tools?.61:.04)||Math.abs(s.vase.z)>(s.tools?.54:.04)||s.vase.yaw<0||s.vase.yaw>=360) return false
  if(s.tools && (![s.tools.cup,s.tools.scissors].every(p=>Array.isArray(p)&&p.length===3&&p.every(finite)&&Math.abs(p[0])<=.60&&Math.abs(p[2])<=.51&&p[1]>=.74&&p[1]<=1.18)||!finite(s.tools.vaseY)||s.tools.vaseY<.74||s.tools.vaseY>1.18||(s.tools.rotations&&!Object.values(s.tools.rotations).every(validRotation))))return false
  const ids=new Set<string>(),slots=new Set<number>()
  for (const f of s.flowers) {
    if (!f||!/^f-[1-9]\d*$/.test(f.id)||ids.has(f.id)||Number(f.id.slice(2))>=s.nextId||!Object.hasOwn(FLOWERS,f.kind)||!['cup','table','vase'].includes(f.location)) return false
    if(f.stockLength!==undefined&&(!finite(f.stockLength)||f.stockLength<.14||f.stockLength>1.1))return false
    if(f.headScale!==undefined&&(!finite(f.headScale)||f.headScale<MATERIAL_LIMITS.minHead||f.headScale>MATERIAL_LIMITS.maxHead))return false
    if (!finite(f.length)||f.length<MIN_STEM-1e-8||f.length>Math.min(MATERIAL_LIMITS.maxLength,stockLength(f))+.000001||!Number.isInteger(f.slot)||f.slot<0||f.slot>=MAX_FLOWERS||slots.has(f.slot)) return false
    if (!Array.isArray(f.removed)||new Set(f.removed).size!==f.removed.length||f.removed.some(p=>![...flowerParts(f),...flowerDetails(f)].some(part=>part.id===p))) return false
    if(f.tableRotation&&!validRotation(f.tableRotation))return false
    if (!f.pose||!['yaw','tilt','depth','x','z'].every((k)=>finite(f.pose[k as keyof Pose]))||f.pose.yaw<0||f.pose.yaw>=360) return false
    ids.add(f.id);slots.add(f.slot)
  }
  if(s.flowers.some(f=>f.location==='vase'&&poseProblem(s,f,f.pose)))return false
  return Array.isArray(s.debris)&&s.debris.length<=150&&s.debris.every((d)=>d&&(d.gathered===undefined||typeof d.gathered==='boolean')&&typeof d.id==='string'&&d.id.length<100&&typeof d.flowerId==='string'&&typeof d.part==='string'&&d.part.length<100)&&new Set(s.debris.map((d)=>d.id)).size===s.debris.length
}
export function isSession(v: unknown): v is Session {
  if (!v||typeof v!=='object')return false
  const s=v as Session
  return ['bamboo','rain','creek'].includes(s.sceneId)&&['opening','prepare','observe','trim','arrange','tidy','bless','done'].includes(s.chapter)&&typeof s.wish==='string'&&s.wish.length<=200
}
