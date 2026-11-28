import {describe,it,expect} from 'vitest'
import {BoxGeometry,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera} from 'three'
import {installInstanceVisibility} from '../../src/scene/instance-visibility'
describe('planted instance bounds',()=>{
 it('skips off-camera groups without mutating GPU attributes, and retains shadow casters',()=>{
  const root=new Group(),mesh=new InstancedMesh(new BoxGeometry(.2,1,.2),new MeshStandardMaterial(),4)
  for(let i=0;i<4;i++)mesh.setMatrixAt(i,new Matrix4().makeTranslation((i-1.5)*.3,0,4))
  root.add(mesh);installInstanceVisibility(root)
  const before=Array.from(mesh.instanceMatrix.array),version=mesh.instanceMatrix.version
  const camera=new PerspectiveCamera(65,1,.1,20);camera.updateMatrixWorld()
  mesh.onBeforeRender(null as never,null as never,camera,null as never,null as never,null as never)
  expect(mesh.count).toBe(0)
  mesh.onAfterRender(null as never,null as never,camera,null as never,null as never,null as never)
  expect(mesh.count).toBe(4)
  const shadow=camera.clone();shadow.lookAt(0,0,4);shadow.updateMatrixWorld()
  mesh.onBeforeShadow(null as never,null as never,camera,shadow,null as never,null as never,null as never)
  expect(mesh.count).toBe(4);expect(Array.from(mesh.instanceMatrix.array)).toEqual(before);expect(mesh.instanceMatrix.version).toBe(version)
 })
})
