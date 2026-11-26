import {Color, DataTexture, IcosahedronGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector3, type Mesh, type Texture, Float32BufferAttribute, type Matrix4} from 'three'
import type {HeightAt} from './terrain-height'
import {creekBankGrowth} from './CreekBankGrowth.ts'
import {shapeCreekShallows} from './CreekShallows.ts'
import {registerCreekFarShore} from './CreekFarShore.ts'

// The upper atlas row stores sRGB colour, the lower row linear normal XY and roughness.
// Wrapped gutters keep the adjacent scan out of oblique mip samples.
export const bankSampling = `
  uniform sampler2D creekSediment;
  vec3 sedimentTile(vec2 uv, vec2 tile){
    const float inner=1008./2048.;
    return textureGrad(creekSediment,tile*.5+vec2(8./2048.)+fract(uv)*inner,dFdx(uv)*inner,dFdy(uv)*inner).rgb;
  }
`
export const dryBankSurface = `
  float dryBank=smoothstep(.006,.038,shoreY)*(1.-smoothstep(7.,13.,length(g)));
  float farWetBed=smoothstep(-.25,-.10,shoreY)*(1.-smoothstep(.01,.16,shoreY))
    *smoothstep(-.4,.7,-g.y-4.2+.37*g.x)*(1.-smoothstep(10.,13.,length(g)));
  dryBank=max(dryBank,farWetBed);
  vec2 bedUv=mat2(.94,.342,-.342,.94)*g*.75+vec2(.143,.582);
  vec2 mouldUv=mat2(.82,-.572,.572,.82)*g*.55+vec2(.69,.341);
  float slack=clamp(.75*islands+.25*debris+.57*footprint.g,0.,1.);
  float wrack=smoothstep(.20,.63,slack+.24*smoothstep(.15,.60,shoreY)-.21*tide);
  vec3 gravelScan=sRGBTransferEOTF(vec4(sedimentTile(bedUv,vec2(0)),1.)).rgb;
  vec3 leafScan=sRGBTransferEOTF(vec4(sedimentTile(mouldUv,vec2(1,0)),1.)).rgb;
  vec3 gritMix=mix(gravelScan*vec3(.76,.71,.59),leafScan*vec3(.67,.61,.46),wrack);
  gritMix*=mix(vec3(1.),vec3(.53,.58,.56),tide);
  float shadedFarBank=smoothstep(-.25,-.08,shoreY)*smoothstep(-.4,.7,-g.y-4.2+.37*g.x);
  float rootMould=smoothstep(.24,.72,.52*islands+.31*debris+.17*micro);
  // Saturated leaf mould persists between the real root fans at the toe. The
  // waterline and upper edge vary with measured height, not a painted stripe.
  float rootedToe=shadedFarBank*(1.-smoothstep(.48,.94+.17*islands,shoreY));
  gritMix=mix(gritMix,mix(leafScan*vec3(.22,.25,.17),gravelScan*vec3(.25,.24,.17),.18+.25*(1.-rootMould)),rootedToe*(.70+.21*rootMould));
  gritMix*=mix(vec3(1.),vec3(.58,.65,.57),shadedFarBank*(.40+.45*wrack));
  float mossMargin=smoothstep(.36,.82,cover+.21*(islands-.5))*(.37+.39*wrack);
  gritMix=mix(gritMix,mossColour*(.77+.25*micro),mossMargin)*(1.-.68*footprint.r-.17*footprint.g);
  diffuseColor.rgb=mix(diffuseColor.rgb,gritMix,dryBank*.97);
  vec3 sandRelief=sedimentTile(bedUv,vec2(0,1));
  vec3 mouldRelief=sedimentTile(mouldUv,vec2(1,1));
  vec2 sandSlope=mat2(.94,-.342,.342,.94)*(sandRelief.xy*2.-1.);
  vec2 leafSlope=mat2(.82,.572,-.572,.82)*(mouldRelief.xy*2.-1.);
  vec2 bankSlope=mix(sandSlope,leafSlope,wrack);
  float bankRough=mix(sandRelief.b,mouldRelief.b,wrack);
`
export const dryBankNormal = `
  vec3 alluvialNormal=mat3(viewMatrix)*vec3(bankSlope.x,0.,bankSlope.y);
  normal=normalize(normal+dryBank*.68*(alluvialNormal-normal*dot(normal,alluvialNormal)));
`

