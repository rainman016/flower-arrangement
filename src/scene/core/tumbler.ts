import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, LatheGeometry, LineBasicMaterial,
  LineLoop, Mesh, MeshPhysicalMaterial, Quaternion, Vector2, Vector3, Vector4,
} from 'three'

// Metres. The water cavity starts above the clear, solid heel.
const scale = .958
const floor = .014*scale
const brim = .112*scale
const bottomRadius = .0318*scale
const topRadius = .0405*scale
const segments = 64
export const GLASS_LIP = {radius:.0410*scale,outerRadius:.0416*scale,height:.1126*scale,floor,brim,scale}

export function tumblerWall() {
  const profile = [
    [0,.0010],[.025,.0010],[.029,.0005],[.0312,.0005],[.0325,.0016],[.0333,.004],
    [.0337,.0066],[.0338,.009],[.0416,.1095],[.0416,.1124],[.04125,.11295],[.04085,.11305],
    [.04055,.11275],[.0405,.112],[.0318,.014],[.0308,.01335],[.027,.01295],[0,.01295],
  ]
  return new LatheGeometry(profile.map(([radius,y])=>new Vector2(radius*scale,y*scale)),96)
}

export function radiusAt(y:number) {
  return bottomRadius + (topRadius-bottomRadius)*(y-floor)/(brim-floor)
}

// Integrate horizontal circular segments of the local cavity to locate a world-level surface.
function waterPlane(normal:Vector3,ml:number) {
  const horizontal = Math.hypot(normal.x,normal.z)
  let low = Math.min(normal.y*floor-horizontal*bottomRadius, normal.y*brim-horizontal*topRadius)
  let high = Math.max(normal.y*floor+horizontal*bottomRadius, normal.y*brim+horizontal*topRadius)
  const target = ml/1e6
  for(let step=0;step<17;step++){
    const level = (low+high)/2
    let volume = 0
    if(horizontal<.0001){
      const stop = Math.max(floor,Math.min(brim,level/normal.y))
      const a=normal.y>0?floor:stop, b=normal.y>0?stop:brim, ra=radiusAt(a), rb=radiusAt(b)
      volume = Math.PI*(b-a)*(ra*ra+ra*rb+rb*rb)/3
    }else{
      // Split at the heights where the plane touches a side, including nearly upright poses.
      const slope=(topRadius-bottomRadius)/(brim-floor),intercept=bottomRadius-slope*floor
      const limits=[floor,brim]
      for(const sign of [-1,1]){
        const y=(level-sign*horizontal*intercept)/(normal.y+sign*horizontal*slope)
        if(y>floor&&y<brim)limits.push(y)
      }
      limits.sort((a,b)=>a-b)
      for(let i=1;i<limits.length;i++){
        const dy=(limits[i]-limits[i-1])/12
        for(let j=0;j<12;j++){
          const y=limits[i-1]+(j+.5)*dy,r=radiusAt(y)
          const u=Math.max(-1,Math.min(1,(level-normal.y*y)/(horizontal*r)))
          volume+=(Math.PI/2+Math.asin(u)+u*Math.sqrt(1-u*u))*r*r*dy
        }
      }
    }
    if(volume<target)low=level
    else high=level
  }
  return (low+high)/2
}

function dynamicGeometry(size:number) {
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(new Float32Array(size*3),3))
  geometry.setDrawRange(0,0)
  return geometry
}

export class CupLiquid extends Group {
  readonly surfacePlane=new Vector4(0,1,0,0)
  private readonly body=new Mesh(dynamicGeometry(segments*15),new MeshPhysicalMaterial({
    color:'#abc5b9',transparent:true,opacity:.012,roughness:.08,ior:1.333,depthWrite:false,
  }))
  private readonly surface=new Mesh(dynamicGeometry((segments+4)*3),new MeshPhysicalMaterial({
    color:'#dbe6df',transparent:true,opacity:.072,roughness:.045,ior:1.333,clearcoat:1,side:DoubleSide,depthWrite:false,
  }))
  private readonly edge=new LineLoop(dynamicGeometry(segments+4),new LineBasicMaterial({
    color:'#dfe8db',transparent:true,opacity:.40,vertexColors:true,depthWrite:false,
  }))
  private readonly rings=[floor,brim].map(y=>Array.from({length:segments},(_,i)=>{
    const a=i*2*Math.PI/segments,r=radiusAt(y)-.00008
    return new Vector3(r*Math.cos(a),y,r*Math.sin(a))
  }))
  private readonly normal=new Vector3()
  private lastMl=-1

