import {MathUtils,Vector3} from 'three'
import {DESK} from '../game/desk-layout.ts'
import type {deskView} from './core/desk-space'

export function arrivalFraming(width:number,height:number,desk:ReturnType<typeof deskView>){
  const pitch=MathUtils.degToRad(-12),aspect=width/Math.max(1,height),eye=desk.eye
  const xAxis=new Vector3(1,0,0),p=new Vector3()
  let tangent=Math.tan(MathUtils.degToRad(desk.fov*.5))
  for(const z of [DESK.back,DESK.front]){
    p.set(DESK.right,DESK.top,z).sub(eye).applyAxisAngle(xAxis,-pitch)
    tangent=Math.max(tangent,Math.abs(p.y)/(-p.z*.88),p.x/(-p.z*aspect*.93))
  }
  return {pitch,fov:MathUtils.radToDeg(2*Math.atan(tangent))}
}
