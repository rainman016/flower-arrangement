import {BufferGeometry,Color,Float32BufferAttribute,Matrix4,Mesh,MeshStandardMaterial,Object3D,Vector3,type Texture} from 'three'
import {terrainSampler,type HeightAt} from './terrain-height'

const ease=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t)}
export const bambooPathCenter=(z:number)=>-.12+.30*Math.sin((z+4.8)*.27)-.62*ease(6.5,12,-z)

// The old bowl descends three metres immediately beyond the clearing. Fill that
// bowl in geometry, before the detail surface and contact maps sample its height.
// Everything rooted in it receives the same displacement, including existing moss.
export function continueBambooGround(root:Object3D,terrain:Mesh,ground:HeightAt){
  const owned:BufferGeometry[]=[],point=new Vector3(),inverse=terrain.matrixWorld.clone().invert()
  const lift=(x:number,z:number)=>{
    const along=ease(4.25,5.75,-z),across=1-ease(7.5,16,Math.abs(x))
    const lane=x-bambooPathCenter(z)
    const shoulder=(.26+.10*Math.sin(x*.83+z*.41)+.065*Math.cos(z*.74-x*1.8))*(1-Math.exp(-lane*lane/1.42))
    const hummock=(cx:number,cz:number,rx:number,rz:number,h:number)=>h*Math.exp(-Math.pow((x-cx)/rx,2)-Math.pow((z-cz)/rz,2))
    const bankRise=(hummock(-1.45,-8.1,1.25,1.8,.27)+hummock(1.18,-10.3,1.55,2.4,.33))*(1-.75*Math.exp(-lane*lane/.52))
    // Beyond the path bend the ground gently falls away under the grove. A tall
    // rear mound would project bare earth all the way to the image's upper edge.
    const backFall=.47*ease(8,16,-z)+.16*ease(16,27,-z)
    const destination=.022+shoulder+bankRise-backFall+
      .025*Math.sin(z*.71+x*.82)+.018*Math.sin(z*1.63-x*1.2)
    return Math.max(0,destination-ground(x,z))*along*across
  }
  for(const mesh of [terrain,root.getObjectByName('bank_moss')]){
    if(!(mesh instanceof Mesh))continue
    const geometry=mesh.geometry.clone(),vertices=geometry.attributes.position
    inverse.copy(mesh.matrixWorld).invert()
    for(let i=0;i<vertices.count;i++){
      point.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld)
      point.y+=lift(point.x,point.z);point.applyMatrix4(inverse);vertices.setXYZ(i,point.x,point.y,point.z)
    }
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    mesh.geometry=geometry;owned.push(geometry)
  }
  const at=terrainSampler(terrain)
  let planted=0
  root.traverse(node=>{
    if(!node.userData.prototype)return
    node.getWorldPosition(point);const rise=at(point.x,point.z)-ground(point.x,point.z)
    const stem=String(node.userData.prototype).startsWith('grove_')&&point.z< -4.25
    if(rise<.001&&!stem)return
    point.y+=rise
    if(stem)point.y=Math.min(point.y,at(point.x,point.z)-.055)
    node.position.copy(node.parent!.worldToLocal(point));node.updateMatrixWorld(true);planted++
  })
  root.userData.bambooPath={planted,profile:[-4,-6,-8,-10,-14,-20,-27].map(z=>({z,y:at(bambooPathCenter(z),z)}))}
  return {at,dispose:()=>owned.forEach(g=>g.dispose())}
}

