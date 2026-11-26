import {BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Vector3} from 'three'
import type {HeightAt} from './terrain-height'

const clamp=(v:number)=>Math.max(0,Math.min(1,v))
function ease(a:number,b:number,v:number){
  const t=clamp((v-a)/(b-a));return t*t*(3-2*t)
}

// Split only the hero scan. Keep its UV seams, but use a common outward field
// on both sides of each seam so the weathering and moss cannot pull it apart.
export function weatherOutcrop(source:BufferGeometry,world:Matrix4,ground:HeightAt){
  const src=source.attributes.position,tex=source.attributes.uv,idx=source.index!
  const points:number[]=[],uv:number[]=[],indices:number[]=[],cover:number[]=[],bedrock:number[]=[]
  for(let i=0;i<src.count;i++){
    points.push(src.getX(i),src.getY(i),src.getZ(i));uv.push(tex.getX(i),tex.getY(i))
  }
  const edges=new Map<number,number>()
  function midpoint(i:number,j:number){
    const key=Math.min(i,j)*src.count+Math.max(i,j),cached=edges.get(key)
    if(cached!==undefined)return cached
    const k=points.length/3
    for(let c=0;c<3;c++)points.push((points[3*i+c]+points[3*j+c])*.5)
    for(let c=0;c<2;c++)uv.push((uv[2*i+c]+uv[2*j+c])*.5)
    edges.set(key,k);return k
  }
  for(let i=0;i<idx.count;i+=3){
    const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2)
    const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a)
    indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca)
  }
  const p=new Vector3(),n=new Vector3(),inverse=world.clone().invert()
  for(let i=0;i<points.length;i+=3){
    p.fromArray(points,i).applyMatrix4(world)
    const x=p.x-1.77,z=p.z+3.68,y=p.y-.55,above=p.y-ground(p.x,p.z)
    n.set(x/.34,(p.y-.43)/.20,z/.24).normalize()
    const across=x+.37*z,broken=.018*Math.sin(23*y+7*z)+.012*Math.sin(42*z-11*x)
    const bank=across-.48*y+.15*n.y+broken+.049*Math.sin(17*z+12*y)+.028*Math.cos(38*y-7*x)
    const colonies=.040*Math.sin(37*x+24*y+Math.sin(19*z))+.023*Math.cos(42*z-31*y)
    const mask=ease(-.23,-.071,bank+colonies)*ease(-.02,.07,above)
    const swale=.5+.30*Math.sin(15*x+9*z+4*y)+.20*Math.cos(27*y-8*z)
    const nap=.5+.28*Math.sin(37*x+24*y+Math.sin(19*z))+.22*Math.cos(42*z-31*y)
    const padding=mask*(.008+.022*swale+.016*nap*nap)
    // Interrupted oblique lips on the left face. Their lit flank, adjacent
    // recess and varying widths come from the mesh, including in its shadow.
    const along=across-.46*y+broken
    const rib=(center:number,width:number)=>Math.exp(-Math.pow((along-center)/width,2))
    const ridges=(.026*rib(-.30,.052)-.008*rib(-.264,.039))*(.50+.50*ease(-.25,.08,z))+
      .022*rib(-.145,.073)*(.54+.46*Math.cos(y*13+z*7))-.009*rib(-.084,.045)+
      .014*rib(-.43,.059)*ease(-.18,.15,y+z)
    const raised=ridges*(1-mask)*ease(.00,.12,above)
    p.addScaledVector(n,raised+padding).applyMatrix4(inverse).toArray(points,i)
    cover.push(mask);bedrock.push(raised)
  }
  const geom=new BufferGeometry()
  geom.setAttribute('position',new Float32BufferAttribute(points,3))
  geom.setAttribute('uv',new Float32BufferAttribute(uv,2))
  geom.setAttribute('_mossMantle',new Float32BufferAttribute(cover,1))
  geom.setAttribute('_rockLip',new Float32BufferAttribute(bedrock,1))
  geom.setIndex(indices);geom.computeVertexNormals()
  // Average the normals at UV splits without welding the texture coordinates.
  const normals=geom.attributes.normal,sums=new Map<string,Vector3>(),keys:string[]=[]
  for(let i=0;i<normals.count;i++){
    const key=points.slice(3*i,3*i+3).map(v=>Math.round(v*1e5)).join(',')
    const sum=sums.get(key)??new Vector3();sum.add(n.fromBufferAttribute(normals,i));sums.set(key,sum);keys.push(key)
  }
  for(let i=0;i<normals.count;i++){n.copy(sums.get(keys[i])!).normalize();normals.setXYZ(i,n.x,n.y,n.z)}
  geom.computeBoundingBox();geom.computeBoundingSphere();return geom
}

