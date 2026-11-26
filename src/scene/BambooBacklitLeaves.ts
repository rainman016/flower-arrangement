import {BufferGeometry,Color,DoubleSide,Euler,Float32BufferAttribute,Matrix4,Mesh,MeshStandardMaterial,Object3D,PerspectiveCamera,Raycaster,Vector2,Vector3} from 'three'
import {deskView} from './core/desk-space'

type Batch={p:number[];c:number[];uv:number[];bend:number[];phase:number[];tissue:number[];ix:number[]}
const batch=():Batch=>({p:[],c:[],uv:[],bend:[],phase:[],tissue:[],ix:[]})

// Add visible narrow blades to actual culm nodes. The agreed view only authors
// branch destinations; all stems, folded leaves and normals remain fully 3D.
export function bambooBacklitLeaves(root:Object3D){
  const blades=batch(),twigs=batch(),up=new Vector3(0,1,0),scratch=new Vector3()
  const markers:Object3D[]=[]
  root.traverse(o=>{if(String(o.userData.prototype??'').startsWith('grove_')&&o.scale.y>.48)markers.push(o)})
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80),ray=new Raycaster(),uv=new Vector2()
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  const palette=[0x758b33,0x87993d,0x657e2e,0x9b9e42,0x70883a].map(c=>new Color(c)),bark=new Color(0x64743b)
  let seed=188723,leafCount=0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const attachments:{screen:number[];requestedScreen:number[];target:number[];anchor:number[];culm:string;prototype:string;reach:number;surfaceDistance:number}[]=[]
  function vertex(data:Batch,p:Vector3,c:Color,shade:number,u:number,v:number,flex:number,phase:number,tissue=0){
    data.p.push(p.x,p.y,p.z);data.c.push(c.r*shade,c.g*shade,c.b*shade);data.uv.push(u,v)
    data.bend.push(flex);data.phase.push(phase);data.tissue.push(tissue);return data.p.length/3-1
  }
  function twig(a:Vector3,b:Vector3,r:number,phase:number){
    const axis=b.clone().sub(a).normalize(),side=axis.clone().cross(up).normalize(),normal=side.clone().cross(axis).normalize(),first=twigs.p.length/3
    for(const [p,width,t] of [[a,r,0],[b,r*.55,1]] as const)for(let k=0;k<3;k++)
      vertex(twigs,scratch.copy(p).addScaledVector(side,Math.cos(k*2.094)*width).addScaledVector(normal,Math.sin(k*2.094)*width),bark,.77+k*.08,k/3,t,.012*t,phase)
    for(let k=0;k<3;k++){const n=(k+1)%3;twigs.ix.push(first+k,first+n,first+3+k,first+n,first+3+n,first+3+k)}
  }
  function leaf(base:Vector3,axis:Vector3,length:number,phase:number){
    axis.normalize()
    const side=axis.clone().cross(up).normalize().applyAxisAngle(axis,(random()-.5)*2.05)
    const fold=axis.clone().cross(side).normalize(),width=length*(base.z>-18?.075+.026*random():.045+.021*random())
    const middle=base.clone().addScaledVector(axis,length*(.38+.17*random())).addScaledVector(up,length*.055)
    const tip=base.clone().addScaledVector(axis,length).addScaledVector(up,-length*(.13+.19*random()))
    const tissue=leafCount%5===0?.10:.70+.30*random()
    const tint=palette[leafCount%palette.length],first=vertex(blades,base,tint,.65,.5,0,0,phase,.34*tissue)
    vertex(blades,middle.clone().addScaledVector(side,-width),tint,.91,0,.48,.016,phase,tissue)
    vertex(blades,middle.clone().addScaledVector(fold,width*.34),tint,.96,.5,.48,.016,phase,.78*tissue)
    vertex(blades,middle.clone().addScaledVector(side,width),tint,.82,1,.48,.016,phase,.94*tissue)
    vertex(blades,tip,tint,.91,.5,1,.029,phase,.82*tissue)
    blades.ix.push(first,first+2,first+1,first,first+3,first+2,first+1,first+2,first+4,first+2,first+3,first+4);leafCount++
  }
  const targets=[[.045,.080,-7.5],[.095,.145,-8],[.170,.075,-6.3],[.235,.045,-7.5],[.300,.125,-8.5],
    [.365,.060,-10.5],[.175,.205,-9.8],[.065,.205,-11.8],[.270,.185,-10.2],[.125,.025,-9.3],
    [.025,.035,-13.5],[.075,.115,-14.2],[.125,.065,-12.5],[.190,.125,-14.8],
    [.230,.090,-16.0],[.280,.155,-15.2],[.325,.035,-16.4],[.110,.185,-15.5],
    [.020,.130,-22],[.060,.060,-21],[.105,.025,-23],[.145,.105,-20],[.180,.040,-25],
    [.220,.170,-23],[.260,.045,-24],[.300,.115,-26],[.340,.175,-22],[.070,.200,-24]] as const
  for(const [x,y,z] of targets){
    if(!markers.length)break
    ray.setFromCamera(uv.set(x*2-1,1-y*2),camera)
    const target=ray.ray.at((z-ray.ray.origin.z)/ray.ray.direction.z,new Vector3())
    const stem=markers.reduce((best,o)=>Math.hypot(o.position.x-target.x,o.position.z-target.z)<Math.hypot(best.position.x-target.x,best.position.z-target.z)?o:best)
    const prototype=String(stem.userData.prototype),source=root.getObjectByName(prototype+'_culm') as Mesh
    const local=target.clone().addScaledVector(up,.10).applyMatrix4(new Matrix4().copy(stem.matrixWorld).invert())
    const positions=source.geometry.attributes.position;let closest=Infinity,count=0
    for(let i=0;i<positions.count;i++)closest=Math.min(closest,Math.abs(positions.getY(i)-local.y))
    const anchor=new Vector3()
    for(let i=0;i<positions.count;i++)if(Math.abs(positions.getY(i)-local.y)<closest+.013){anchor.add(new Vector3().fromBufferAttribute(positions,i));count++}
    anchor.divideScalar(count).applyMatrix4(stem.matrixWorld)
    const barkPoint=new Vector3();let barkDistance=Infinity
    for(let i=0;i<positions.count;i++)if(Math.abs(positions.getY(i)-local.y)<closest+.013){
      scratch.fromBufferAttribute(positions,i).applyMatrix4(stem.matrixWorld)
      const distance=scratch.distanceToSquared(target)
      if(distance<barkDistance){barkDistance=distance;barkPoint.copy(scratch)}
    }
    anchor.lerp(barkPoint,.94)
    const reach=anchor.distanceTo(target)
    if(reach>1.55)target.lerp(anchor,1-1.55/reach)
    let surfaceDistance=Infinity
    for(let i=0;i<positions.count;i++)surfaceDistance=Math.min(surfaceDistance,scratch.fromBufferAttribute(positions,i).applyMatrix4(stem.matrixWorld).distanceTo(anchor))
    const screen=target.clone().project(camera)
    attachments.push({screen:[screen.x*.5+.5,.5-screen.y*.5],requestedScreen:[x,y],target:target.toArray(),anchor:anchor.toArray(),culm:stem.name,prototype,reach:anchor.distanceTo(target),surfaceDistance})
    const control=anchor.clone().lerp(target,.5).addScaledVector(up,.08),phase=random()*6.28
    const along=(t:number)=>anchor.clone().multiplyScalar((1-t)**2).addScaledVector(control,2*t*(1-t)).addScaledVector(target,t*t)
    let prior=anchor
    for(let k=1;k<=4;k++){const next=along(k/4);twig(prior,next,.005*(1-k*.15),phase);prior=next}
    const axis=target.clone().sub(anchor);axis.y=0;axis.normalize()
    const side=new Vector3(-axis.z,0,axis.x)
    for(let branch=0;branch<9;branch++){
      const t=.20+branch*.092,base=along(t),sign=branch%2?-1:1
      const end=base.clone().addScaledVector(side,sign*(.10+.20*Math.sin(t*Math.PI))).addScaledVector(axis,.09+.09*random())
      end.y-=.04+.09*random();twig(base,end,.0023,phase)
      const branchDirection=end.clone().sub(base).normalize(),cross=new Vector3(-branchDirection.z,0,branchDirection.x).normalize()
      for(let j=0;j<7;j++){
        const s=.10+j*.135,baseLeaf=base.clone().lerp(end,s)
        const direction=branchDirection.clone().multiplyScalar(.38+.35*random()).addScaledVector(cross,(j%2?-1:1)*(.62+.33*random())).addScaledVector(up,-.20-.25*random())
        leaf(baseLeaf,direction,.15+.14*random(),phase+j*.27)
      }
    }
  }
  const meshes:Mesh[]=[]
  for(const [name,data] of [['bamboo_sunlit_spray_leaves',blades],['bamboo_sunlit_spray_twigs',twigs]] as const){
    const geometry=new BufferGeometry()
    for(const [key,values,size] of [['position',data.p,3],['color',data.c,3],['uv',data.uv,2],['_bend',data.bend,1],['_phase',data.phase,1],['_sunTissue',data.tissue,1]] as const)
      geometry.setAttribute(key,new Float32BufferAttribute(values,size))
    geometry.setIndex(data.ix);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    const material=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.78})
    const mesh=new Mesh(geometry,material);mesh.name=name;mesh.userData.wind=true;mesh.userData.bambooSunLeaf=name.endsWith('leaves')
    root.add(mesh);meshes.push(mesh)
  }
  const report={leaves:leafCount,triangles:(blades.ix.length+twigs.ix.length)/3,attachments,meshes:meshes.map(m=>({name:m.name,triangles:m.geometry.index!.count/3}))}
  root.userData.bambooBacklitLeaves=report
  return {report,meshes,dispose:()=>meshes.forEach(m=>{m.geometry.dispose();(m.material as MeshStandardMaterial).dispose()})}
}
