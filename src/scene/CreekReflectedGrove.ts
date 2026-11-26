import {BufferGeometry,Group,InstancedMesh,Matrix4,type Object3D} from 'three'
import {distantLeafGeometry} from './ForestFloor.ts'

// A seated depth capture cannot reveal the opposite side of a tree when the
// reflection camera moves below the water. Retain a small set of the very same
// planted trees for that view, with existing materials and leaf silhouettes.
export function creekReflectedGrove(root:Object3D){
  const sources:InstancedMesh[]=[],matrix=new Matrix4(),positions=new Map<string,{x:number;z:number}>()
  const key=(m:Matrix4)=>m.elements[12].toFixed(3)+','+m.elements[14].toFixed(3)
  root.traverse(node=>{
    if(!(node instanceof InstancedMesh)||!/^forest_tree_\d+_/.test(node.name))return
    sources.push(node)
    for(let i=0;i<node.count;i++){
      node.getMatrixAt(i,matrix)
      const x=matrix.elements[12],z=matrix.elements[14]
      if(Math.hypot(x,z)>2.75&&Math.abs(x)<11&&z< -4&&z> -18)positions.set(key(matrix),{x,z})
    }
  })
  const selected=new Set([...positions].sort((a,b)=>Math.hypot(a[1].x,a[1].z)-Math.hypot(b[1].x,b[1].z)).slice(0,18).map(([key])=>key))
  // The right-front water reflects trees beyond the nearest-to-eye subset:
  // actual reflected rays reach x=5..8, z=-14..-10 at crown height. Retain
  // those original trees as well; otherwise the mirror returns empty blue sky.
  const rightGrove=[...positions].filter(([,p])=>p.x>2.4&&p.z< -7&&p.z> -18)
  // Spread the allowance over measured reflected-ray crown footprints rather
  // than filling it with eight neighbours around a single grove centre.
  for(const [x,z] of [[5.1,-11.5],[5.9,-12.1],[7.6,-12.8],[8.8,-12.4]]){
    const nearest=[...rightGrove].sort((a,b)=>(a[1].x-x)**2+(a[1].z-z)**2-((b[1].x-x)**2+(b[1].z-z)**2))
    for(const [key] of nearest.slice(0,2))selected.add(key)
  }
  const group=new Group(),lod=new Map<BufferGeometry,BufferGeometry>(),meshes:InstancedMesh[]=[]
  group.name='creek_mirror_grove';group.visible=false
  for(const source of sources){
    const placements:Matrix4[]=[]
    for(let i=0;i<source.count;i++){source.getMatrixAt(i,matrix);if(selected.has(key(matrix)))placements.push(matrix.clone())}
    if(!placements.length)continue
    let geometry=source.geometry
    if(source.name.endsWith('_leaves')){
      if(!lod.has(geometry))lod.set(geometry,distantLeafGeometry(geometry,2))
      geometry=lod.get(geometry)!
    }
    const mesh=new InstancedMesh(geometry,source.material,placements.length)
    mesh.name='creek_mirror_'+source.name;mesh.userData.liveCreekBank=true
    mesh.matrix.copy(source.matrix);mesh.matrixAutoUpdate=false
    placements.forEach((placement,i)=>mesh.setMatrixAt(i,placement))
    mesh.receiveShadow=true;mesh.castShadow=false;mesh.raycast=()=>{}
    mesh.computeBoundingSphere();group.add(mesh);meshes.push(mesh)
  }
  group.userData.trees=selected.size
  group.userData.triangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*mesh.count,0)
  if(meshes.length)root.add(group)
  return ()=>{
    group.removeFromParent();for(const mesh of meshes)mesh.dispose()
    for(const [source,reduced] of lod)if(source!==reduced)reduced.dispose()
    // Source geometry, materials and textures belong to the environment loader.
  }
}