// Some imported bank vertices are laterally offset from the authoring grid.
// Index the visible triangles once so a thin leaf or pebble meets their real surface.
export function creekBankHeight(bank:Mesh, fallback:HeightAt,stream?:Mesh):HeightAt{
  if(stream)shapeCreekShallows(bank,stream)
  const points=bank.geometry.attributes.position,index=bank.geometry.index!
  const span=.32,bins=new Map<number,number[]>()
  const key=(x:number,z:number)=>(z+128)*512+x+128
  for(let i=0;i<index.count;i+=3){
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2)
    const ax=points.getX(a),bx=points.getX(b),cx=points.getX(c)
    const az=points.getZ(a),bz=points.getZ(b),cz=points.getZ(c)
    for(let z=Math.floor(Math.min(az,bz,cz)/span);z<=Math.floor(Math.max(az,bz,cz)/span);z++){
      for(let x=Math.floor(Math.min(ax,bx,cx)/span);x<=Math.floor(Math.max(ax,bx,cx)/span);x++){
        const cell=key(x,z),faces=bins.get(cell)
        if(faces)faces.push(i);else bins.set(cell,[i])
      }
    }
  }
  const sample=(x:number,z:number,heights?:Float32Array)=>{
    let top=-Infinity
    for(const i of bins.get(key(Math.floor(x/span),Math.floor(z/span)))??[]){
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2)
      const ax=points.getX(a),az=points.getZ(a),px=x-ax,pz=z-az
      const ux=points.getX(b)-ax,uz=points.getZ(b)-az,vx=points.getX(c)-ax,vz=points.getZ(c)-az
      const determinant=ux*vz-uz*vx
      if(Math.abs(determinant)<1e-10)continue
      const u=(px*vz-pz*vx)/determinant,v=(ux*pz-uz*px)/determinant
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)top=Math.max(top,(heights?heights[a]:points.getY(a))*(1-u-v)+(heights?heights[b]:points.getY(b))*u+(heights?heights[c]:points.getY(c))*v)
    }
    return Number.isFinite(top)?top:fallback(x,z)
  }
  if(stream)registerCreekFarShore(bank,sample,()=>{
    const heights=Float32Array.from({length:points.count},(_,i)=>points.getY(i))
    return (x,z)=>sample(x,z,heights)
  })
  return sample
}

