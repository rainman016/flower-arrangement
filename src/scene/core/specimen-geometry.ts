import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Specimen } from '../../content/specimens'

const surface=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.89,metalness:0})
const tau=Math.PI*2
// Folded blade surfaces, petal cups and tapered stalks share one indexed mesh per attachment.
class BotanicalSurface {
  private positions:number[]=[]
  private colors:number[]=[]
  private indices:number[]=[]
  private vertex(p:Vector3,color:Color,light=1){
    this.positions.push(p.x,p.y,p.z)
    this.colors.push(color.r*light,color.g*light,color.b*light)
    return this.positions.length/3-1
  }
  blade(base:Vector3,angle:number,reach:number,rise:number,width:number,color:Color,arch=0,lobes=0){
    const side=new Vector3(-Math.sin(angle),0,Math.cos(angle))
    const forward=new Vector3(Math.cos(angle),0,Math.sin(angle))
    let last=0
    const steps=lobes?24:10
    for(let i=0;i<=steps;i++){
      const t=i/steps,wave=Math.sin(t*Math.PI)
      const middle=base.clone().addScaledVector(forward,reach*(.55*t+.45*t*t))
      middle.y+=rise*t+arch*wave
      const w=width*Math.pow(wave,.72)*(.98+ (lobes?.36*Math.sin(t*Math.PI*lobes*2):0))+.00004
      const a=this.vertex(middle.clone().addScaledVector(side,-w),color,.72+.18*t)
      middle.y+=w*.27
      this.vertex(middle,color,1.04)
      middle.y-=w*.30
      this.vertex(middle.clone().addScaledVector(side,w),color,.84+.14*t)
      if(i)this.indices.push(last,a,last+1,last+1,a,a+1,last+1,a+1,last+2,last+2,a+1,a+2)
      last=a
    }
  }
  stalk(a:Vector3,b:Vector3,r:number,c:Color){
    const dir=b.clone().sub(a).normalize(),u=new Vector3(1,0,0).cross(dir).normalize(),v=dir.clone().cross(u)
    const n=5,start=this.positions.length/3
    for(const [end,scale] of [[a,1],[b,.56]] as const)for(let i=0;i<n;i++){
      const angle=tau*i/n
      this.vertex(end.clone().addScaledVector(u,r*scale*Math.cos(angle)).addScaledVector(v,r*scale*Math.sin(angle)),c,.8+i*.045)
    }
    for(let i=0;i<n;i++){
      const j=(i+1)%n
      this.indices.push(start+i,start+i+n,start+j,start+j,start+i+n,start+j+n)
    }
  }
  finish(){
    const g=new BufferGeometry()
    g.setAttribute('position',new Float32BufferAttribute(this.positions,3))
    g.setAttribute('color',new Float32BufferAttribute(this.colors,3))
    g.setIndex(this.indices);g.computeVertexNormals()
    const group=new Group();group.add(new Mesh(g,surface));return group
  }
}
const at=(radius:number,y:number,a:number)=>new Vector3(radius*Math.cos(a),y,radius*Math.sin(a))
function blossom(b:BotanicalSurface,p:Vector3,n:number,r:number,c:Color,pom:boolean){
  const disc=new Color(pom?c:'#a88536')
  const petals=pom?n*2:n
  for(let i=0;i<petals;i++){
    const a=i*2.39996,layer=pom?i/petals:(i%3)/10
    const radius=r*(1-layer*.63),base=p.clone();base.y+=layer*r*.43
    b.blade(base,a,radius,pom?r*.42:r*(.13+.12*Math.sin(i)),radius*Math.min(.29,3/n),c, r*(pom?.32:.15))
  }
  for(let i=0;i<13;i++){
    const base=p.clone().add(at(Math.sqrt(i/13)*r*.22,.0012,i*2.39996))
    b.blade(base,i,.001,.0018,.00085,disc,.00065)
  }
}
function foliage(b:BotanicalSurface,s:Specimen,green:Color,n:number){
  const base=new Vector3()
  if(s.form==='blade'){
    for(let i=0;i<n;i++)b.blade(base,i*2.39996,.025+.022*Math.sin(i*1.76),.043+.033*(i%3)/2,.0028*s.width,green,.014)
    return
  }
  if(s.form==='lobed'){
    b.blade(base,.55,.037,.064,.013*s.width,green,.009,6);return
  }
  const length=.065
  b.stalk(base,at(.017,length,.15),.0007,green)
  for(let i=0;i<n;i++){
    const t=(i+.65)/(n+.7),origin=at(.017*t,length*t,.15),span=.010+.021*Math.sin(Math.PI*t)
    for(const side of [-1,1])b.blade(origin,side*1.46+.15,span*s.width,s.form==='fern'?.012:.021,
      (s.form==='fern'?.0034:.0072)*s.width*(1-.35*t),green,.0025,s.form==='fern'?4:0)
  }
}
export function specimenLeaf(s:Specimen){
  const b=new BotanicalSurface(),color=new Color(s.green)
  if(['fern','compound','lobed','blade'].includes(s.form))foliage(b,s,color,s.count)
  else b.blade(new Vector3(),.37,.020,.065,s.form==='plume'||s.form==='panicle'?.0023:.0052,color,.006)
  return b.finish()
}
export function specimenHead(s:Specimen){
  const b=new BotanicalSurface(),p=new Vector3(),c=new Color(s.accent),green=new Color(s.green)
  if(s.form==='ray'||s.form==='pom')blossom(b,p,s.count,.012*s.width,c,s.form==='pom')
  else if(s.form==='spray'||s.form==='bell'){
    for(let i=0;i<s.count;i++){
      const a=i*2.4,t=i/s.count,root=new Vector3(0,t*.026,0),end=at(.012+.014*Math.sin(Math.PI*t),.015+t*.043,a)
      b.stalk(p,root,.00052,green);b.stalk(root,end,.00042,green)
      if(s.form==='bell')for(let j=0;j<5;j++)b.blade(end,j*tau/5,.004,-.007,.0023,c,.002)
      else blossom(b,end,5,.0043*s.width,c,false)
    }
  }else if(s.form==='plume'||s.form==='panicle'){
    const reach=s.form==='plume'?.010:.029,top=at(.018,.081,0)
    b.stalk(p,top,.00065,green)
    for(let i=0;i<s.count;i++){
      const t=i/s.count,a=i*2.39996,base=top.clone().multiplyScalar(t),w=reach*(.3+.7*Math.sin(Math.PI*t))
      const end=base.clone().add(at(w,.012,a));b.stalk(base,end,.00031,c)
      for(let j=0;j<5;j++)b.blade(end,a+j*.37,w*.43,.011+.004*Math.sin(j),.0007*s.width,c,.002)
    }
  }else foliage(b,s,green,s.count)
  return b.finish()
}
