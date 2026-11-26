import {Box3,BufferGeometry,Color,Float32BufferAttribute,IcosahedronGeometry,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Object3D,Vector3,type Texture} from 'three'
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {filterWoodlandSun} from './CanopyLight.ts'
import type {HeightAt} from './terrain-height'

// Find the actual wet/dry crossing, not the outer edge of the submerged ribbon.
// The same whole fern and scanned rootwood assets remain three-dimensional from
// other eye positions. This belt stays live in the default distance partition.
export function creekContactBand(root:Object3D,kit:Object3D,ground:HeightAt,
  rows:{left:Vector3;right:Vector3}[],level:number,openings:Texture,time:{value:number}){
  kit.updateWorldMatrix(true,true)
  let seed=736281
  const pick=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const meshes:InstancedMesh[]=[],materials:MeshStandardMaterial[]=[],owned:BufferGeometry[]=[]
  const pivot=new Object3D(),up=new Vector3(0,1,0),normal=new Vector3(),last=new Vector3(Infinity,0,0)
  const anchors:{x:number;z:number;nx:number;nz:number;width:number}[]=[]
  let spacing=.31
  for(const row of rows){
    if(row.left.x< -4.8||row.left.x>4.2||row.left.z> -3.8)continue
    const inward=row.right.clone().sub(row.left).setY(0).normalize()
    let dry=-.7,wet=1.3
    if(ground(row.left.x+inward.x*dry,row.left.z+inward.z*dry)<=level||
      ground(row.left.x+inward.x*wet,row.left.z+inward.z*wet)>=level)continue
    for(let i=0;i<19;i++){
      const mid=(dry+wet)*.5
      if(ground(row.left.x+inward.x*mid,row.left.z+inward.z*mid)>level)dry=mid;else wet=mid
    }
    const point=row.left.clone().addScaledVector(inward,(dry+wet)*.5).setY(level)
    if(point.z> -4.15||point.x>4.2)continue
    if(point.distanceTo(last)<spacing)continue
    last.copy(point);spacing=.27+.24*pick()
    anchors.push({x:point.x,z:point.z,nx:inward.x,nz:inward.z,width:.27+.39*pick()})
  }
  function mount(name:string,geometry:BufferGeometry,material:MeshStandardMaterial,placements:Matrix4[],tints:Color[],shadow=true){
    if(!placements.length)return
    filterWoodlandSun(material,openings,'creek',name.includes('fern'),false,null,false,time);materials.push(material)
    const mesh=new InstancedMesh(geometry,material,placements.length)
    placements.forEach((m,i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,tints[i])})
    mesh.name=name;mesh.userData.liveCreekBank=true;mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.raycast=()=>{}
    mesh.computeBoundingSphere();root.add(mesh);meshes.push(mesh)
  }
  const fernCounts:number[]=[],bases:number[][]=[]
  for(const [group,variant] of [0,3].entries()){
    const prototype=kit.getObjectByName('forest_fern_'+variant)
    if(!prototype)continue
    const inverse=prototype.matrixWorld.clone().invert(),parts:{mesh:Mesh;matrix:Matrix4}[]=[],bounds=new Box3()
    prototype.traverse(o=>{if(o instanceof Mesh){const matrix=inverse.clone().multiply(o.matrixWorld);o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox!.clone().applyMatrix4(matrix));parts.push({mesh:o,matrix})}})
    const span=Math.max(bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z),placements:Matrix4[]=[],tints:Color[]=[]
    anchors.forEach((shore,i)=>{
      if(i%2!==group)return
      for(let layer=0;layer<3;layer++){
        const paleSlope=shore.x> -1.6&&shore.x<.4
        const retreat=layer===0?.025+.09*pick():layer===1?.16+.18*pick():paleSlope?.14:shore.width+.14
        const along=(pick()-.5)*.36,x=shore.x-shore.nx*retreat-shore.nz*along,z=shore.z-shore.nz*retreat+shore.nx*along
        const y=ground(x,z),width=layer===0?.71+.24*pick():.67+.28*pick(),scale=width/span
        if(y<level+.008)continue
        // Slope-following whole rosettes put their outer fronds down the bank.
        normal.set((ground(x-.06,z)-ground(x+.06,z))/.12,1,(ground(x,z-.06)-ground(x,z+.06))/.12).normalize()
        normal.lerp(up,.48).normalize()
        pivot.quaternion.setFromUnitVectors(up,normal);pivot.rotateY(pick()*Math.PI*2)
        pivot.position.set(x,y-.017-bounds.min.y*scale,z);pivot.scale.set(scale,scale*.72,scale);pivot.updateMatrix()
        placements.push(pivot.matrix.clone());tints.push(new Color().setRGB(.53+.15*pick(),.65+.15*pick(),.44+.12*pick()))
        bases.push([x,y-.017,z,width])
      }
    })
    fernCounts.push(placements.length)
    for(const part of parts){
      if(!(part.mesh.material instanceof MeshStandardMaterial))continue
      const material=part.mesh.material.clone();material.roughness=.94;material.envMapIntensity=.34;material.alphaTest=Math.max(.35,material.alphaTest)
      mount('creek_contact_fern_'+variant,part.mesh.geometry,material,placements.map(m=>m.clone().multiply(part.matrix)),tints)
    }
  }
  // Lay the existing root fans along the bank and bury their uphill ends. The
  // low retained bark relief joins a few tapered, soil-following attached roots.
  const rootwood=kit.getObjectByName('forest_rootwood_0'),rootSites:number[][]=[],rootJunctions:number[][]=[]
  const rootletPositions:number[]=[],rootletUvs:number[]=[],rootletIndices:number[]=[],rootProfiles:{maxHeight:number;length:number}[]=[]
  const rootPaths:{root:number;start:Vector3;end:Vector3}[]=[]
  if(rootwood){
    const inverse=rootwood.matrixWorld.clone().invert()
    rootwood.traverse(part=>{
      if(!(part instanceof Mesh)||!(part.material instanceof MeshStandardMaterial))return
      const pieces:BufferGeometry[]=[],local=inverse.clone().multiply(part.matrixWorld)
      for(const [rootIndex,target] of [-3.25,-1.22,.82,3.25].entries()){
        const shore=anchors.reduce<typeof anchors[number]|null>((best,a)=>!best||Math.abs(a.x-target)<Math.abs(best.x-target)?a:best,null)
        if(!shore)continue
        const retreat=.065+.075*pick(),x=shore.x-shore.nx*retreat,z=shore.z-shore.nz*retreat,scale=.48+.16*pick(),lean=(pick()-.5)*.24
        const tx=-shore.nz,tz=shore.nx,geometry=part.geometry.clone().applyMatrix4(local),points=geometry.attributes.position
        const clearance=new Float32Array(points.count),exposed:Vector3[]=[]
        let maxHeight=0
        for(let i=0;i<points.count;i++){
          const px=points.getX(i),py=points.getY(i),pz=points.getZ(i)
          const along=(px+py*.62)*scale*1.12,cross=(pz*.46+lean*px)*scale
          const wx=x+tx*along+shore.nx*cross,wz=z+tz*along+shore.nz*cross
          // Rear end disappears into the upslope soil rather than ending in a
          // separate cut face. Only a low 2–9 cm bark ridge remains proud.
          const rear=Math.max(0,Math.min(1,(-cross+.035)/.24)),burial=.059+.038*rear*rear
          const h=py*scale*.62-burial,y=ground(wx,wz)+h
          clearance[i]=h;maxHeight=Math.max(maxHeight,h);points.setXYZ(i,wx,y,wz)
          if(h>.009)exposed.push(new Vector3(wx,y,wz))
        }
        // Buried scan faces have no visible contribution. Keep every triangle
        // crossing the soil, while removing the entirely subterranean underside.
        const index=geometry.index,visible:number[]=[]
        for(let i=0;i<(index?.count??points.count);i+=3){
          const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j)
          if(ids.some(j=>clearance[j]>-.005))visible.push(...ids)
        }
        geometry.setIndex(visible)
        geometry.computeVertexNormals();pieces.push(geometry);rootSites.push([x,ground(x,z),z,scale])
        rootProfiles.push({maxHeight,length:scale*1.60})
        for(let branch=0;branch<(rootIndex===0?2:3);branch++){
          if(!exposed.length)continue
          const side=(branch-1)*.17,wanted=new Vector3(x+tx*side,0,z+tz*side)
          const start=exposed.reduce((best,p)=>Math.hypot(p.x-wanted.x,p.z-wanted.z)<Math.hypot(best.x-wanted.x,best.z-wanted.z)?p:best)
          const length=.30+.085*((rootIndex+branch)%3),spread=(branch-1)*.24+.06*Math.sin(rootIndex*2+branch)
          const segments=12,radial=6,offset=rootletPositions.length/3
          const centre=(t:number)=>{
            const sway=Math.sin(t*Math.PI)*(.035+.012*branch)*Math.sin(rootIndex*1.8+branch+.7)
            const px=start.x+shore.nx*length*t+tx*(spread*t+sway),pz=start.z+shore.nz*length*t+tz*(spread*t+sway)
            const join=(start.y-ground(start.x,start.z))*(1-t)**3
            return new Vector3(px,ground(px,pz)+join+.001,pz)
          }
          rootJunctions.push([start.x,start.y,start.z,centre(1).x,centre(1).z])
          rootPaths.push({root:rootIndex,start:start.clone(),end:centre(1)})
          for(let segment=0;segment<=segments;segment++){
            const t=segment/segments,c=centre(t),radius=(.018+.002*((branch+rootIndex)%3))*(1-t)**1.15+.0025
            const tangent=centre(Math.min(1,t+.02)).sub(centre(Math.max(0,t-.02))).normalize()
            const surface=new Vector3((ground(c.x-.025,c.z)-ground(c.x+.025,c.z))/.05,1,(ground(c.x,c.z-.025)-ground(c.x,c.z+.025))/.05).normalize()
            const lateral=new Vector3().crossVectors(tangent,surface).normalize(),top=new Vector3().crossVectors(lateral,tangent).normalize()
            for(let ring=0;ring<radial;ring++){
              const angle=ring/radial*Math.PI*2,r=radius*(1+.085*Math.sin(segment*1.9+ring*2.3))
              const vertex=c.clone().addScaledVector(lateral,Math.cos(angle)*r).addScaledVector(top,Math.sin(angle)*r)
              rootletPositions.push(vertex.x,vertex.y,vertex.z);rootletUvs.push(.18+ring/radial*.16,.21+t*.44)
              if(segment){const a=offset+(segment-1)*radial+ring,b=offset+(segment-1)*radial+(ring+1)%radial,d=offset+segment*radial+ring,e=offset+segment*radial+(ring+1)%radial;rootletIndices.push(a,d,e,a,e,b)}
            }
          }
        }
      }
      if(!pieces.length)return
      const geometry=mergeGeometries(pieces)!;pieces.forEach(g=>g.dispose());owned.push(geometry)
      const material=part.material.clone();material.roughness=.84;material.envMapIntensity=.24
      mount('creek_contact_rootwood',geometry,material,[new Matrix4()],[new Color().setRGB(.34,.35,.24)])
      if(rootletPositions.length){
        const roots=new BufferGeometry();roots.setAttribute('position',new Float32BufferAttribute(rootletPositions,3));roots.setAttribute('uv',new Float32BufferAttribute(rootletUvs,2));roots.setIndex(rootletIndices);roots.computeVertexNormals();owned.push(roots)
        const bark=part.material.clone();bark.roughness=.87;bark.envMapIntensity=.24
        mount('creek_contact_rootlets',roots,bark,[new Matrix4()],[new Color().setRGB(.32,.33,.23)])
      }
    })
  }
  const stones:Matrix4[]=[],colours:Color[]=[],stoneBases:number[][]=[]
  for(const shore of anchors){
    const count=1+Math.floor(pick()*4)
    for(let i=0;i<count;i++){
      const along=(pick()-.5)*.40,retreat=-.13+.28*pick(),x=shore.x-shore.nx*retreat-shore.nz*along,z=shore.z-shore.nz*retreat+shore.nx*along,y=ground(x,z)
      const radius=.033+.085*pick()**1.4,height=radius*(.31+.21*pick())
      normal.set((ground(x-.03,z)-ground(x+.03,z))/.06,1,(ground(x,z-.03)-ground(x,z+.03))/.06).normalize()
      pivot.position.set(x,y-height*.40,z);pivot.quaternion.setFromUnitVectors(up,normal);pivot.rotateY(pick()*6.28);pivot.scale.set(radius,height,radius*(.64+.29*pick()));pivot.updateMatrix()
      stones.push(pivot.matrix.clone());colours.push(new Color([0x4a4937,0x55513f,0x67553b,0x424638][Math.floor(pick()*4)]).multiplyScalar(.69+.19*pick()));stoneBases.push([x,y-height*.40,z])
    }
  }
  // Reuse the nearby small stones, placing a few to either side of attached
  // roots. Roots cross the damp gaps; no extra row of regularly spaced rocks.
  const movedStones=new Set<number>(),stoneScale=new Vector3(),stonePosition=new Vector3()
  for(let rootIndex=0;rootIndex<rootSites.length;rootIndex++){
    const paths=rootPaths.filter(p=>p.root===rootIndex),path=paths[Math.min(1,paths.length-1)]
    if(!path)continue
    const direction=path.end.clone().sub(path.start).setY(0).normalize(),side=new Vector3(-direction.z,0,direction.x)
    for(let flank=0;flank<2;flank++){
      const point=path.start.clone().lerp(path.end,flank===0?.22:.61)
      let nearest=-1,best=Infinity
      stones.forEach((matrix,i)=>{if(movedStones.has(i))return;stonePosition.setFromMatrixPosition(matrix);const distance=Math.hypot(stonePosition.x-point.x,stonePosition.z-point.z);if(distance<best){nearest=i;best=distance}})
      if(nearest<0||best>.9)continue
      movedStones.add(nearest);stoneScale.setFromMatrixScale(stones[nearest])
      point.addScaledVector(side,(flank===0?-1:1)*(Math.max(stoneScale.x,stoneScale.z)+.018))
      const y=ground(point.x,point.z)
      normal.set((ground(point.x-.03,point.z)-ground(point.x+.03,point.z))/.06,1,(ground(point.x,point.z-.03)-ground(point.x,point.z+.03))/.06).normalize()
      pivot.position.set(point.x,y-stoneScale.y*.40,point.z);pivot.quaternion.setFromUnitVectors(up,normal);pivot.rotateY(.6*rootIndex+.7*flank);pivot.scale.copy(stoneScale);pivot.updateMatrix()
      stones[nearest]=pivot.matrix.clone();stoneBases[nearest]=pivot.position.toArray()
    }
  }
  const stone=new IcosahedronGeometry(1,1);owned.push(stone)
  mount('creek_contact_wet_stones',stone,new MeshStandardMaterial({roughness:.57,envMapIntensity:.31}),stones,colours)
  root.userData.creekContactBand={anchors:anchors.length,ferns:fernCounts.reduce((a,b)=>a+b,0),rootSites,rootProfiles,rootJunctions,rootlets:rootJunctions.length,rootFlankStones:movedStones.size,stones:stones.length,bases,stoneBases,
    triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3*m.count,0)}
  return ()=>{meshes.forEach(m=>{m.removeFromParent();m.dispose()});materials.forEach(m=>m.dispose());owned.forEach(g=>g.dispose());delete root.userData.creekContactBand}
}