// Young, pinnate fronds growing in the two sheltered pockets. Each leaflet
// twists around its own midrib and tapers downwards at the tip.
export function stoneFootFerns(ground:HeightAt){
  let seed=8309
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const p:number[]=[],col:number[]=[],bend:number[]=[],phase:number[]=[],ix:number[]=[]
  const tint=new Color(),up=new Vector3(0,1,0),tmp=new Vector3()
  function vertex(v:Vector3,t:number,age:number,light:number,angle:number){
    p.push(v.x,v.y,v.z);tint.setRGB(.059+.086*age,.100+.105*age,.026+.025*age).multiplyScalar(light)
    col.push(tint.r,tint.g,tint.b);bend.push(t*t*.07);phase.push(angle);return bend.length-1
  }
  for(const [x,z,size] of [[1.20,-3.20,.78],[1.40,-3.10,.64],[1.68,-3.07,1.43],[2.12,-3.07,.69],[2.27,-3.37,.78]]){
    for(let f=0;f<6;f++){
      const angle=(f+rand()*.7)*1.05,axis=new Vector3(Math.cos(angle),0,Math.sin(angle)),side=new Vector3(-axis.z,0,axis.x)
      const base=new Vector3(x+rand()*.036,0,z+rand()*.035);base.y=ground(base.x,base.z)-.004
      const l=(.12+rand()*.13)*size,h=(.13+rand()*.16)*size,age=rand(),curve=(rand()-.5)*.075
      const stem=(t:number)=>base.clone().addScaledVector(axis,l*t*t).addScaledVector(up,h*(1.68*t-.91*t*t)).addScaledVector(side,curve*t*t)
      let previous=-1
      for(let row=0;row<=12;row++){
        const t=row/12,center=stem(t),w=.0015*(1-.80*t)
        const k=vertex(tmp.copy(center).addScaledVector(side,-w),t,age,.58+.38*t,angle)
        vertex(tmp.copy(center).addScaledVector(side,w),t,age,.75+.40*t,angle)
        if(previous>=0)ix.push(previous,k,previous+1,previous+1,k,k+1)
        previous=k
        if(row<3||row===12)continue
        for(const sign of [-1,1]){
          const root=stem(t+(sign>0?.014:0)),span=(.009+.042*Math.sin((t-.13)*Math.PI)**.85)*size*(.82+.32*rand())
          const end=root.clone().addScaledVector(side,sign*span).addScaledVector(axis,span*(.32+.30*t)).addScaledVector(up,span*(.12-.42*t))
          const mid=root.clone().lerp(end,.46).addScaledVector(up,span*.14),width=span*(.14+.07*rand())
          const j=vertex(root,t,age,.58+.24*t,angle)
          vertex(tmp.copy(mid).addScaledVector(axis,-width),t,age,.72+.19*t,angle)
          vertex(tmp.copy(mid).addScaledVector(up,width*.53),t,age,1.+.16*t,angle)
          vertex(tmp.copy(mid).addScaledVector(axis,width).addScaledVector(up,-width*.34),t,age,.83+.18*t,angle)
          vertex(end,t,age,.90+.25*t,angle);ix.push(j,j+1,j+2,j,j+2,j+3,j+1,j+4,j+2,j+2,j+4,j+3)
        }
      }
    }
  }
  const geom=new BufferGeometry()
  for(const [name,a,n] of [['position',p,3],['color',col,3],['_bend',bend,1],['_phase',phase,1]] as const)
    geom.setAttribute(name,new Float32BufferAttribute(a,n))
  geom.setIndex(ix);geom.computeVertexNormals()
  const mat=new MeshStandardMaterial({vertexColors:true,roughness:.91,side:DoubleSide})
  const mesh=new Mesh(geom,mat);mesh.name='outcrop_fern_fronds';mesh.userData.wind=true
  return {mesh,dispose:()=>{geom.dispose();mat.dispose()}}
}
