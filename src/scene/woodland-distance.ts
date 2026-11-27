import { BufferGeometry, InstancedMesh, Matrix4, Mesh, Object3D, Vector3 } from 'three'

// Partition the original planting positions identically for capture and play.
export function selectWoodlandDistance(root:Object3D,far:boolean,layeredBamboo=false){
  const horizon=root.getObjectByName('wooded_horizon'),m=new Matrix4(),p=new Vector3()
  const partitions:BufferGeometry[]=[]
  root.updateWorldMatrix(true,true)
  root.traverse(o=>{
    if(!(o as Mesh).isMesh)return
    if(o.userData.liveCreekBank){if(far)o.visible=false;return}
    for(let parent:Object3D|null=o;parent;parent=parent.parent){
      if(parent===horizon){if(!far)o.visible=false;return}
    }
    const tree=o as InstancedMesh
    if(!tree.isInstancedMesh){
      const mesh=o as Mesh
      if(/^bamboo_bank_(grass|fern)_(near|far)$/.test(mesh.name)){
        if(mesh.name.endsWith('_far')!==far)mesh.visible=false
        return
      }
      if(/^(bamboo_side_crown_3_twigs|bamboo_verge_grass|bamboo_bank_grass|bamboo_bank_fern_leaves|root_pocket_litter)$/.test(mesh.name)){
        const source=mesh.geometry,index=source.index,position=source.attributes.position
        // A dry leaf can sit only millimetres above the path. Keep that contact in
        // the same depth buffer as the soil rather than rounding it to centimetres.
        const radius=mesh.name==='root_pocket_litter'?8:layeredBamboo?6:mesh.name.includes('twigs')?4.2:3.2
        const length=index?.count??position.count,indices:number[]=[]
        // These batches are merged in world space. Classify their actual triangles,
        // not the batch origin; its location says nothing about the far edge.
        for(let t=0;t+2<length;t+=3){
          const a=index?index.getX(t):t,b=index?index.getX(t+1):t+1,c=index?index.getX(t+2):t+2
          p.set((position.getX(a)+position.getX(b)+position.getX(c))/3,
            (position.getY(a)+position.getY(b)+position.getY(c))/3,
            (position.getZ(a)+position.getZ(b)+position.getZ(c))/3).applyMatrix4(mesh.matrixWorld)
          if((p.x*p.x+p.z*p.z>radius*radius)===far)indices.push(a,b,c)
        }
        if(!indices.length){mesh.visible=false;return}
        const part=new BufferGeometry()
        for(const [name,attribute] of Object.entries(source.attributes))part.setAttribute(name,attribute)
        part.setIndex(indices);part.boundingSphere=source.boundingSphere
        mesh.geometry=part;partitions.push(part);return
      }
      // Mid-distance and ground-level coppice batches have distinct geometry from
      // the nearest moving sprays. The rock and surface texture come from the same source.
      const crown=/^bamboo_side_crown_[12]_leaves$/.test(o.name)
      const remoteRock=o.name.startsWith('mossy_bank_stone_')&&Math.hypot(o.matrixWorld.elements[12],o.matrixWorld.elements[14])>(layeredBamboo?12:5.5)
      if((crown||remoteRock)!==far)o.visible=false
      return
    }
    if(/submerged_stream_pebbles|creek_shallow_mineral_bar/.test(o.name)){
      if(far)o.visible=false
      return
    }
    const radius=layeredBamboo?(/rock|ledge/.test(o.name)?12:/grove_/.test(o.name)?5.2:4.2):/rock|ledge/.test(o.name)?4.5:2.75
    let used=0
    for(let i=0;i<tree.count;i++){
      tree.getMatrixAt(i,m);p.setFromMatrixPosition(m).applyMatrix4(tree.matrixWorld)
      // In the layered bamboo capture the roadside fronds have their own
      // parallax and receive the actual rock/terrain shadows at their feet.
      const shoulder=layeredBamboo && /fern|herb|sedge|grass/.test(o.name) &&
        p.z<-.75 && p.z> -3.90 && Math.abs(p.x)<2.85
      const outside=Math.hypot(p.x,p.z)>radius&&!shoulder
      if(outside!==far)continue
      if(used!==i){
        tree.setMatrixAt(used,m)
        if(tree.instanceColor)tree.instanceColor.array.copyWithin(used*3,i*3,i*3+3)
      }
      used++
    }
    tree.count=used;tree.visible&&=used>0;tree.instanceMatrix.needsUpdate=true
    if(tree.instanceColor)tree.instanceColor.needsUpdate=true
    // Full-forest patch callbacks would restore the original instance count.
    tree.onBeforeRender=tree.onAfterRender=tree.onBeforeShadow=tree.onAfterShadow=()=>{}
    if(used){tree.computeBoundingSphere();tree.computeBoundingBox()}
  })
  return ()=>partitions.forEach(geometry=>geometry.dispose())
}
