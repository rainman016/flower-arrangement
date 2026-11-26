import { BufferAttribute, Group, Mesh, Quaternion, Vector2, Vector3 } from 'three'

/** A flexible stem held at its cut end. Work only on the observation instance. */
export function observationMotion(plant:Group,length:number,headWeight=0){
  const stem=plant.getObjectByName('part-stem')!.children[0] as Mesh
  const vertices=stem.geometry.getAttribute('position') as BufferAttribute
  const rest=vertices.clone()
  const attachments=plant.children.filter(node=>node.name!=='part-stem').map(node=>({
    node,position:node.position.clone(),rotation:node.quaternion.clone()
  }))
  const angle=new Vector2(),speed=new Vector2(),target=new Vector2(),offset=new Vector2()
  const previousPosition=new Vector3(),previousRotation=new Quaternion()
  const displacement=new Vector3(),rotation=new Quaternion(),axis=new Vector3()
  let initialized=false,bent=false
  const gravity=new Vector3(),wasAngle=new Vector2()
  plant.userData.stemBend=angle

  function deform(){
    // Lateral displacement increases quadratically towards the tip.
    for(let i=0;i<rest.count;i++){
      const y=rest.getY(i),weight=.5*y*y/length
      vertices.setXYZ(i,rest.getX(i)+angle.x*weight,y,rest.getZ(i)+angle.y*weight)
    }
    vertices.needsUpdate=true
    for(const {node,position,rotation:original} of attachments){
      const t=position.y/length,weight=.5*position.y*t
      node.position.set(position.x+angle.x*weight,position.y,position.z+angle.y*weight)
      axis.set(angle.y*t,0,-angle.x*t)
      const tilt=axis.length()
      if(tilt)node.quaternion.setFromAxisAngle(axis.multiplyScalar(1/tilt),tilt).multiply(original)
      else node.quaternion.copy(original)
    }
  }
  return {
    update(root:Group,delta:number,reduced:boolean){
      if(!initialized||reduced||delta<=0){
        previousPosition.copy(root.position);previousRotation.copy(root.quaternion);initialized=true
        if(bent){angle.set(0,0);speed.set(0,0);deform();bent=false}
        return false
      }
      const dt=Math.min(delta,.12)
      rotation.copy(root.quaternion).invert()
      displacement.copy(previousPosition).sub(root.position).applyQuaternion(rotation)
      gravity.set(0,-1,0).applyQuaternion(rotation)
      rotation.multiply(previousRotation)
      // A turn around the stem also carries the off-centre head and leaves.
      target.set(displacement.x*.19-rotation.z*.10+rotation.y*.044,
        displacement.z*.19+rotation.x*.10).multiplyScalar(1/Math.max(.008,delta)).clampLength(0,.15)
      previousPosition.copy(root.position);previousRotation.copy(root.quaternion)
      const load=headWeight*.14*Math.min(1.4,length/.28)
      target.x+=gravity.x*load;target.y+=gravity.z*load
      if(target.distanceToSquared(angle)<1e-10&&speed.lengthSq()<1e-8)return false
      wasAngle.copy(angle)
      const frequency=13,decay=Math.exp(-frequency*dt)
      offset.copy(angle).sub(target)
      speed.addScaledVector(offset,frequency)
      angle.copy(offset).addScaledVector(speed,dt).multiplyScalar(decay).add(target)
      speed.multiplyScalar(1-frequency*dt).addScaledVector(offset,-frequency).multiplyScalar(decay)
      const moving=target.distanceToSquared(angle)+speed.lengthSq()*.01>1e-9
      if(!moving){angle.copy(target);speed.set(0,0)}
      bent=angle.lengthSq()>0
      if(wasAngle.distanceToSquared(angle)>0)deform()
      return moving
    }
  }
}