// Young culms and low side crowns occupy the space below the adult canopy.
// Their roots stay outside the worn track; groups overlap at different depths
// instead of forming a continuous hedge or a camera-facing foliage plane.
export function bambooMiddleGrove(root:Object3D,ground:HeightAt){
  let seed=46129
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const pockets=[[-3.3,-5.8,4], [3.35,-6.5,4],[-2.8,-8.2,6],[3.05,-9.1,6],
    [-2.4,-11.9,7],[2.15,-12.8,7],[-3.6,-15.5,7],[3.5,-16.7,7],
    [-5.6,-10.2,6],[5.8,-12.5,6],[-6.1,-18.7,7],[6.5,-20.3,7],
    [-1.8,-19.9,5],[1.7,-22.8,6],[-3.8,-25.7,8],[3.9,-27.4,8],
    [-1.1,-30.4,7],[1.7,-34.3,7],[-7.5,-28.9,6],[7.8,-30.1,6]]
  let planted=0
  for(const [cx,cz,count] of pockets){
    const phase=random()*Math.PI*2
    for(let j=0;j<count;j++){
      const bearing=phase+j*2.399963,radius=.28+Math.sqrt(random())*1.05
      let x=cx+Math.cos(bearing)*radius
      const z=cz+Math.sin(bearing)*radius,center=bambooPathCenter(z),clearance=z> -25?.82:.44
      if(Math.abs(x-center)<clearance)x=center+Math.sign(cx)*(clearance+.22*random())
      const stem=new Object3D(),width=.42+.38*random(),height=z< -14?.35+.30*random():.18+.27*random()
      stem.name='bamboo_regrowth_'+planted;stem.userData.prototype='grove_'+planted%3
      stem.position.set(x,ground(x,z)-.065,z)
      stem.rotation.set((random()-.5)*.19,random()*Math.PI*2,(random()-.5)*.22)
      stem.scale.set(width,height,width*(.76+.38*random()));root.add(stem);stem.updateMatrixWorld(true);planted++
    }
  }
  root.userData.bambooRegrowth=planted
}

// Keep the live inner woodland in every direction; farther planting is supplied
// by the matching six-face depth capture, rather than deleting side undergrowth.
export function keepBambooPlant(kind:string,matrix:Matrix4){
  const x=matrix.elements[12],z=matrix.elements[14],r=Math.hypot(x,z)
  if(kind.startsWith('grove_'))return true
  if(/rock|ledge|rootwood/.test(kind))return r<12
  if(kind.startsWith('bryophyte_'))return r<5.5
  if(r<13.5)return true
  const pocket=Math.sin(x*14.7+z*31.3)*43758.5453
  const sample=pocket-Math.floor(pocket)
  if(z> -2||Math.abs(x)>7.5)return r<27&&sample<.40
  return z< -4&&z> -23&&Math.abs(x-bambooPathCenter(z))<4.1&&sample<(r<12?.29:.12)
}

// A low, continuous 3D forest floor extends behind the finite imported patch.
// Trees beyond it are new instances of the existing authored bamboo prototypes.
export function bambooOuterGround(root:Object3D,ground:HeightAt,floor:Texture){
  const positions:number[]=[],uv:number[]=[],colours:number[]=[],indices:number[]=[]
  const rings=13,sides=128,tone=new Color(),earth=new Color('#4c5840'),humus=new Color('#343d2f')
  const land=(x:number,z:number)=>ground(x,z)+Math.max(0,Math.hypot(x,z)-26)*.016-.11
  for(let row=0;row<rings;row++)for(let col=0;col<sides;col++){
    const radius=25+row*2.1,angle=col/sides*Math.PI*2,x=radius*Math.sin(angle),z=-radius*Math.cos(angle)
    positions.push(x,land(x,z),z);uv.push(x*.85,z*.85)
    tone.copy(earth).lerp(humus,.45+.25*Math.sin(x*.63+z*.21)+.20*Math.cos(z*.91-x*.32))
    colours.push(tone.r,tone.g,tone.b)
    if(row<rings-1){const a=row*sides+col,b=row*sides+(col+1)%sides;indices.push(a,b,b+sides,a,b+sides,a+sides)}
  }
  const geometry=new BufferGeometry()
  for(const [name,array,size] of [['position',positions,3],['uv',uv,2],['color',colours,3]] as const)
    geometry.setAttribute(name,new Float32BufferAttribute(array,size))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  const material=new MeshStandardMaterial({map:floor,vertexColors:true,roughness:.98})
  const mesh=new Mesh(geometry,material);mesh.name='bamboo_outer_soil';mesh.receiveShadow=true;root.add(mesh)
  let seed=18327
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  for(let i=0;i<144;i++){
    const angle=i*2.399963+random()*.30,radius=29+random()*17
    const x=Math.sin(angle)*radius,z=-Math.cos(angle)*radius,plant=new Object3D()
    plant.userData.prototype='grove_'+i%3
    plant.position.set(x,land(x,z)-.025,z);plant.rotation.set((random()-.5)*.08,random()*6.28,(random()-.5)*.09)
    const scale=.79+random()*.52;plant.scale.set(.56+random()*.24,scale,.56+random()*.24)
    root.add(plant);plant.updateMatrixWorld(true)
  }
  return ()=>{geometry.dispose();material.dispose()}
}