// Fluvial shingle collects in bars. Nearby stones share a mineral tint and
// direction, with enough variation for the smaller fragments to fill the gaps.
export function creekShingle(root:Object3D, ground:HeightAt, soil:DataTexture, level:number, atlas:Texture,openings:Texture,time:{value:number},kit:Object3D,garden:Object3D){
  let seed=47029
  function sample(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const clusters=[
    [-1.14,-.43,.61,.26],[-1.77,-.86,.69,.28],[-2.35,-1.36,.59,.33],
    [-1.16,-1.73,.74,.28],[-2.66,-2.75,.73,.35],[-2.75,-3.65,.96,.47],
    [.95,-.38,.45,.19],[1.48,-1.32,.83,.31],[2.14,-2.56,.81,.32],
    [-.44,-2.93,.65,.30],[2.92,-5.63,.95,.32],[-3.75,-5.07,1.10,.41],
  ]
  const deposits:{matrix:Matrix4; tint:Color}[][]=[[],[],[]]
  const palette=[0x847564,0xa1937d,0x756c57,0x645d51,0x989084,0x8e7157]
  const pivot=new Object3D(), up=new Vector3(0,1,0), normal=new Vector3()
  const data=soil.image.data as Uint8Array, size=soil.image.width, cell=32/size
  const packed=new Set<string>()
  for(const [cx,cz,rx,rz] of clusters){
    const heading=sample()*.85-.46,co=Math.cos(heading),si=Math.sin(heading)
    const mineral=Math.floor(sample()*palette.length)
    for(let i=0;i<115;i++){
      const phi=sample()*Math.PI*2,r=Math.sqrt(sample()),xl=Math.cos(phi)*r*rx,zl=Math.sin(phi)*r*rz
      const x=cx+xl*co-zl*si,z=cz+xl*si+zl*co,y=ground(x,z)
      const gridX=Math.floor((x+16)/cell),gridZ=Math.floor((z+29)/cell),key=gridX+','+gridZ
      if(y<level+.020||packed.has(key)||data[(gridZ*size+gridX)*4]>194)continue
      const radius=(.006+.036*sample()**2+(i<2?.031:0))*(1.13-.35*r)
      const height=radius*(.25+.29*sample())
      normal.set((ground(x-.035,z)-ground(x+.035,z))/.07,1,(ground(x,z-.035)-ground(x,z+.035))/.07).normalize()
      if(normal.y<.70)continue
      packed.add(key)
      pivot.quaternion.setFromUnitVectors(up,normal);pivot.rotateY(heading+(sample()-.5)*2.7)
      pivot.scale.set(radius,height,radius*(.43+.43*sample()))
      pivot.position.set(x,y-height*(.18+.30*sample()),z);pivot.updateMatrix()
      const wet=Math.min(1,(y-level)/.32)
      const tint=new Color(palette[sample()<.56?mineral:Math.floor(sample()*palette.length)]).multiplyScalar((.71+.34*sample())*(.68+.32*wet))
      deposits[radius<.021?0:radius<.034?1:2].push({matrix:pivot.matrix.clone(),tint})
      const window=Math.ceil(radius*1.3/cell)
      for(let dz=-window;dz<=window;dz++)for(let dx=-window;dx<=window;dx++){
        const sx=gridX+dx,sz=gridZ+dz
        if(sx<0||sz<0||sx>=size||sz>=size)continue
        const u=((sx+.5)*cell-16-x)/radius,v=((sz+.5)*cell-29-z)/radius
        const contact=Math.exp(-1.88*(u*u+v*v))
        const off=(sz*size+sx)*4
        data[off]=Math.max(data[off],Math.round(210*contact))
      }
    }
  }
  soil.needsUpdate=true
  const mat=new MeshStandardMaterial({roughness:.89,vertexColors:true})
  mat.onBeforeCompile=shader=>{
    shader.uniforms.creekSediment={value:atlas}
    shader.vertexShader='varying vec3 grainAt;\n'+shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\ngrainAt=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;')
    shader.fragmentShader=bankSampling+'varying vec3 grainAt;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 grainUV=grainAt.xz*3.2+grainAt.y*vec2(.82,-.51);
      float mineral=dot(sedimentTile(grainUV,vec2(0)),vec3(.28,.57,.15));
      diffuseColor.rgb*=.57+.97*mineral;
      diffuseColor.rgb+=vec3(.030,.027,.022)*smoothstep(.55,.76,mineral);`)
  }
  const meshes=deposits.map((placements,kind)=>{
    const geo=new IcosahedronGeometry(1,kind===2?1:0),pos=geo.attributes.position,colour:number[]=[]
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i)
      const relief=.12*Math.sin(3.6*x+1.7*y+kind)*Math.cos(2.9*z-kind)+.06*Math.sin(6.3*y+.64*kind)
      pos.setXYZ(i,x*(1+relief)+(.11+.09*kind)*y,Math.min(y,.60+.18*kind)*(1+relief*.69),z*(1+relief)-.14*x*x)
      const light=.69+.14*(1+y)+.09*Math.sin(x*9.1+z*3+kind)
      colour.push(light,light*.98,light*.95)
    }
    geo.setAttribute('color',new Float32BufferAttribute(colour,3))
    // Preserve the smooth water-worn normals of the stock polyhedron.
    geo.computeBoundingSphere()
    const mesh=new InstancedMesh(geo,mat,placements.length)
    mesh.name='creek_bank_shingle_'+kind
    mesh.userData.liveCreekBank=true
    placements.forEach(({matrix,tint},i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,tint)})
    mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.raycast=()=>{};root.add(mesh)
    return mesh
  })
  const releaseGrowth=creekBankGrowth(root,ground,level,openings,time,kit,garden)
  return ()=>{releaseGrowth();for(const mesh of meshes){mesh.removeFromParent();mesh.geometry.dispose();mesh.dispose()}mat.dispose()}
}

