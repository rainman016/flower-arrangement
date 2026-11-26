import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Group,InstancedMesh,Mesh,MeshLambertMaterial,MeshStandardMaterial,Object3D,Ray,Vector3,type Texture} from 'three'
import {distantLeafGeometry} from './ForestFloor.ts'
import {MarchingCubes} from 'three/examples/jsm/objects/MarchingCubes.js'
import {forestSun} from './CanopyLight.ts'
import type {SceneId} from '../game/types'
import type {HeightAt} from './terrain-height'

const tau=2*Math.PI
const smooth=(start:number,end:number,n:number)=>{const t=Math.max(0,Math.min(1,(n-start)/(end-start)));return t*t*(3-2*t)}

// Only the densest parts of the scan receive an interior. Individual outer leaves
// and the open gaps between boughs still define the silhouette.
function crownInterior(source:BufferGeometry,material:MeshLambertMaterial){
  source.computeBoundingBox()
  const center=source.boundingBox!.getCenter(new Vector3()),extent=source.boundingBox!.getSize(new Vector3()).multiplyScalar(1.30)
  const size=24,surface=new MarchingCubes(size,material,false,false,14000),p=new Vector3()
  const points=source.attributes.position
  for(let i=0;i<points.count;i++){
    p.fromBufferAttribute(points,i).sub(center).divide(extent).addScalar(.5).multiplyScalar(size)
    surface.field[Math.round(p.x)+size*(Math.round(p.y)+size*Math.round(p.z))]+=.125
  }
  surface.blur(.68);surface.isolation=1.72;surface.update()
  const geometry=new BufferGeometry(),positions=[],normals=[],colours=[],c=new Color()
  const shade=new Color('#243d37'),light=new Color('#526946')
  for(let i=0;i<surface.count;i++){
    p.fromArray(surface.positionArray,3*i).multiply(extent).multiplyScalar(.44).add(center)
    positions.push(p.x,p.y,p.z)
    const grain=.5+.19*Math.sin(p.x*11+p.y*4.8)+.20*Math.cos(p.z*13-p.y*7)
    p.fromArray(surface.normalArray,3*i).divide(extent).normalize();normals.push(p.x,p.y,p.z)
    c.copy(shade).lerp(light,grain+.10*p.y);colours.push(c.r,c.g,c.b)
  }
  surface.geometry.dispose()
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3))
  geometry.setAttribute('color',new Float32BufferAttribute(colours,3));geometry.computeBoundingSphere()
  return geometry
}

// Preserve the scan's main boughs, with a coarse trunk mesh for distant trees.
function ridgeWood(kit:Object3D){
  const pos:number[]=[],norm:number[]=[],col:number[]=[]
  const v=new Vector3(),p=new Vector3(),wood=new Color('#535342')
  for(const name of ['forest_tree_0_bark','forest_tree_0_bark001']){
    const mesh=kit.getObjectByName(name)
    if(!(mesh instanceof Mesh))continue
    // Cluster the original trunk's vertices into 15 cm cells; omit faces that collapse.
    const source=mesh.geometry
    const vertices=source.attributes.position,index=source.index!,cells=new Map<string,{p:Vector3;n:number}>()
    const refs=Array.from({length:vertices.count},(_,i)=>{
      v.fromBufferAttribute(vertices,i)
      const key=[v.x,v.y,v.z].map(k=>Math.floor(k/.15)).join(',')
      let c=cells.get(key);if(!c){c={p:new Vector3(),n:0};cells.set(key,c)}
      c.p.add(v);c.n++;return c
    })
    for(const cell of cells.values())cell.p.divideScalar(cell.n)
    for(let i=0;i<index.count;i+=3){
      const a=refs[index.getX(i)],b=refs[index.getX(i+1)],c=refs[index.getX(i+2)]
      if(a===b||b===c||a===c)continue
      v.subVectors(b.p,a.p).cross(p.subVectors(c.p,a.p)).normalize()
      for(const vertex of [a.p,b.p,c.p]){pos.push(vertex.x,vertex.y,vertex.z);norm.push(v.x,v.y,v.z);col.push(wood.r,wood.g,wood.b)}
    }
  }
  const tree=new BufferGeometry()
  tree.setAttribute('position',new Float32BufferAttribute(pos,3));tree.setAttribute('normal',new Float32BufferAttribute(norm,3))
  tree.setAttribute('color',new Float32BufferAttribute(col,3));tree.computeBoundingSphere()
  return tree
}

