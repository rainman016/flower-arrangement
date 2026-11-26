import type { Arrangement, Vec3, Quat } from './types'

export const DESK={left:-.6,right:.6,back:-.50,front:.37,top:.758}
export const BOX={z:-.215,scaleX:.78,scaleZ:.72,halfX:.305*.78,halfZ:.196*.72,base:.774,rim:.809}
export const CUP_START:Vec3=[0,BOX.base,BOX.z]
export const SHEARS_START:Vec3=[.143,.783,BOX.z]
export const VASE_START:Vec3=[-.145,BOX.base,BOX.z]
export const inBox=(x:number,z:number,margin=0)=>Math.abs(x)<=BOX.halfX-margin&&Math.abs(z-BOX.z)<=BOX.halfZ-margin
export const validRotation=(q:unknown):q is Quat=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<.002

export function migrateDesk(s:Arrangement):Arrangement{
  const t=s.tools
  if(!t||t.layout===2)return s
  const remap=(p:Vec3):Vec3=>p[1]>=.772&&Math.abs(p[0])<=.3&&Math.abs(p[2])<=.196?[p[0]*BOX.scaleX,p[1],BOX.z+p[2]*BOX.scaleZ]:p
  const originalVase=s.vase.x===0&&s.vase.z===0&&t.vaseY===BOX.base
  const [x,y,z]=originalVase?VASE_START:remap([s.vase.x,t.vaseY,s.vase.z-.025])
  const cup=t.cup[0]===-.17&&t.cup[2]===-.045?CUP_START:remap(t.cup)
  const scissors=t.scissors[0]===.18&&t.scissors[2]===.025?SHEARS_START:remap(t.scissors)
  return {...s,vase:{...s.vase,x,z:z+.025},tools:{...t,layout:2,cup,scissors,vaseY:y},
    flowers:s.flowers.map(f=>f.table?{...f,table:remap(f.table)}:f),
    debris:s.debris.map(d=>d.shape?{...d,shape:{...d.shape,landing:remap(d.shape.landing)}}:d)}
}

