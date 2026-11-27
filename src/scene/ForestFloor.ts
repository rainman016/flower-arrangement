import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Group,IcosahedronGeometry,InstancedMesh,Mesh,MeshStandardMaterial,Object3D,Quaternion,Vector3} from 'three'
import type {HeightAt} from './terrain-height'
import type {SceneId} from '../game/types'
import {bambooVerge} from './BambooVerge.ts'
import {stoneFootFerns,weatherOutcrop} from './BambooOutcrop.ts'
import {stoneFootLitter} from './StoneFootLitter.ts'

// At the far bank the fold of an individual scanned leaf is subpixel. Keep one
// textured silhouette per real leaf, with its original position and bend weights.
export function distantLeafGeometry(original:BufferGeometry,stride=1){
  const faces=original.index,points=original.attributes.position
  if(!faces)return original
  const parents=Int32Array.from({length:points.count},(_,i)=>i)
  function root(i:number){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i}
  for(let i=0;i<faces.count;i+=3){
    const a=root(faces.getX(i));parents[root(faces.getX(i+1))]=a;parents[root(faces.getX(i+2))]=a
  }
  const leaves=new Map<number,number[]>(),sourceFaces=new Map<number,number[]>()
  for(let i=0;i<points.count;i++){const key=root(i),leaf=leaves.get(key)??[];leaf.push(i);leaves.set(key,leaf)}
  for(let i=0;i<faces.count;i+=3){
    const key=root(faces.getX(i)),list=sourceFaces.get(key)??[]
    list.push(faces.getX(i),faces.getX(i+1),faces.getX(i+2));sourceFaces.set(key,list)
  }
  const positions=Array.from({length:points.count},(_,i)=>new Vector3().fromBufferAttribute(points,i))
  const indices:number[]=[],axis=new Vector3(),side=new Vector3(),offset=new Vector3(),edge=new Vector3(),normal=new Vector3()
  const expanded=stride>1?points.clone():null,centroid=new Vector3()
  let order=0
  for(const [key,triangles] of sourceFaces){
    if(order++%stride!==0)continue
    const members=leaves.get(key)!
    if(expanded){
      centroid.set(0,0,0);for(const i of members)centroid.add(positions[i])
      centroid.divideScalar(members.length)
      for(const i of members){
        offset.subVectors(positions[i],centroid).multiplyScalar(Math.sqrt(stride)*1.42).add(centroid)
        expanded.setXYZ(i,offset.x,offset.y,offset.z)
      }
    }
    if(members.length<5||members.length>(original.hasAttribute('_leaf_tip')?32:18)){indices.push(...triangles);continue}
    let first=members[0],last=first,longest=0
    for(const a of members)for(const b of members){
      const dist=positions[a].distanceToSquared(positions[b]);if(dist>longest){first=a;last=b;longest=dist}
    }
    axis.subVectors(positions[last],positions[first]).normalize()
    let width=0
    for(const i of members){
      offset.subVectors(positions[i],positions[first]);offset.addScaledVector(axis,-offset.dot(axis))
      if(offset.lengthSq()>width){width=offset.lengthSq();side.copy(offset)}
    }
    let left=first,right=first,min=Infinity,max=-Infinity
    for(const i of members){
      const d=offset.subVectors(positions[i],positions[first]).dot(side)
      if(d<min){min=d;left=i}if(d>max){max=d;right=i}
    }
    if(left===first||right===first||left===last||right===last){indices.push(...triangles);continue}
    normal.fromBufferAttribute(original.attributes.normal,first)
    if(edge.crossVectors(offset.subVectors(positions[left],positions[first]),axis).dot(normal)<0)[left,right]=[right,left]
    indices.push(first,left,last,first,last,right)
  }
  if(indices.length>=faces.count*.93)return original
  const reduced=original.clone();reduced.setIndex(indices)
  if(expanded){reduced.setAttribute('position',expanded);reduced.computeBoundingSphere()}
  return reduced
}