export function woodlandHorizon(root:Object3D,kit:Object3D,ground:HeightAt,id:SceneId,floor:Texture,openings:Texture){
  const group=new Group();group.name='wooded_horizon';root.add(group)
  const seed=id==='bamboo'?61:id==='creek'?184:354
  let state=seed
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  const phase=seed*.061,edge=Number(root.getObjectByName('terrain')?.userData.heightfieldSize)/2
  function land(x:number,z:number){
    const r=Math.hypot(x,z),a=Math.atan2(x,-z)
    const crest=32+2.4*Math.sin(3*a+phase)+1.65*Math.cos(5*a)
    const first=(1.6+1.35*Math.sin(3*a+phase)+.75*Math.cos(6*a-.2))*Math.exp(-(((r-crest)/5.6)**2))
    const last=(6.8+2.7*Math.cos(2*a-phase)+1.45*Math.sin(5*a+2))*Math.exp(-(((r-48-2.3*Math.sin(4*a))/7.1)**2))
    const saddle=id==='rain'?0:1-smooth(.04,.42,Math.abs(a+.08*Math.sin(r*.14)))
    const hill=-.45+first+last+.42*Math.sin(x*.48+z*.21)+.24*Math.cos(z*.57-x*.12)-saddle*(3.4+.78*last)
    const t=smooth(19,27,r),native=ground(x,z)
    const beyond=smooth(edge,edge+5,Math.max(Math.abs(x),Math.abs(z)))
    const exterior=Math.max(native+.10,hill)*(1-beyond)+hill*beyond
    return native*(1-t)+exterior*t-.22*(1-t)
  }
  const landMaterial=new MeshLambertMaterial({vertexColors:true,map:floor})
  const terrain=new BufferGeometry(),positions:number[]=[],colours:number[]=[],indices:number[]=[],uv:number[]=[]
  const rings=21,sides=168,soil=new Color('#526956'),leaf=new Color('#80966d'),c=new Color()
  for(let r=0;r<rings;r++)for(let k=0;k<sides;k++){
    const radius=18+r*1.85,a=k*tau/sides,x=radius*Math.sin(a),z=-radius*Math.cos(a)
    positions.push(x,land(x,z),z);uv.push(x*.38,z*.38)
    c.copy(soil).lerp(leaf,.48+.25*Math.sin(x*.68+z*.3)+.17*Math.cos(z*.94))
    colours.push(c.r,c.g,c.b)
    if(r<rings-1){
      const i=r*sides+k,j=r*sides+(k+1)%sides
      indices.push(i,j,j+sides,i,j+sides,i+sides)
    }
  }
  terrain.setAttribute('position',new Float32BufferAttribute(positions,3));terrain.setAttribute('color',new Float32BufferAttribute(colours,3))
  terrain.setAttribute('uv',new Float32BufferAttribute(uv,2));terrain.setIndex(indices);terrain.computeVertexNormals()
  const hillside=new Mesh(terrain,landMaterial);hillside.name='distant_wooded_slopes';group.add(hillside)
  // Read the two exact triangles below a root rather than projecting the old
  // square heightfield past its boundary.
  const a0=new Vector3(),b0=new Vector3(),c0=new Vector3(),hit=new Vector3(),ray=new Ray(undefined,new Vector3(0,-1,0))
  const vertices=terrain.attributes.position
  function seat(x:number,z:number){
    const theta=(Math.atan2(x,-z)+tau)%tau,k=Math.floor(theta/tau*sides)%sides
    const r=Math.hypot(x,z)*Math.cos(theta-(k+.5)*tau/sides)/Math.cos(Math.PI/sides)
    const band=Math.max(0,Math.min(rings-2,Math.floor((r-18)/1.85)))
    const first=6*(band*sides+k);ray.origin.set(x,20,z)
    for(let i=first;i<first+6;i+=3){
      a0.fromBufferAttribute(vertices,indices[i]);b0.fromBufferAttribute(vertices,indices[i+1]);c0.fromBufferAttribute(vertices,indices[i+2])
      if(ray.intersectTriangle(a0,b0,c0,false,hit))return Math.max(hit.y,Math.max(Math.abs(x),Math.abs(z))<=edge?ground(x,z):-Infinity)
    }
    throw Error('远林树根超出地形')
  }
  const source=kit.getObjectByName('forest_tree_0_leaves') as Mesh<BufferGeometry,MeshStandardMaterial>
  const leaves=distantLeafGeometry(source.geometry,5),bark=ridgeWood(kit)
  const leafMat=new MeshLambertMaterial({map:source.material.map,side:DoubleSide,color:'#c4d2bd',alphaTest:.28})
  const barkMat=new MeshLambertMaterial({vertexColors:true})
  const coreMat=new MeshLambertMaterial({vertexColors:true}),interior=crownInterior(source.geometry,coreMat)
  coreMat.onBeforeCompile=s=>{
    s.uniforms.boughOpenings={value:openings}
    s.vertexShader='varying vec3 boughLocal;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nboughLocal=position;')
    s.fragmentShader='varying vec3 boughLocal; uniform sampler2D boughOpenings;\n'+s.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 clusterUV=boughLocal.xy*.32+boughLocal.z*vec2(.19,.13);
        float gap=.64*texture2D(boughOpenings,clusterUV).r+.36*texture2D(boughOpenings,clusterUV*1.83+vec2(.32,.67)).r;
        if(gap>.76)discard;
        diffuseColor.rgb*=.66+.51*gap;`)
  }
  const plant=new Object3D(),instances:InstancedMesh[]=[],shade=new Float32Array(positions.length/3)
  const [sunX,sunY,sunZ]=forestSun[id]
  for(let sector=0;sector<12;sector++){
    const transforms=[]
    for(const radius of [23,27.5,32.5,39,45,51]){
      const count=Math.round(radius*tau/12/2.85)
      for(let i=0;i<count;i++){
        const a=(sector+(i+.13+.73*rand())/count)*tau/12
        const r=radius+(rand()-.5)*4.6,x=r*Math.sin(a),z=-r*Math.cos(a)
        const pocket=.49+.28*Math.sin(x*.38+z*.12)+.22*Math.cos(z*.44-x*.18)
        if(rand()>Math.min(.98,.60+.49*pocket))continue
        const size=(.44+.30*rand()+.22*pocket)*(1-.17*smooth(29,52,r))
        plant.scale.set(size*(.87+.38*rand()),size*(.76+.33*rand()),size*(.84+.32*rand()))
        plant.rotation.set((rand()-.5)*.13,rand()*tau,(rand()-.5)*.15)
        plant.position.set(x,seat(x,z)-.14,z)
        plant.updateMatrix();transforms.push(plant.matrix.clone())
        // Lower coppice grows in pockets beside mature trees, breaking open
        // strips into shaded banks rather than rows of isolated trunks.
        if(pocket>.38&&rand()<.73){
          const bearing=a+(rand()-.5)*3.8/r,distance=Math.min(54.5,Math.max(18.3,r+(rand()-.5)*2.7))
          const bx=distance*Math.sin(bearing),bz=-distance*Math.cos(bearing)
          const small=.34+.29*rand();plant.scale.multiplyScalar(small);plant.scale.x*=1.33;plant.scale.z*=1.25
          plant.rotation.y+=2.31;plant.position.set(bx,seat(bx,bz)-.14,bz);plant.updateMatrix()
          transforms.push(plant.matrix.clone())
        }
        // First-order crown occlusion on the distant slope, beyond the workbench shadow map.
        const shadowX=x-sunX/sunY*size*3.1,shadowZ=z-sunZ/sunY*size*3.1
        for(let j=0;j<shade.length;j++){
          const px=positions[j*3],pz=positions[j*3+2],dx=px-shadowX,dz=pz-shadowZ
          if(Math.abs(dx)>4.7||Math.abs(dz)>4.7)continue
          const canopy=Math.max(0,1-(dx*dx+dz*dz)/(3.8+6.7*size*size))
          const base=Math.max(0,1-((px-x)**2+(pz-z)**2)/2.8)
          shade[j]=Math.min(.65,shade[j]+canopy*canopy*.44+base*.28)
        }
      }
    }
    const crowns=new InstancedMesh(leaves,leafMat,transforms.length),trunks=new InstancedMesh(bark,barkMat,transforms.length)
    const cores=new InstancedMesh(interior,coreMat,transforms.length)
    crowns.name='distant_tree_crowns';trunks.name='distant_tree_trunks';cores.name='distant_crown_interiors'
    transforms.forEach((matrix,i)=>{
      crowns.setMatrixAt(i,matrix);trunks.setMatrixAt(i,matrix);cores.setMatrixAt(i,matrix)
      const shade=.75+.32*rand()
      crowns.setColorAt(i,c.setRGB(shade*(.92+.13*rand()),shade,shade*(.89+.18*rand())))
    })
    for(const batch of [crowns,trunks,cores]){batch.computeBoundingSphere();group.add(batch);instances.push(batch)}
  }
  const groundColour=terrain.attributes.color
  for(let j=0;j<shade.length;j++){
    c.fromBufferAttribute(groundColour,j).multiplyScalar(1-shade[j])
    groundColour.setXYZ(j,c.r,c.g,c.b)
  }
  groundColour.needsUpdate=true
  return ()=>{
    root.remove(group);instances.forEach(m=>m.dispose());terrain.dispose();bark.dispose()
    interior.dispose();if(leaves!==source.geometry)leaves.dispose()
    landMaterial.dispose();leafMat.dispose();barkMat.dispose();coreMat.dispose()
  }
}
