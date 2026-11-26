import { Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import type { FlowerState } from '../../game/types'
import { paniclePoint } from '../../content/catalog'
import { sectionEnd } from '../../game/free-cut'
import { sliceY } from './clip-geometry'

/** Give each stalk its own base-to-tip coordinate. Attached spikelets keep their own cut history. */
export function prepareSection(group:Group,flower:FlowerState,id:string){
  const position=group.position.clone(),rotation=group.quaternion.clone(),scale=group.scale.clone()
  group.position.set(0,0,0);group.quaternion.identity();group.scale.setScalar(1)
  group.updateMatrixWorld(true)
  const twigs:Group[]=[],meshes:Mesh[]=[],tip=new Vector3(),v=new Vector3()
  function collect(node:Object3D){
    if(node.userData.spikelet!==undefined){twigs.push(node as Group);return}
    if(node instanceof Mesh){
      meshes.push(node)
      const points=node.geometry.getAttribute('position')
      for(let i=0;i<points.count;i++){
        v.fromBufferAttribute(points,i).applyMatrix4(node.matrixWorld)
        if(v.lengthSq()>tip.lengthSq())tip.copy(v)
      }
    }
    node.children.forEach(collect)
  }
  group.children.forEach(collect)
  if(flower.kind==='grass'&&(id==='side-panicle'||id==='side-bloom'))tip.set(...paniclePoint(id,1,flower.headScale??1))
  const extent=Math.max(.0001,tip.length()),axis=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),tip.normalize())
  const inverse=new Matrix4().makeRotationFromQuaternion(axis.clone().invert())
  const end=sectionEnd(flower,id)
  group.clear()
  for(const mesh of meshes){
    const matrix=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)
    const original=mesh.geometry
    let geometry=original.clone().applyMatrix4(matrix)
    original.dispose()
    if(end<1){const full=geometry;geometry=sliceY(full,-Infinity,extent*end);full.dispose()}
    mesh.removeFromParent();mesh.geometry=geometry;mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.setScalar(1)
    group.add(mesh)
  }
  for(const twig of twigs){
    const key=id+'-twig-'+twig.userData.spikelet
    const matrix=new Matrix4().multiplyMatrices(inverse,twig.matrixWorld)
    matrix.decompose(twig.position,twig.quaternion,twig.scale)
    const at=twig.position.y/extent
    twig.removeFromParent()
    if(flower.removed.includes(key)||end<1&&at>=end){
      twig.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()});continue
    }
    delete twig.userData.spikelet
    twig.name='part-'+key;twig.userData={target:key,detail:true,branchAttachment:at}
    prepareSection(twig,flower,key);group.add(twig)
  }
  group.userData.extent=extent
  group.position.copy(position);group.quaternion.copy(rotation).multiply(axis);group.scale.copy(scale)
}