// Fold the blades along a raised midrib. The separate dry culms retain a
// silhouette even where the tops of the fine green blades catch the sky.
function grassClump(random:()=>number){
  const positions:number[]=[],colours:number[]=[],bends:number[]=[],phases:number[]=[],indices:number[]=[]
  const colour=new Color()
  function vertex(x:number,y:number,z:number,tint:number,light:number,phase:number){
    positions.push(x,y,z);colour.setHex(tint).multiplyScalar(light);colours.push(colour.r,colour.g,colour.b)
    bends.push(Math.max(0,y)*.4);phases.push(phase)
    return bends.length-1
  }
  for(let blade=0;blade<27;blade++){
    const angle=random()*2*Math.PI,dx=Math.cos(angle),dz=Math.sin(angle)
    const distance=.065*Math.sqrt(random()),x=distance*dx,z=distance*dz,phase=angle+random()
    const height=.12+.24*random(),reach=.06+.17*random(),width=.002+.005*random()
    const dry=blade%6===0,tint=dry?0x9d925a:[0x536d32,0x637d3e,0x577042][blade%3]
    let last=0
    for(let row=0;row<=4;row++){
      const u=row/4,w=width*(.70+.30*Math.sin(u*Math.PI))*(1-u*.995)
      const bend=reach*u**1.65,px=x+dx*bend,pz=z+dz*bend,py=height*(u-.48*u**3)
      const at=vertex(px-dz*w,py,pz+dx*w,tint,.47+.69*u,phase)
      vertex(px+dx*w*.32,py+w*.58,pz+dz*w*.32,tint,.70+.64*u,phase)
      vertex(px+dz*w,py,pz-dx*w,tint,.60+.60*u,phase)
      if(row)indices.push(last,last+1,at,last+1,at+1,at,last+1,last+2,at+1,last+2,at+2,at+1)
      last=at
    }
  }
  for(let stem=0;stem<4;stem++){
    const angle=random()*6.28,dx=Math.cos(angle),dz=Math.sin(angle),h=.24+.19*random(),lean=.08+.10*random()
    let prev=0
    for(let i=0;i<=7;i++){
      const t=i/7,x=dx*lean*t*t,z=dz*lean*t*t,y=h*(t-.19*t*t),w=.0015*(1-.65*t)
      const v=vertex(x-dz*w,y,z+dx*w,0xab9961,.64+.4*t,angle)
      vertex(x+dz*w,y,z-dx*w,0xb5aa78,.80+.3*t,angle)
      if(i)indices.push(prev,prev+1,v,prev+1,v+1,v)
      prev=v
      if(i<3)continue
      const side=i%2===0?1:-1
      const tip=vertex(x+dz*.027*side,y+.018,z-dx*.027*side,0xbeae7d,1,angle)
      const hull=vertex(x+dz*.014*side+dx*.004,y+.006,z-dx*.014*side+dz*.004,0x968959,1,angle)
      indices.push(v,tip,hull)
    }
  }
  const geometry=new BufferGeometry()
  for(const [name,data,size] of [['position',positions,3],['color',colours,3],['_bend',bends,1],['_phase',phases,1]] as const)
    geometry.setAttribute(name,new Float32BufferAttribute(data,size))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  const material=new MeshStandardMaterial({vertexColors:true,roughness:.74,side:DoubleSide})
  const template=new Group(),mesh=new Mesh(geometry,material)
  mesh.name='meadow_grass_blades';mesh.userData.wind=true;template.userData.gardenPrototype='meadow_grass';template.add(mesh)
  return {template,dispose:()=>{geometry.dispose();material.dispose()}}
}

function streamSections(stream:Mesh){
  const rows=new Map<number,{left:Vector3;right:Vector3}>(),p=new Vector3()
  const {uv,position}=stream.geometry.attributes
  for(let i=0;i<position.count;i++){
    const u=uv.getX(i)
    if(u>.001&&u<.999)continue
    const v=uv.getY(i),ends=rows.get(v)??{left:new Vector3(),right:new Vector3()}
    p.fromBufferAttribute(position,i).applyMatrix4(stream.matrixWorld)
    ends[u<.5?'left':'right'].copy(p);rows.set(v,ends)
  }
  return [...rows.values()].map(s=>({...s,z:(s.left.z+s.right.z)/2}))
}

