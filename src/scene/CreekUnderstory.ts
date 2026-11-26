import {Box3,Color,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Object3D,Vector3,type Texture} from 'three'
import {filterWoodlandSun} from './CanopyLight.ts'
import type {HeightAt} from './terrain-height'

export function creekUnderstory(root:Object3D,kit:Object3D,garden:Object3D,ground:HeightAt,
  rows:{left:Vector3;right:Vector3}[],level:number,openings:Texture,time:{value:number},placementGround:HeightAt=ground){
  kit.updateWorldMatrix(true,true);garden.updateWorldMatrix(true,true)
  const names=['forest_fern_0','forest_fern_1','forest_fern_2','forest_fern_3','ground_herb_0','ground_herb_1','understory']
  const kinds=names.flatMap(name=>{
    const source=(name.startsWith('forest')?kit:garden).getObjectByName(name)
    if(!source)return []
    const inverse=source.matrixWorld.clone().invert(),bounds=new Box3(),parts: {mesh:Mesh;matrix:Matrix4}[]=[]
    source.traverse(node=>{
      if(!(node instanceof Mesh))return
      const matrix=inverse.clone().multiply(node.matrixWorld)
      node.geometry.computeBoundingBox();bounds.union(node.geometry.boundingBox!.clone().applyMatrix4(matrix))
      parts.push({mesh:node,matrix})
    })
    return [{name,parts,bounds,size:bounds.getSize(new Vector3()),placements:[] as Matrix4[]}]
  })
  let seed=48129
  const pick=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const pivot=new Object3D(),last=new Vector3(Infinity,0,0)
  let spacing=.57,planted=0
  function plant(name:string,x:number,z:number,width:number){
    const kind=kinds.find(k=>k.name===name)
    if(!kind||placementGround(x,z)<level+.025)return
    const yaw=pick()*Math.PI*2,y=ground(x,z)
    if(y<level+.025)return
    const scale=width/Math.max(kind.size.x,kind.size.z)
    pivot.position.set(x,y-kind.bounds.min.y*scale-.018,z)
    pivot.rotation.set(0,yaw,0)
    pivot.scale.setScalar(scale);pivot.updateMatrix()
    kind.placements.push(pivot.matrix.clone());planted++
  }
  for(const row of rows){
    if(last.distanceTo(row.left)<spacing)continue
    last.copy(row.left);spacing=.48+.42*pick()
    const out=row.left.clone().sub(row.right).setY(0).normalize(),side=new Vector3(-out.z,0,out.x)
    const count=8+Math.floor(pick()*4)
    for(let i=0;i<count;i++){
      const rear=i>=5,offset=rear?.46+1.12*pick():.02+.47*pick(),along=(pick()-.5)*1.45
      const x=row.left.x+out.x*offset+side.x*along,z=row.left.z+out.z*offset+side.z*along
      const name=rear&&pick()<.40?'understory':pick()<.57?'forest_fern_'+Math.floor(pick()*4):'ground_herb_'+Math.floor(pick()*2)
      const width=name==='understory'?.76+.58*pick():name.startsWith('forest')?.51+.44*pick():.34+.30*pick()
      plant(name,x,z,width)
    }
    // The middle far-bank toe is visible below the taller bushes from the seated
    // eye. Lower complete fern rosettes interrupt that exposed strip of slope.
    if(row.left.x> -3.1&&row.left.x<4.8){
      for(let i=0;i<3;i++){
        const offset=.08+.25*pick(),along=(pick()-.5)*.90
        plant('forest_fern_'+(pick()<.5?0:3),row.left.x+out.x*offset+side.x*along,
          row.left.z+out.z*offset+side.z*along,.54+.31*pick())
      }
    }
  }
  // Low irregular colonies across the exposed near-bank sand. Leave gaps of
  // litter between them and keep them below the flower arrangement sightline.
  const farBankPlants=planted
  for(const [x,z,radius] of [[-2.55,-2.1,.55],[-1.8,-2.6,.65],[-.85,-2.75,.50],
    [.1,-2.55,.4],[-3.1,-3.1,.5],[1.5,-1.4,.4],[2.3,-2.2,.55],[-1.2,-1.5,.35]]){
    for(let i=0;i<11;i++){
      const angle=pick()*Math.PI*2,r=Math.sqrt(pick())*radius,fern=pick()<.55
      plant(fern?'forest_fern_'+Math.floor(pick()*4):'ground_herb_'+Math.floor(pick()*2),
        x+Math.cos(angle)*r,z+Math.sin(angle)*r,fern?.31+.30*pick():.24+.22*pick())
    }
  }
  const meshes:InstancedMesh[]=[],materials:MeshStandardMaterial[]=[],tint=new Color()
  for(const kind of kinds){
    if(!kind.placements.length)continue
    for(const part of kind.parts){
      if(!(part.mesh.material instanceof MeshStandardMaterial))continue
      const material=part.mesh.material.clone(),leaf=/leaves/.test(part.mesh.name)
      material.envMapIntensity=.48;material.roughness=leaf?.91:.98
      if(leaf)material.alphaTest=Math.max(.35,material.alphaTest)
      filterWoodlandSun(material,openings,'creek',leaf,false,null,false,time);materials.push(material)
      const mesh=new InstancedMesh(part.mesh.geometry,material,kind.placements.length)
      mesh.name='creek_understory_'+part.mesh.name
      mesh.userData.liveCreekBank=true
      kind.placements.forEach((matrix,i)=>{
        mesh.setMatrixAt(i,matrix.clone().multiply(part.matrix))
        tint.setRGB(.80+.16*pick(),.84+.14*pick(),.76+.15*pick());mesh.setColorAt(i,tint)
      })
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{}
      mesh.computeBoundingSphere();root.add(mesh);meshes.push(mesh)
    }
  }
  const counts=Object.fromEntries(kinds.map(k=>[k.name,k.placements.length]))
  return {planted,counts,farBankPlants,nearBankPlants:planted-farBankPlants,dispose:()=>{
    for(const mesh of meshes){mesh.removeFromParent();mesh.dispose()}
    // The GLB loader owns the shared source geometry and textures.
    for(const material of materials)material.dispose()
  }}
}
