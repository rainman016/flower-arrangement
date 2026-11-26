import { Box3, Object3D, Quaternion, Vector3 } from 'three'
import { TABLE_BOUNDS } from '../../game/free-cut'
import type { PiecePlacement, Quat, Vec3 } from '../../game/types'
import { flowerOutline, flowerSupport, surfaceHeight } from './flower-rest'

/** Record the first contact on this particular cut piece, so replay and undo agree. */
export function cutDrop(piece:Object3D,origin:Vector3,rotation:Quaternion):PiecePlacement{
  const outline=flowerOutline(piece),v=new Vector3()
  let contact=outline[0],height=-Infinity
  for(const p of outline){
    v.copy(p).applyQuaternion(rotation)
    const y=surfaceHeight(origin.x+v.x,origin.z+v.z)-v.y
    if(y>height){height=y;contact=p}
  }
  const pivot=contact.clone().applyQuaternion(rotation).add(origin)
  const far=outline.reduce((a,b)=>a.distanceToSquared(contact)>b.distanceToSquared(contact)?a:b)
  const axis=far.clone().sub(contact).applyQuaternion(rotation).normalize()
  const horizontal=new Vector3(axis.x,0,axis.z)
  if(horizontal.lengthSq()<1e-6)horizontal.set(0,0,-1)
  horizontal.normalize()
  const down=new Quaternion().setFromUnitVectors(axis,horizontal).multiply(rotation)
  // Roll the piece onto its broadest stable face with the least extra twist.
  let best=Infinity
  const resting=down.clone(),box=new Box3(),trial=new Quaternion()
  for(let i=0;i<16;i++){
    const roll=(i-8)*Math.PI/8
    trial.setFromAxisAngle(horizontal,roll).multiply(down)
    box.makeEmpty()
    for(const p of outline)box.expandByPoint(v.copy(p).applyQuaternion(trial))
    const thickness=box.max.y-box.min.y+.0004*Math.abs(roll)
    if(thickness<best){best=thickness;resting.copy(trial)}
  }
  box.makeEmpty()
  for(const p of outline)box.expandByPoint(v.copy(p).applyQuaternion(resting))
  const landing=pivot.clone().sub(v.copy(contact).applyQuaternion(resting)),b=TABLE_BOUNDS
  landing.x=Math.max(b.left-box.min.x,Math.min(b.right-box.max.x,landing.x))
  landing.z=Math.max(b.back-box.min.z,Math.min(b.front-box.max.z,landing.z))
  landing.y=flowerSupport(piece,landing,resting)
  return {origin:origin.toArray() as Vec3,rotation:rotation.toArray() as Quat,contact:contact.toArray() as Vec3,
    landing:landing.toArray() as Vec3,resting:resting.toArray() as Quat}
}
