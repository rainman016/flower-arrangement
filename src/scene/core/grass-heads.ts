import { BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.82})
const seed=new Color('#90a046'),green=new Color('#658335'),silk=new Color('#b6bf79')
const rachis=new Color('#817043'),husk=new Color('#ad935d')

// Indexed tapered filaments keep the rachis, spikelets and awns in one pickable mesh.
function strands(){
  const vertices:number[]=[],colors:number[]=[],indices:number[]=[]
  function rod(a:Vector3,b:Vector3,r0:number,r1:number,color:Color,endColor=color,sides=4){
    const t=b.clone().sub(a).normalize(),u=new Vector3(0,0,1).cross(t).normalize(),v=t.clone().cross(u)
    const offset=vertices.length/3
    for(const [point,r,c] of [[a,r0,color],[b,r1,endColor]] as const){
      for(let j=0;j<sides;j++){
        const angle=2*Math.PI*j/sides
        const q=point.clone().addScaledVector(u,r*Math.cos(angle)).addScaledVector(v,r*Math.sin(angle))
        vertices.push(q.x,q.y,q.z);colors.push(c.r,c.g,c.b)
      }
    }
    for(let i=0;i<sides;i++){
      const a=offset+i,b=offset+(i+1)%sides
      indices.push(a,b,b+sides,a,b+sides,a+sides)
    }
  }
  function finish(name:string){
    const geo=new BufferGeometry()
    geo.setAttribute('position',new Float32BufferAttribute(vertices,3));geo.setAttribute('color',new Float32BufferAttribute(colors,3))
    geo.setIndex(indices);geo.computeVertexNormals()
    const group=new Group();group.name=name;group.add(new Mesh(geo,material));return group
  }
  return {rod,finish}
}

export function foxtail(){
  const mesh=strands(),curve=new CatmullRomCurve3([
    new Vector3(),new Vector3(.004,.016,-.001),new Vector3(.015,.036,-.0025),new Vector3(.034,.052,-.003),
  ])
  const width=(t:number)=>.00045+.0036*Math.pow(Math.sin(Math.PI*t),.70)
  for(let j=0;j<24;j++)mesh.rod(curve.getPoint(j/24),curve.getPoint((j+1)/24),width(j/24),width((j+1)/24),green,seed,10)
  for(let i=0;i<420;i++){
    const t=(i+.5)/420,angle=i*2.399963,tangent=curve.getTangent(t)
    const u=new Vector3(0,0,1).cross(tangent).normalize(),v=tangent.clone().cross(u)
    const out=u.multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle))
    const w=width(t),origin=curve.getPoint(t).addScaledVector(out,w*.76)
    const grain=origin.clone().addScaledVector(out,.32*w).addScaledVector(tangent,.0019)
    mesh.rod(origin,grain,.00053,.00027,green,seed)
    const awn=grain.clone().addScaledVector(out,w*(.44+.15*Math.sin(i))).addScaledVector(tangent,.0034)
    mesh.rod(grain,awn,.00014,.00002,silk)
  }
  return mesh.finish('green-foxtail')
}

export function seedPanicle(){
  const mesh=strands()
  const twigs:Group[]=[]
  const axis=(t:number)=>new Vector3(-.0003*t*t,.082*t,-.006*t*t)
  for(let j=0;j<12;j++)mesh.rod(axis(j/12),axis((j+1)/12),.00052*(1-j/15),.00048*(1-j/15),rachis)
  for(let i=0;i<19;i++){
    const t=.14+i*.043,a=i*2.39996,reach=.019*(1-t)+.006
    const d=new Vector3(Math.cos(a),0,Math.sin(a)),start=axis(t)
    const fork=start.clone().addScaledVector(d,reach*.54);fork.y+=reach*.64
    const end=fork.clone().addScaledVector(d,reach*.46);end.y+=reach*.98
    const twig=strands()
    twig.rod(start,fork,.00032,.00022,rachis);twig.rod(fork,end,.00022,.00011,rachis)
    for(let j=0;j<4;j++){
      const at=fork.clone().lerp(end,(j+.35)/4)
      const side=new Vector3(Math.cos(a+(j%2?1:-1)),.95,Math.sin(a+(j%2?1:-1)))
      const seedBase=at.clone().addScaledVector(side,.0029)
      twig.rod(at,seedBase,.00014,.00010,rachis)
      const middle=seedBase.clone().addScaledVector(side,.0015),tip=middle.clone().addScaledVector(side,.0023)
      twig.rod(seedBase,middle,.00015,.00078,husk);twig.rod(middle,tip,.00078,.00006,husk)
    }
    const piece=twig.finish('spikelet-'+i)
    const geometry=(piece.children[0] as Mesh).geometry
    geometry.translate(-start.x,-start.y,-start.z)
    piece.position.copy(start);piece.userData.spikelet=i
    twigs.push(piece)
  }
  const head=mesh.finish('branched-seed-panicle')
  head.add(...twigs);return head
}