// The original channel is a nearly flat shelf. Retain the shelves under the shore
// stones and cut a winding, deeper run on the inside of the water mesh.
export function carveStreamBed(terrain:Mesh,stream:Mesh){
  const sections=streamSections(stream).map(({left,right})=>({
    middle:left.clone().lerp(right,.5),radius:left.distanceTo(right)*.5
  }))
  const geometry=terrain.geometry.clone(),position=geometry.attributes.position
  const point=new Vector3(),inverse=terrain.matrixWorld.clone().invert()
  for(let i=0;i<position.count;i++){
    point.fromBufferAttribute(position,i).applyMatrix4(terrain.matrixWorld)
    let best=Infinity,radius=0
    for(const row of sections){
      const distance=(point.x-row.middle.x)**2+(point.z-row.middle.z)**2
      if(distance<best){best=distance;radius=row.radius}
    }
    const width=Math.sqrt(best)/Math.max(.001,radius)
    if(width>=.76)continue
    const core=Math.max(0,1-(width/.76)**2)
    point.y-=core*core*(.26+.12*Math.cos(point.x*1.12+point.z*.56))
    point.applyMatrix4(inverse);position.setXYZ(i,point.x,point.y,point.z)
  }
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
  terrain.geometry=geometry
  return geometry
}

function bambooFloor(root:Object3D,ground:HeightAt){
  let state=14251
  const pick=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
  function culm(x:number,z:number,variant:number,width:number,height:number,tilt:number,yaw:number,lean:number){
    const stem=new Object3D()
    stem.userData.prototype='grove_'+variant;stem.position.set(x,ground(x,z)-.06,z)
    stem.rotation.set(tilt,yaw,lean);stem.scale.set(width,height,width)
    root.add(stem);stem.updateMatrixWorld(true)
  }
  const openPath=root.getObjectByName('environment_bamboo')?.userData.clearBambooPath
  culm(openPath?3.30:-2.36,openPath?-1.60:-2.41,1,.81,.53,-.08,1.68,-.13)
  culm(openPath?4.06:2.42,openPath?-2.67:-2.72,2,.77,.55,.12,3.12,.14)
  // Small families share a rhizome; open intervals preserve the view down the path.
  for(const [x,z,count,height] of [[-1.78,-6.85,4,1.0],[1.78,-8.3,5,1.07],[-2.9,-9.6,4,1.17],
    [-1.24,-12.8,5,1.31],[1.1,-15.1,6,1.44],[.1,-18.4,5,1.48],[2.8,-19.9,4,1.30],[-3.6,-17.2,4,1.34]]){
    for(let i=0;i<count;i++){
      const px=x+(pick()-.5)*1.75,pz=z+(pick()-.5)*1.3
      const width=.46+pick()*.28
      const tilt=(pick()-.5)*.12,yaw=pick()*Math.PI*2,lean=(pick()-.5)*.13
      culm(px,pz,i%3,width,height*(.85+pick()*.27),tilt,yaw,lean)
    }
  }
  const vertices:number[]=[],colours:number[]=[],indices:number[]=[]
  const c=new Color(),palette=[0x827044,0x908155,0xa68c57,0x665735,0x877c4d,0x9b7944]
  for(let clump=0;clump<(openPath?148:68);clump++){
    const x=(pick()-.5)*6,z=-1.65-pick()*(openPath?15.8:7.8),heading=pick()*Math.PI*2
    for(let j=0;j<5;j++){
      const px=x+(pick()-.5)*.57,pz=z+(pick()-.5)*.39,angle=heading+(pick()-.5)*3.8
      const length=.056+pick()*.092,width=length*(.060+.028*pick()),bend=(pick()-.5)*width*2
      const cos=Math.cos(angle),sin=Math.sin(angle),first=vertices.length/3
      c.setHex(palette[Math.floor(pick()*palette.length)])
      for(const [u,v,lift,brightness] of [[0,0,.001,.73],[.43,-1,.003,.87],[.47,0,.009,1.09],[.58,1,.004,1.0],[1,0,.005,.81]]){
        const cross=v*width+bend*u*u,vx=px+u*length*cos-cross*sin,vz=pz+u*length*sin+cross*cos
        vertices.push(vx,ground(vx,vz)+lift,vz);colours.push(c.r*brightness,c.g*brightness,c.b*brightness)
      }
      for(const i of [0,2,1,0,3,2,1,2,4,2,3,4])indices.push(first+i)
    }
  }
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new Float32BufferAttribute(colours,3))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  const material=new MeshStandardMaterial({vertexColors:true,roughness:.90,side:DoubleSide})
  const litter=new Mesh(geometry,material);litter.name='fallen_bamboo_sheaths';root.add(litter)
  return ()=>{geometry.dispose();material.dispose()}
}