  constructor(){
    super()
    this.name='cup-liquid'
    this.add(this.body,this.surface,this.edge)
    this.body.name='water-in-glass';this.surface.name='water-surface';this.edge.name='water-meniscus'
    this.edge.geometry.setAttribute('color',new BufferAttribute(new Float32Array((segments+4)*3),3))
    this.children.forEach((part,i)=>{part.renderOrder=2+i;part.raycast=()=>{}})
    this.updateLevel(new Quaternion(),180)
  }
  updateLevel(rotation:Quaternion,ml:number){
    this.visible=ml>.1
    if(!this.visible){this.lastMl=0;this.surfacePlane.set(0,1,0,1);return}
    const up=new Vector3(0,1,0).applyQuaternion(rotation.clone().invert())
    if(Math.abs(ml-this.lastMl)<.035&&up.distanceToSquared(this.normal)<1e-8)return
    this.normal.copy(up);this.lastMl=ml
    const level=waterPlane(up,ml)
    this.surfacePlane.set(up.x,up.y,up.z,-level)
    const [lo,hi]=this.rings, outline:Vector3[]=[]
    let written=0
    const body=this.body.geometry,positions=body.getAttribute('position')
    const polygon=(vertices:Vector3[],collect:boolean)=>{
      const clipped:Vector3[]=[]
      let a=vertices[vertices.length-1], da=a.dot(up)-level
      for(const b of vertices){
        const db=b.dot(up)-level
        if((da<0)!==(db<0)){
          const hit=a.clone().lerp(b,da/(da-db))
          clipped.push(hit)
          if(collect&&!outline.some(p=>p.distanceToSquared(hit)<1e-16))outline.push(hit)
        }
        if(db<=0)clipped.push(b)
        a=b;da=db
      }
      for(let i=2;i<clipped.length;i++)for(const v of [clipped[0],clipped[i-1],clipped[i]])positions.setXYZ(written++,v.x,v.y,v.z)
    }
    for(let i=0;i<segments;i++){
      const j=(i+1)%segments
      polygon([lo[i],hi[i],hi[j],lo[j]],true)
    }
    polygon(lo,false);polygon([...hi].reverse(),false)
    body.setDrawRange(0,written);positions.needsUpdate=true
    const centre=new Vector3()
    outline.forEach(p=>centre.add(p));centre.divideScalar(outline.length||1)
    const x=new Vector3(Math.abs(up.y)>.9?1:0,Math.abs(up.y)>.9?0:1,0).cross(up).normalize()
    const z=up.clone().cross(x)
    const angle=(p:Vector3)=>Math.atan2(p.dot(z)-centre.dot(z),p.dot(x)-centre.dot(x))
    outline.sort((a,b)=>angle(a)-angle(b))
    const cap=this.surface.geometry,edge=this.edge.geometry
    outline.forEach((p,i)=>{
      edge.getAttribute('position').setXYZ(i,p.x,p.y,p.z)
      const arc=.15+.80*Math.pow(.5+.5*Math.cos(2*angle(p)+.73),1.8)
      edge.getAttribute('color').setXYZ(i,arc,arc,arc)
      const triangle=[centre,p,outline[(i+1)%outline.length]]
      triangle.forEach((v,j)=>cap.getAttribute('position').setXYZ(3*i+j,v.x,v.y,v.z))
    })
    edge.getAttribute('color').needsUpdate=true
    cap.setDrawRange(0,outline.length*3);edge.setDrawRange(0,outline.length)
    for(const geometry of [cap,edge,body]){
      geometry.getAttribute('position').needsUpdate=true
      geometry.computeBoundingSphere();geometry.computeBoundingBox()
    }
    cap.computeVertexNormals();body.computeVertexNormals()
  }
  dispose(){
    for(const part of [this.body,this.surface,this.edge]){part.geometry.dispose();part.material.dispose()}
  }
}