// Retain every culm silhouette but collapse sub-centimetre cross sections and
// long straight internodes. UVs and wind weights come from original vertices.
export function bambooCulmLOD(source:BufferGeometry){
  const vertices=source.attributes.position,idx=source.index
  if(!idx)return source
  const cells=new Map<string,number>(),representative=new Uint32Array(vertices.count),indices:number[]=[]
  const sections=new Map<number,{minX:number;maxX:number;minZ:number;maxZ:number}>()
  for(let i=0;i<vertices.count;i++){
    const row=Math.round(vertices.getY(i)/.21),x=vertices.getX(i),z=vertices.getZ(i)
    const bounds=sections.get(row)??{minX:x,maxX:x,minZ:z,maxZ:z}
    bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x)
    bounds.minZ=Math.min(bounds.minZ,z);bounds.maxZ=Math.max(bounds.maxZ,z);sections.set(row,bounds)
  }
  for(let i=0;i<vertices.count;i++){
    const row=Math.round(vertices.getY(i)/.21),bounds=sections.get(row)!
    const angle=Math.atan2(vertices.getZ(i)-(bounds.minZ+bounds.maxZ)*.5,vertices.getX(i)-(bounds.minX+bounds.maxX)*.5)
    const key=((Math.round(angle/Math.PI*4)+8)%8)+','+row
    const first=cells.get(key)??i;cells.set(key,first);representative[i]=first
  }
  for(let i=0;i<idx.count;i+=3){
    const a=representative[idx.getX(i)],b=representative[idx.getX(i+1)],c=representative[idx.getX(i+2)]
    if(a!==b&&b!==c&&a!==c)indices.push(a,b,c)
  }
  const geometry=source.clone();geometry.setIndex(indices);return geometry
}

// Four triangles keep the folded midrib of each blade. Do not enlarge surviving
// leaves: every original leaf remains a separate small silhouette and sky gap.
export function bambooLeafLOD(source:BufferGeometry){
  const vertices=source.attributes.position,faces=source.index
  if(!faces)return source
  const parents=Int32Array.from({length:vertices.count},(_,i)=>i)
  const find=(i:number)=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i}
  for(let i=0;i<faces.count;i+=3){const a=find(faces.getX(i));parents[find(faces.getX(i+1))]=a;parents[find(faces.getX(i+2))]=a}
  const islands=new Map<number,number[]>(),indices:number[]=[],points=Array.from({length:vertices.count},(_,i)=>new Vector3().fromBufferAttribute(vertices,i))
  for(let i=0;i<vertices.count;i++){const key=find(i),list=islands.get(key)??[];list.push(i);islands.set(key,list)}
  const axis=new Vector3(),side=new Vector3(),offset=new Vector3(),center=new Vector3(),normal=new Vector3()
  for(const members of islands.values()){
    if(members.length<5||members.length>48){
      const key=find(members[0])
      for(let i=0;i<faces.count;i+=3)if(find(faces.getX(i))===key)indices.push(faces.getX(i),faces.getX(i+1),faces.getX(i+2))
      continue
    }
    let base=members[0],tip=base,longest=0
    for(const a of members)for(const b of members){const d=points[a].distanceToSquared(points[b]);if(d>longest){base=a;tip=b;longest=d}}
    axis.subVectors(points[tip],points[base]).normalize();normal.fromBufferAttribute(source.attributes.normal,base)
    side.crossVectors(axis,normal).normalize();center.copy(points[base]).lerp(points[tip],.48)
    let left=base,right=base,mid=base,min=Infinity,max=-Infinity,nearest=Infinity
    for(const i of members){
      const cross=offset.subVectors(points[i],points[base]).dot(side),d=points[i].distanceToSquared(center)
      if(cross<min){min=cross;left=i}if(cross>max){max=cross;right=i}
      if(d<nearest){nearest=d;mid=i}
    }
    for(const [a,b,c] of [[base,left,mid],[base,mid,right],[left,tip,mid],[mid,tip,right]]){
      if(a===b||b===c||a===c)continue
      const facing=offset.subVectors(points[b],points[a]).cross(center.subVectors(points[c],points[a])).dot(normal)
      indices.push(a,facing>=0?b:c,facing>=0?c:b)
    }
  }
  const geometry=source.clone();geometry.setIndex(indices);return geometry
}
