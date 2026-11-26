import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Matrix4,Mesh,MeshStandardMaterial,Object3D,PerspectiveCamera,Vector3} from 'three'
import type {HeightAt} from './terrain-height'

type Batch={p:number[];c:number[];ix:number[];bend:number[];phase:number[]}
type GroundPoint=(x:number,y:number)=>Vector3|undefined

// The frozen desk view is an authoring ruler only. These rooted crowns have real
// depth, branching stems and individual leaves; no camera update or image plane.
export function bambooTurn(root:Object3D,ground:HeightAt,camera:PerspectiveCamera,groundPoint:GroundPoint){
  const leaves:Batch={p:[],c:[],ix:[],bend:[],phase:[]},stems:Batch={p:[],c:[],ix:[],bend:[],phase:[]}
  const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  const point=new Vector3(),up=new Vector3(0,1,0)
  let seed=834923,leafCount=0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const roots:number[][]=[],sites:{screen:number[];world:number[];height:number;radius:number}[]=[]
  const foliage=[0x4c6135,0x5b6b39,0x657342,0x455b32,0x727844].map(v=>new Color(v))
  const litter=[0x786144,0x615334,0x8a724d].map(v=>new Color(v)),bark=new Color(0x514e34)
  const inPath=(v:Vector3)=>{
    point.copy(v).applyMatrix4(projection)
    const x=(point.x+1)*.5,y=(1-point.y)*.5,t=Math.max(0,Math.min(1,(y-.22)/.08))
    return y>.214&&y<.302&&Math.abs(x-(.430+.050*t))<.012+.009*t
  }
  function vertex(data:Batch,v:Vector3,color:Color,shade:number,bend:number,phase:number){
    data.p.push(v.x,v.y,v.z);data.c.push(color.r*shade,color.g*shade,color.b*shade)
    data.bend.push(bend);data.phase.push(phase);return data.p.length/3-1
  }
  function stem(a:Vector3,b:Vector3,width:number,phase:number){
    if(inPath(a)||inPath(b)||inPath(a.clone().lerp(b,.5)))return
    const axis=b.clone().sub(a).normalize(),side=axis.clone().cross(up).normalize(),other=axis.clone().cross(side).normalize()
    if(side.lengthSq()<.01){side.set(1,0,0);other.set(0,0,1)}
    const start=stems.p.length/3
    for(const [v,r] of [[a,width],[b,width*.56]] as const)for(let k=0;k<3;k++)
      vertex(stems,point.copy(v).addScaledVector(side,Math.cos(k*2.094)*r).addScaledVector(other,Math.sin(k*2.094)*r),bark,.71+k*.09,0,phase)
    for(let k=0;k<3;k++){const next=(k+1)%3;stems.ix.push(start+k,start+next,start+3+k,start+next,start+3+next,start+3+k)}
  }
  function leaf(base:Vector3,direction:Vector3,length:number,width:number,phase:number,fallen=false){
    const axis=direction.clone().normalize(),side=axis.clone().cross(up).normalize()
    if(side.lengthSq()<.01)side.set(1,0,0)
    side.applyAxisAngle(axis,(random()-.5)*1.65)
    const middle=base.clone().addScaledVector(axis,length*.46).addScaledVector(up,length*.09)
    const tip=base.clone().addScaledVector(axis,length).addScaledVector(up,-length*(.03+.14*random()))
    const left=middle.clone().addScaledVector(side,-width),right=middle.clone().addScaledVector(side,width)
    for(const v of [base,left,right,tip])v.y=fallen?ground(v.x,v.z)+.004:Math.max(v.y,ground(v.x,v.z)+.004)
    // Whole leaves avoid the left-turning opening; gaps remain between plants.
    if([base,left,right,tip,middle].some(inPath))return
    if([base,left,right,tip].some(v=>{point.copy(v).applyMatrix4(projection);return (1-point.y)*.5>.294}))return
    const tint=fallen?litter[leafCount%litter.length]:foliage[leafCount%foliage.length],wind=fallen?0:Math.min(.008,(base.y-ground(base.x,base.z))*.08)
    const i=vertex(leaves,base,tint,.76,0,phase)
    vertex(leaves,left,tint,.87,wind*.6,phase);vertex(leaves,right,tint,.96,wind*.6,phase)
    vertex(leaves,tip,tint,.86,wind,phase);leaves.ix.push(i,i+2,i+1,i+1,i+2,i+3);leafCount++
  }
  // Unequal side pockets replace the cross-path rows. Height/radius are metres,
  // not a requested screen coverage. The tallest plants sit back at bamboo feet.
  const planting=[
    [.393,.232,.43,.47],[.401,.255,.22,.35],[.391,.277,.13,.38],
    [.530,.222,.48,.54],[.579,.238,.34,.48],[.530,.255,.21,.38],
    [.555,.278,.14,.41],[.614,.257,.27,.47],[.640,.230,.40,.50],
  ] as const
  for(const [sx,sy,height,radius] of planting){
    const origin=groundPoint(sx,sy)
    if(!origin)continue
    origin.y=ground(origin.x,origin.z)-.007
    roots.push(origin.toArray());sites.push({screen:[sx,sy],world:origin.toArray(),height,radius})
    const phase=random()*6.28,trunk=origin.clone().addScaledVector(up,.020)
    stem(origin,trunk,.011,phase)
    for(let branch=0;branch<10;branch++){
      const a=phase+branch*2.399,spread=radius*(.55+.45*random()),rise=height*(.65+.35*random())
      const segments=[trunk]
      for(let k=1;k<=3;k++){
        const t=k/3,v=origin.clone().add(new Vector3(Math.cos(a)*spread*t,0,Math.sin(a)*spread*t*.65))
        v.y=ground(v.x,v.z)+.014+rise*(.72*Math.sin(Math.PI*t)+.26*t)
        for(let inset=0;inset<5;inset++){
          point.copy(v).applyMatrix4(projection)
          if((1-point.y)*.5<.291)break
          v.lerp(trunk,.36);v.y=Math.max(v.y,ground(v.x,v.z)+.014)
        }
        segments.push(v)
        stem(segments[k-1],v,.0065*(1-.19*k),phase)
      }
      const side=new Vector3(-Math.sin(a),0,Math.cos(a))
      for(let node=0;node<7;node++){
        const t=node/6,section=Math.min(2,Math.floor(t*3)),local=t*3-section
        const base=segments[section].clone().lerp(segments[section+1],local),forward=segments[section+1].clone().sub(segments[section]).normalize()
        for(const sign of [-1,1]){
          const direction=forward.clone().multiplyScalar(.35+.35*random()).addScaledVector(side,sign).addScaledVector(up,(random()-.5)*.55)
          const length=(.085+.075*random())*(.85+.30*Math.sin(t*Math.PI)),width=length*(.17+.07*random())
          leaf(base.clone(),direction,length,width,a)
        }
      }
    }
    for(let i=0;i<8;i++){
      const a=random()*6.28,r=radius*(.16+.75*random()),base=origin.clone().add(new Vector3(Math.cos(a)*r,0,Math.sin(a)*r))
      leaf(base,new Vector3(Math.cos(a+.6),0,Math.sin(a+.6)),.10+.06*random(),.011+.006*random(),a,true)
    }
  }
  const resources:{geometry:BufferGeometry;material:MeshStandardMaterial}[]=[]
  const meshes:Mesh[]=[]
  for(const [name,data] of [['bamboo_turn_shrub_leaves',leaves],['bamboo_turn_shrub_stems',stems]] as const){
    const geometry=new BufferGeometry()
    for(const [key,values,size] of [['position',data.p,3],['color',data.c,3],['_bend',data.bend,1],['_phase',data.phase,1]] as const)
      geometry.setAttribute(key,new Float32BufferAttribute(values,size))
    geometry.setIndex(data.ix);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:1,metalness:0,envMapIntensity:.25})
    const mesh=new Mesh(geometry,material);mesh.name=name;mesh.userData.wind=name.endsWith('leaves');mesh.userData.bambooTurn=true
    root.add(mesh);meshes.push(mesh);resources.push({geometry,material})
  }
  const report={plants:sites.length,leaves:leafCount,triangles:(leaves.ix.length+stems.ix.length)/3,roots,sites,
    meshes:meshes.map(m=>({name:m.name,triangles:m.geometry.index!.count/3}))}
  root.userData.bambooTurn=report
  return {report,meshes,dispose:()=>resources.forEach(r=>{r.geometry.dispose();r.material.dispose()})}
}