function shallowGravel(root:Object3D,stream:Mesh,ground:HeightAt,random:()=>number){
  const sections=streamSections(stream).filter(s=>s.z<-.9&&s.z>-11)
  const grain=new IcosahedronGeometry(1,1),sandstone=new MeshStandardMaterial({roughness:.45,metalness:0})
  const patch=new InstancedMesh(grain,sandstone,1800),stone=new Object3D(),p=new Vector3(),colour=new Color()
  const gravelColours=[0x81623e,0x94825b,0x656150,0x82745d,0x595b4e,0xada181,0x9d7753]
  let count=0
  for(let i=0;i<patch.count&&sections.length;i++){
    const row=sections[Math.floor(random()*sections.length)],side=random()>.5
    const shoal=i%3===0
    const w=shoal?.82+.41*random():.15+.85*random()**.7,t=.5+(side?.5:-.5)*w
    p.lerpVectors(row.left,row.right,t);p.x+=(random()-.5)*.12;p.z+=(random()-.5)*.16
    const y=ground(p.x,p.z);if(y>(shoal?.11:-.122)||y<-.48)continue
    const radius=.016+.067*random()**2
    stone.position.set(p.x,y+radius*.17,p.z);stone.rotation.set(random()*.23,random()*6.28,random()*.37)
    stone.scale.set(radius*(.90+random()*.54),radius*(.31+random()*.26),radius*.81)
    stone.updateMatrix();patch.setMatrixAt(count,stone.matrix)
    colour.setHex(gravelColours[Math.floor(random()*gravelColours.length)]).multiplyScalar(.76+.38*random())
    patch.setColorAt(count++,colour)
  }
  patch.name='submerged_stream_pebbles';patch.count=count;patch.computeBoundingSphere();root.add(patch)
  return {count,dispose:()=>{patch.dispose();grain.dispose();sandstone.dispose()}}
}

