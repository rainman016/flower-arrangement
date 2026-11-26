import { Group, Quaternion, Vector3 } from 'three'

const jaw=new Vector3(0,-.0014,-.070)
const forward=new Vector3(0,0,-1)
const ease=(t:number)=>t*t*(3-2*t)
const unit=(n:number)=>Math.min(1,Math.max(0,n))

/** The only game-state change in this stroke happens at blade contact. */
export function shearStroke(tool:Group,cutPoint:()=>Vector3,normal:Vector3,view:Vector3,commit:()=>boolean){
  const home=tool.position.clone(),rest=tool.quaternion.clone()
  const aim=new Vector3().crossVectors(normal,view)
  if(aim.lengthSq()<.001)aim.set(-1,0,0)
  aim.normalize()
  const direction=forward.clone().applyQuaternion(rest)
  if(aim.dot(direction)<0)aim.negate()
  const end=new Quaternion().setFromUnitVectors(direction,aim).multiply(rest)
  const offset=jaw.clone().applyQuaternion(end),contact=new Vector3(),start=performance.now()
  return {
    closed:false,
    update(now:number,reduced:boolean){
      const elapsed=reduced?680:now-start
      const approach=ease(unit(elapsed/285)),close=ease(unit((elapsed-285)/115)),back=ease(unit((elapsed-435)/235))
      if(!this.closed)contact.copy(cutPoint()).sub(offset)
      tool.position.lerpVectors(home,contact,approach*(1-back))
      tool.quaternion.slerpQuaternions(rest,end,approach*(1-back))
      const opening=.18+.09*approach-.27*close+.18*back
      tool.getObjectByName('scissors_half_0')!.rotation.y=-opening
      tool.getObjectByName('scissors_half_1')!.rotation.y=opening
      if(close===1&&!this.closed){this.closed=true;commit()}
      return back===1
    }
  }
}
