import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Mesh,MeshStandardMaterial,Object3D,Vector3} from 'three'
import type {HeightAt} from './terrain-height'
import {bambooPathCenter} from './BambooDepth'
import {bambooBacklitLeaves} from './BambooBacklitLeaves'

type Batch={p:number[];c:number[];uv:number[];bend:number[];phase:number[];ix:number[]}
const batch=():Batch=>({p:[],c:[],uv:[],bend:[],phase:[],ix:[]})

// Culms are tall, but their side sprays hang into the eye-height woodland layer.
// Each branch attaches to an authored culm, and every leaf is a folded mesh.
export function bambooCanopy(root:Object3D,ground:HeightAt){
  let seed=3919027
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const foliage=[batch(),batch(),batch()],twigs=batch(),up=new Vector3(0,1,0),tone=new Color()
  const palette=[0x506626,0x657c33,0x7d873a,0x3d5925,0x607132,0x7e8945]
  const mature:Object3D[]=[]
  root.traverse(o=>{if(String(o.userData.prototype).startsWith('grove_')&&o.scale.y>.48&&o.position.y<20)mature.push(o)})
  const owned:BufferGeometry[]=[],materials:MeshStandardMaterial[]=[],meshes:Mesh[]=[]
  let leafCount=0,branches=0
  function vertex(out:Batch,p:Vector3,c:Color,u:number,v:number,bend:number,phase:number){
    out.p.push(p.x,p.y,p.z);out.c.push(c.r,c.g,c.b);out.uv.push(u,v);out.bend.push(bend);out.phase.push(phase)
  }
  function tube(a:Vector3,b:Vector3,c:Vector3,width:number,flex:number,phase:number){
    const direction=new Vector3().subVectors(c,a).normalize(),side=new Vector3().crossVectors(direction,up).normalize()
    const normal=new Vector3().crossVectors(side,direction).normalize(),p=new Vector3(),start=twigs.p.length/3
    for(let row=0;row<=4;row++){
      const t=row/4,r=width*(1-.89*t)
      for(let col=0;col<5;col++){
        const angle=col/5*Math.PI*2
        p.copy(a).multiplyScalar((1-t)**2).addScaledVector(b,2*t*(1-t)).addScaledVector(c,t*t)
          .addScaledVector(side,r*Math.cos(angle)).addScaledVector(normal,r*Math.sin(angle))
        tone.setRGB(.066,.092,.027).multiplyScalar(.71+.20*Math.cos(angle)+.19*t)
        vertex(twigs,p,tone,col/5,t,flex*t*t,phase)
        if(row){const k=start+row*5+col,next=start+row*5+(col+1)%5;twigs.ix.push(k-5,next-5,next,k-5,next,k)}
      }
    }
  }
  function leaf(base:Vector3,heading:number,length:number,phase:number,flex:number,level:number){
    const out=foliage[level],first=out.p.length/3,dir=new Vector3(Math.cos(heading),-.18-random()*.35,Math.sin(heading)).normalize()
    const side=new Vector3(-dir.z,0,dir.x).normalize().applyAxisAngle(dir,(random()-.5)*2.2)
    const crease=new Vector3().crossVectors(dir,side).normalize(),tint=new Color(palette[Math.floor(random()*palette.length)])
    const width=length*(.043+random()*.025),curl=(random()-.35)*.15,turn=(random()-.5)*.16,p=new Vector3()
    const rows=level===0?[0,.30,.64,1]:[0,.46,1]
    for(let row=0;row<rows.length;row++){
      const t=rows[row],w=Math.sin(Math.PI*t)**.8*width
      for(let col=0;col<3;col++){
        const cross=(col-1)*w
        p.copy(base).addScaledVector(dir,length*t).addScaledVector(side,cross+length*turn*t*t)
          .addScaledVector(crease,length*curl*Math.sin(Math.PI*t)+(col===1?w*.29:0))
        p.y-=length*.21*t*t
        tone.copy(tint).multiplyScalar((col===1?1.13:col===0?.81:.96)*(.78+.24*t))
        vertex(out,p,tone,col*.5,t,flex+.035*t*t,phase)
      }
      if(row){const a=first+(row-1)*3;out.ix.push(a,a+3,a+1,a+1,a+3,a+4,a+1,a+4,a+2,a+2,a+4,a+5)}
    }
    leafCount++
  }
  function fan(anchor:Vector3,heading:number,reach:number,level:number,phase:number,low=false){
    const axis=new Vector3(Math.cos(heading),0,Math.sin(heading)),cross=new Vector3(-axis.z,0,axis.x)
    const tip=anchor.clone().addScaledVector(axis,reach);tip.y-=low?.10:.37+.18*random()
    const control=anchor.clone().lerp(tip,.49);control.y+=low?.13:.24
    const at=(t:number)=>anchor.clone().multiplyScalar((1-t)**2).addScaledVector(control,2*t*(1-t)).addScaledVector(tip,t*t)
    tube(anchor,control,tip,low?.004:.009,.075,phase)
    const count=level===0?9:level===1?15:12
    for(let i=0;i<count;i++){
      const t=.13+.83*(i+.32*random())/count,base=at(t),sign=i%2?-1:1
      const spread=(.24+.44*Math.sin(t*Math.PI))*(.72+.5*random())*reach
      const end=base.clone().addScaledVector(cross,sign*spread).addScaledVector(axis,.16+.28*t)
      end.y-=.06+.18*random()
      const elbow=base.clone().lerp(end,.43);elbow.y+=.06
      tube(base,elbow,end,.0026,.08*t,phase+i*.19)
      const sprayHeading=Math.atan2(end.z-base.z,end.x-base.x),leaves=level===0?8:level===2?9:11
      for(let j=0;j<leaves;j++){
        if(level===0&&random()<.17)continue
        const s=.12+.85*(j+.45*random())/leaves
        const p=base.clone().multiplyScalar((1-s)**2).addScaledVector(elbow,2*s*(1-s)).addScaledVector(end,s*s)
        const length=(level===0?.12:level===1?.14:.12)+(level===0?.10:.12)*random()
        const angle=sprayHeading+(j%2?-1:1)*(.48+.77*random())
        leaf(p,angle,length*(.78+.24*Math.sin(s*Math.PI)),phase+i*.31,.065*t,level)
      }
    }
    branches++
  }
  function attached(x:number,z:number,height:number){
    const stem=mature.reduce((best,node)=>
      (node.position.x-x)**2+(node.position.z-z)**2<(best.position.x-x)**2+(best.position.z-z)**2?node:best)
    const variant=String(stem.userData.prototype),source=root.getObjectByName(variant+'_culm') as Mesh
    const localHeight=height/stem.scale.y,position=source.geometry.attributes.position
    let closest=Infinity
    for(let i=0;i<position.count;i++)closest=Math.min(closest,Math.abs(position.getY(i)-localHeight))
    const p=new Vector3();let count=0
    for(let i=0;i<position.count;i++)if(Math.abs(position.getY(i)-localHeight)<closest+.022){p.x+=position.getX(i);p.z+=position.getZ(i);count++}
    p.set(p.x/count,localHeight,p.z/count).applyMatrix4(stem.matrixWorld)
    return p
  }
  // Close sprays are large enough to resolve individual blades at the upper rim.
  for(const [x,z] of [[-3,-3.9],[3.3,-4.5],[-3.2,-6.1],[3.8,-6.6],[-4.8,-5.4],[4.9,-5.8]]){
    for(let i=0;i<2;i++){
      const a=attached(x,z,1.42+i*.36+random()*.19)
      const angle=Math.atan2(-.30+.55*random(),-Math.sign(x))+(random()-.5)*.48
      fan(a,angle,.92+.38*random(),0,random()*6.28)
    }
  }
  // Overlapping middle boughs, rooted on both sides, leave the worn central track.
  for(let i=0;i<38;i++){
    const z=-7.4-random()*17,sign=i%2?-1:1,x=sign*(1.65+random()*6)
    const a=attached(x,z,1.1+random()*2.5),angle=Math.atan2((random()-.5)*1.3,-sign)
    fan(a,angle,1.4+random()*1.3,1,random()*6.28)
  }
  // Low coppice closes the bright feet of distant trunks, with different ridge heights.
  for(let i=0;i<52;i++){
    const z=-7.8-random()*24,sign=i%2?-1:1,center=bambooPathCenter(z)
    const x=center+sign*(.95+random()*5.8),a=new Vector3(x,ground(x,z)+.32+random()*.32,z)
    const base=new Vector3(x,ground(x,z)-.025,z),middle=base.clone().lerp(a,.5).add(new Vector3(.06,0,-.03))
    tube(base,middle,a,.007,.025,i*.31)
    fan(a,random()*Math.PI*2,.72+random()*.83,2,random()*6.28,true)
  }
  // The track turns behind distinct rooted clumps at 7–10 m. Their lower sprays
  // overlap the far soil; there is no upright embankment or planar green screen.
  for(const [x,z,height,reach] of [[-.75,-6.8,.33,.65],[.65,-7.3,.42,.73],[-.35,-8.1,.58,.78],
    [.42,-10.35,.57,.91],[-1.18,-11.6,.76,1.02],[1.24,-12.1,.73,1.05],[-.26,-13.7,.88,.99]]){
    const base=new Vector3(x,ground(x,z)-.028,z)
    for(let j=0;j<4;j++){
      const phase=random()*6.28,a=base.clone().add(new Vector3((random()-.5)*.18,height*(.82+.35*random()),(random()-.5)*.18))
      tube(base,base.clone().lerp(a,.45),a,.0056,.025,phase)
      fan(a,phase,reach*(.76+.30*random()),2,phase,true)
    }
  }
  for(const [i,data] of [...foliage,twigs].entries()){
    const geometry=new BufferGeometry()
    for(const [name,values,size] of [['position',data.p,3],['color',data.c,3],['uv',data.uv,2],['_bend',data.bend,1],['_phase',data.phase,1]] as const)
      geometry.setAttribute(name,new Float32BufferAttribute(values,size))
    geometry.setIndex(data.ix);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:i===3?.94:.84})
    const mesh=new Mesh(geometry,material);mesh.name='bamboo_side_crown_'+i+(i===3?'_twigs':'_leaves')
    mesh.userData.wind=true;root.add(mesh);owned.push(geometry);materials.push(material);meshes.push(mesh)
  }
  root.userData.bambooCanopy={leafCount,branches,triangles:[...foliage,twigs].reduce((n,b)=>n+b.ix.length/3,0),batches:meshes.length}
  const sunlightLeaves=bambooBacklitLeaves(root)
  return ()=>{sunlightLeaves.dispose();owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())}
}