export function detailForestFloor(root:Object3D,kit:Object3D,heightAt:HeightAt,id:SceneId,bankHeight:HeightAt|null=null){
  let seed=id==='creek'?14923:id==='rain'?4811:719
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const grass=grassClump(random),up=new Vector3(0,1,0),normal=new Vector3()
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),point=new Vector3(),spin=new Quaternion()
  const rocks:Mesh[]=[],stoneGeometry:BufferGeometry[]=[],stream=root.getObjectByName('creek_surface')
  const clearBamboo=id==='bamboo'?bambooFloor(root,heightAt):null
  const openPath=id==='bamboo'&&root.getObjectByName('environment_bamboo')?.userData.clearBambooPath===true
  // Width, exposed shape and ground contact use the scan bounds rather than the scan origin.
  function fieldstone(x:number,z:number,width:number,height:number,variant:number,shoulder=false,outcropFoot=false){
    const name='forest_rock_'+variant+'_surface',source=kit.getObjectByName(name)
    if(!(source instanceof Mesh))return
    const g=source.geometry.clone();stoneGeometry.push(g);g.computeBoundingBox()
    const size=g.boundingBox!.getSize(new Vector3()),center=g.boundingBox!.getCenter(new Vector3())
    const rock=new Mesh(g,source.material),angle=random()*Math.PI*2
    rock.name='mossy_bank_stone_'+variant;rock.userData.surfaceSource=name
    if(outcropFoot)rock.userData.outcropFoot=true
    const surface=id==='creek'&&outcropFoot&&bankHeight?bankHeight:heightAt
    let bed=surface(x,z)
    for(let i=0;i<8;i++)bed=Math.min(bed,surface(x+width*.35*Math.cos(i*Math.PI/4),z+width*.35*Math.sin(i*Math.PI/4)))
    if(id==='creek'&&bed<-.132){
      // Preserve a low exposed shoulder even where the stream has scoured a deeper run.
      height=Math.max(height,(-.132+width*.19-bed)/.71)
    }
    rock.scale.set(width/Math.max(size.x,size.z),height/size.y,width/Math.max(size.x,size.z))
    rock.rotation.y=angle
    if(shoulder){
      rock.scale.set(width/size.x,height/size.y,width*.71/size.z);rock.rotation.y=-.33
      rock.userData.exposedShoulder=true
    }
    const base=new Vector3(center.x,g.boundingBox!.min.y,center.z).multiply(rock.scale).applyQuaternion(rock.quaternion)
    rock.position.set(x,bed-height*.29,z).sub(base);root.add(rock);rock.updateMatrixWorld(true)
    const half=size.clone().multiplyScalar(.5),local=new Vector3(),round=new Vector3(),world=new Vector3()
    const position=g.attributes.position
    for(let i=0;i<position.count;i++){
      local.fromBufferAttribute(position,i)
      const t=(local.y-g.boundingBox!.min.y)/size.y
      round.copy(local).sub(center).divide(half).normalize().multiply(half).add(center)
      if(openPath&&shoulder){
        // Bedding slopes across the crown. A fractured shoulder interrupts the front edge.
        const u=(local.x-center.x)/half.x,v=(local.z-center.z)/half.z
        local.lerp(round,.66)
        const shoulderCut=Math.max(0,.70*u+.40*v-.19)
        local.y+=half.y*t*(.11*v-.10*u-.28*shoulderCut)
        local.x+=half.x*.075*t*(1-v*v)
        // Eroded flutes cut across the exposed downhill face. The lip of the
        // joint and its recessed wall share the same shape in the shadow pass.
        const crown=t*t*(3-2*t)
        const line=u+.30*v+.29*t+.15*Math.sin(4*v+2*t)
        const recess=Math.exp(-Math.pow((line-.17)/.15,2))+.57*Math.exp(-Math.pow((line+.54)/.11,2))
        const face=Math.min(1,Math.max(0,(v+.76)*1.26))
        local.z-=half.z*crown*face*(.19*recess+.07*Math.max(0,u))
        local.y+=half.y*crown*(.055*Math.exp(-3*(u+.34)**2)-.17*recess*(.4+.6*face))
      }else local.lerp(round,bankHeight&&outcropFoot?.09:id==='creek'?.60:.45)
      world.copy(local).applyMatrix4(rock.matrixWorld)
      const contact=Math.max(0,1-t/.46)
      local.y-=contact*Math.max(0,world.y-surface(world.x,world.z)+.016)/rock.scale.y
      position.setXYZ(i,local.x,local.y,local.z)
    }
    position.needsUpdate=true;g.computeVertexNormals()
    if(id==='creek'){
      // Keep the scanned relief, with worn shoulder normals continuing across UV seams.
      const n=g.attributes.normal,gradient=new Vector3()
      for(let i=0;i<position.count;i++){
        gradient.fromBufferAttribute(position,i).sub(center).divide(half).divide(half).normalize()
        local.fromBufferAttribute(n,i).lerp(gradient,bankHeight&&outcropFoot?.15:.53).normalize()
        n.setXYZ(i,local.x,local.y,local.z)
      }
      n.needsUpdate=true
    }
    g.computeBoundingBox();g.computeBoundingSphere()
    if(openPath&&shoulder){
      rock.geometry=weatherOutcrop(g,rock.matrixWorld,heightAt);stoneGeometry.push(rock.geometry)
    }
  }
  if(id==='bamboo'){
    fieldstone(1.77,-3.68,1.31,openPath?.93:.68,1,true);fieldstone(2.14,-3.91,.66,.41,5);fieldstone(-1.53,-5.31,.68,.44,0)
    if(openPath){
      // Weathered fragments follow the downhill side, with soil visible between pockets.
      for(const [x,z,w,h,v] of [[1.19,-3.38,.21,.10,2],[1.28,-3.31,.095,.061,4],
        [1.41,-3.21,.15,.084,0],[1.37,-3.15,.069,.037,2],[1.81,-3.16,.16,.075,5],
        [1.92,-3.20,.09,.048,3],[2.04,-3.24,.20,.112,0]])fieldstone(x,z,w,h,v)
      for(const [x,z,w,h,v] of [[1.12,-3.36,.24,.13,3],[1.31,-3.11,.13,.067,1],
        [1.51,-3.23,.085,.048,5],[1.97,-3.09,.49,.23,4],[2.20,-3.25,.17,.09,2]])
        fieldstone(x,z,w,h,v,false,true)
    }
  }else if(id==='rain'){
    if(root.getObjectByName('environment_rain')?.userData.openRainClearing){
      fieldstone(-3.15,-5.12,.75,.40,3);fieldstone(2.25,-7.42,.91,.43,1);fieldstone(-.87,-9.82,.55,.22,0)
    }else{
      fieldstone(-1.35,-3.82,.75,.40,3);fieldstone(1.73,-4.85,.91,.43,1);fieldstone(.32,-6.26,.55,.22,0)
    }
  }else if(stream instanceof Mesh){
    const sections=streamSections(stream)
    for(const [x,z,t,w,h,v] of [[.12,-4.74,.67,1.00,.54,3],[.94,-4.32,.65,.47,.32,0],[1.85,-3.70,.09,.89,.46,5],
      [-1.26,-5.56,.15,1.04,.50,1],[-2.38,-6.40,.21,.51,.33,4],[-5.04,-8.2,.13,.72,.44,2]]){
      const distance=(s:typeof sections[number])=>((s.left.x+s.right.x)*.5-x)**2+(s.z-z)**2
      const row=sections.reduce((best,s)=>distance(s)<distance(best)?s:best)
      const pos=new Vector3().lerpVectors(row.left,row.right,t);fieldstone(pos.x,pos.z,w,h,v)
    }
  }
  if(openPath){
    // Low, uneven groups sit on the slope break and behind the stone shoulder.
    // Positions follow the same heightfield as the visible soil and leaf litter.
    const pockets=[
      [-1.38,-3.20,.28,.39],[-2.10,-4.56,.46,.50],[-.98,-6.25,.27,.34],
      [1.03,-4.62,.32,.37],[2.40,-3.84,.29,.36],[1.64,-6.48,.44,.42],
      [-2.03,-8.43,.51,.45],[.83,-9.83,.37,.39],
      [-.73,-6.8,.23,.47],[.61,-7.25,.26,.49],[-.35,-8.15,.28,.43],[.56,-8.7,.27,.50],
    ]
    let plantingSeed=9215
    const sample=()=>{plantingSeed=(Math.imul(plantingSeed,1664525)+1013904223)>>>0;return plantingSeed/4294967296}
    for(const [cx,cz,radius,scale] of pockets){
      const heading=sample()*Math.PI*2
      for(let j=0;j<5;j++){
        const angle=heading+j*2.4+.46*sample(),r=radius*Math.sqrt(sample())
        const x=cx+r*Math.cos(angle),z=cz+r*Math.sin(angle)
        const plant=new Object3D(),size=scale*(.67+.65*sample())
        plant.userData.prototype=j<2?'fern':j===3?'sedge_0':'ground_herb_1'
        plant.position.set(x,heightAt(x,z)-.012,z)
        plant.rotation.y=angle;plant.scale.set(size, size*(.77+.23*sample()),size)
        root.add(plant);plant.updateMatrixWorld(true)
      }
    }
  }
  const gravel=stream instanceof Mesh?shallowGravel(root,stream,heightAt,random):null
  let grasses=0,moss=0
  root.traverse(node=>{
    if(node instanceof Mesh&&node.userData.surfaceSource)rocks.push(node)
    const kind=node.userData.prototype
    if(openPath&&kind==='grove_2'){
      node.getWorldPosition(point)
      if(Math.hypot(point.x-1.87,point.z+2.91)<.09){
        point.x+=.58;point.z-=.05;point.y=heightAt(point.x,point.z)-.035
        node.position.copy(node.parent!.worldToLocal(point));node.updateMatrixWorld(true)
      }
    }
    if(openPath&&['fern','understory','ground_herb_0','ground_herb_1','sedge_0','sedge_1'].includes(kind)){
      const p=node.getWorldPosition(point)
      // Keep the roadside vegetation below the eye line and leave breaks in
      // the near shoulders, preserving each plant's rooted placement.
      if(p.z> -5.3&&p.z< -.9){
        if(kind==='understory')node.scale.multiplyScalar(.68)
        else if(kind.startsWith('ground_herb_'))node.scale.multiplyScalar(.78)
        else if(kind==='fern')node.scale.multiplyScalar(.92)
        node.updateMatrixWorld(true)
      }
      if(p.x>1.08&&p.x<2.34&&p.z> -4.04&&p.z< -2.54){
        if(kind==='ground_herb_0'||kind==='ground_herb_1'){
          const sign=p.x<1.65?-1:1
          p.x=1.77+sign*(.75+.20*Math.abs(Math.sin(p.z*8.3+p.x*3.9)))
          p.z+=.12*Math.cos(p.x*21);p.y=heightAt(p.x,p.z)-.009
          node.position.copy(node.parent!.worldToLocal(p));node.scale.multiplyScalar(.40)
        }else node.scale.multiplyScalar(.43)
        node.updateMatrixWorld(true)
      }
    }
    if(id==='bamboo'&&node.userData.prototype==='fern'){
      point.setFromMatrixPosition(node.matrixWorld)
      const inFront=Math.hypot((point.x-1.65)/.85,(point.z+3.20)/.57)
      if(inFront<1){node.scale.y*=.55+.37*inFront;node.updateMatrixWorld(true)}
      if(openPath&&point.z> -7.2&&Math.abs(point.x)<5){
        const age=.5+.5*Math.sin(point.x*16.1+point.z*8.7)
        node.scale.multiplyScalar(.66+.46*age)
        node.rotation.z+=.22*(age-.5);node.rotation.x+=.16*Math.cos(point.z*13.4)
        node.updateMatrixWorld(true)
      }
    }
    if(id==='rain'&&String(node.userData.prototype).startsWith('sedge_')){
      point.setFromMatrixPosition(node.matrixWorld)
      if(point.z> -7.6&&point.z< -2.2&&heightAt(point.x,point.z)<.25){
        const edge=.5+.5*Math.sin(point.x*2.9+point.z*1.74)
        if(random()<.40+.39*edge){
          node.userData.prototype='ground_herb_1';node.scale.multiplyScalar(.86)
        }else node.scale.y*=.58+.37*random()
        node.updateMatrixWorld(true)
      }
    }
    if(node.userData.prototype!=='fern'||node.userData.stoneFringe)return
    point.setFromMatrixPosition(node.matrixWorld)
    const cluster=.5+.27*Math.sin(point.x*1.64+point.z*.98)+.23*Math.sin(point.z*2.37-point.x*.61)
    if(random()<.26+.56*cluster){
      node.userData.prototype='meadow_grass';grasses++
    }
  })
  const waterline=id==='creek'?-.132:id==='rain'?-.096:-Infinity
  if(root.getObjectByName('environment_rain')?.userData.openRainClearing){
    // Low, mutually overlapping plants pin down opposite ends of each wet bank;
    // separate patches leave visible clay between them and open water in the middle.
    for(const [cx,cz,radius] of [[-2.52,-3.48,.27],[-2.17,-2.62,.23],[-1.30,-2.16,.23],
      [1.56,-2.34,.29],[2.47,-3.07,.38],[-3.29,-4.45,.36],[-3.63,-6.21,.55],
      [-2.82,-7.29,.64],[-1.86,-8.05,.64],[.21,-8.70,.55],[1.52,-8.57,.48],[3.09,-7.74,.49]]){
      for(let j=0;j<4;j++){
        const angle=random()*Math.PI*2,distance=radius*Math.sqrt(random()),x=cx+distance*Math.cos(angle),z=cz+distance*Math.sin(angle)
        const y=heightAt(x,z)
        if(y<waterline+.012)continue
        const tuft=new Object3D(),size=.24+.25*random()
        tuft.userData.prototype=j===0?'fern':j===1?'sedge_0':'ground_herb_1'
        tuft.position.set(x,y-.012,z);tuft.rotation.y=random()*Math.PI*2
        tuft.scale.set(size*1.19,size*.69,size);root.add(tuft);tuft.updateMatrixWorld(true)
      }
    }
  }
  for(const rock of rocks){
    const {position}=rock.geometry.attributes,index=rock.geometry.index
    const count=index?.count??position.count
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(rock.matrixWorld)
      b.fromBufferAttribute(position,index?index.getX(i+1):i+1).applyMatrix4(rock.matrixWorld).sub(a)
      c.fromBufferAttribute(position,index?index.getX(i+2):i+2).applyMatrix4(rock.matrixWorld).sub(a)
      normal.crossVectors(b,c);const area=normal.length()*.5
      const shoulder=rock.userData.exposedShoulder===true&&openPath
      if(!area||random()>area*(shoulder?130:29))continue
      normal.normalize();if(normal.y<(shoulder?-.04:.40))continue
      const u=Math.sqrt(random()),v=random()
      point.copy(a).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v)
      if(point.y<Math.max(waterline+.038,heightAt(point.x,point.z)+.018))continue
      if(shoulder){
        const layer=rock.geometry.attributes._mossMantle
        const at=(j:number)=>layer.getX(index?index.getX(i+j):i+j)
        if((1-u)*at(0)+u*(1-v)*at(1)+u*v*at(2)<.72)continue
      }else if(Math.sin(point.x*7+point.z*3.6)+Math.cos(point.z*5.3-point.x*2.2)<-.52)continue
      const sprig=new Object3D(),size=shoulder?.33+random()*.40:.24+random()*.37
      sprig.userData.prototype='bryophyte_'+(moss%2);sprig.position.copy(point).addScaledVector(normal,-.004)
      sprig.quaternion.setFromUnitVectors(up,normal).multiply(spin.setFromAxisAngle(up,random()*Math.PI*2))
      sprig.scale.set(size,size*(.75+random()*.42)*(shoulder?.54:1),size*(.74+random()*.31))
      root.add(sprig);sprig.updateMatrixWorld(true);moss++
    }
  }
  if(bankHeight){
    // Low shelves interrupt the gravel. Plant only on the sheltered upper rim.
    for(const [x,z,width,rise,variant] of [[-1.47,-.92,.35,.102,3],
      [-2.29,-2.38,.43,.14,1],[1.46,-1.44,.26,.082,2],[-2.72,-3.31,.37,.13,4]]){
      if(bankHeight(x,z)<-.093)continue
      fieldstone(x,z,width,rise,variant,false,true)
      for(let i=0;i<5;i++){
        const angle=1.8+random()*3.6,dist=width*(.42+.36*random())
        const px=x+Math.cos(angle)*dist,pz=z+Math.sin(angle)*dist,py=bankHeight(px,pz)
        if(py<-.11)continue
        const herb=new Object3D()
        herb.userData.prototype=i%4===0?'fern':'ground_herb_'+(i%2)
        herb.position.set(px,py-.006,pz);herb.rotation.y=random()*Math.PI*2
        const s=.19+random()*.24
        herb.scale.set(s*1.26,s*.79,s*1.26);root.add(herb);herb.updateMatrixWorld(true)
      }
    }
  }
  const pressed=openPath?stoneFootLitter(rocks,heightAt):null
  if(pressed)root.add(pressed.mesh)
  const releaseVerge=openPath?bambooVerge(root,heightAt,pressed!.gaps):null
  const ferns=openPath?stoneFootFerns(heightAt):null
  if(ferns)root.add(ferns.mesh)
  root.userData.forestFloor={grasses,rockMoss:moss,gravel:gravel?.count??0}
  return {template:grass.template,dispose:()=>{clearBamboo?.();releaseVerge?.();pressed?.dispose();ferns?.dispose();grass.dispose();gravel?.dispose();stoneGeometry.forEach(g=>g.dispose())}}
}
