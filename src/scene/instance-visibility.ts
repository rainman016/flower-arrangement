import {Frustum,InstancedMesh,Matrix4,Object3D,type Camera} from 'three'

/** A planted box is tighter than a canopy sphere; only change draw counts. */
export function installInstanceVisibility(root:Object3D){
 root.updateMatrixWorld(true)
 const cameras=new WeakMap<Camera,{matrix:Matrix4;planes:Frustum}>(),clip=new Matrix4()
 const planesFor=(camera:Camera)=>{
  clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  let entry=cameras.get(camera)
  if(!entry){entry={matrix:new Matrix4(),planes:new Frustum()};cameras.set(camera,entry);entry.matrix.elements.fill(NaN)}
  if(!entry.matrix.equals(clip)){entry.matrix.copy(clip);entry.planes.setFromProjectionMatrix(clip,camera.coordinateSystem)}
  return entry.planes
 }
 root.traverse(object=>{
  if(!(object instanceof InstancedMesh))return
  const mesh=object,count=mesh.count;mesh.computeBoundingBox()
  if(!mesh.boundingBox)return
  const bounds=mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(/grit|stone|rock|pebble|mineral/.test(mesh.name)?.015:.28)
  const select=(camera:Camera)=>{mesh.count=planesFor(camera).intersectsBox(bounds)?count:0}
  mesh.onBeforeRender=(_renderer,_scene,camera)=>select(camera)
  mesh.onBeforeShadow=(_renderer,_object,_camera,shadowCamera)=>select(shadowCamera)
  mesh.onAfterRender=mesh.onAfterShadow=()=>{mesh.count=count}
 })
}
