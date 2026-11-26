import { BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'

const petalMaterial=new MeshStandardMaterial({vertexColors:true,side:DoubleSide,roughness:.87,envMapIntensity:.42})
// Preserve the ray pigment under the three different HDR skies while retaining local diffuse shading.
const goldMaterial=petalMaterial.clone()
goldMaterial.toneMapped=false
goldMaterial.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    {
      vec3 petalLuminance = vec3(.2126,.7152,.0722);
      float petalIrradiance = dot(outgoingLight,petalLuminance)/max(.005,dot(diffuseColor.rgb,petalLuminance));
      outgoingLight = diffuseColor.rgb*clamp(petalIrradiance,.32,1.24);
    }
    #include <opaque_fragment>
  `)
}
const green=new MeshStandardMaterial({color:'#66783c',roughness:.86})
const amber=new Color('#ad6508'),pollen=new Color('#ca8a16'),ivoryPollen=new Color('#d0a246')

/** One corolla on one pedicel. The ray and disc geometry remains readable when rotated. */
export function wildflowerHead(white:boolean,daisy=false){
  const root=new Group(),size=daisy?.014:white?.0088:.0142
  const neck=white?new Vector3(-.002,.008,.003):new Vector3(0,.003,0)
  const stalk=new Mesh(new CylinderGeometry(.00056,.00072,neck.length(),7),green)
  stalk.quaternion.setFromUnitVectors(new Vector3(0,1,0),neck.clone().normalize())
  stalk.position.copy(neck).multiplyScalar(.5);root.add(stalk)
  const base=new Mesh(new SphereGeometry(white?.0020:.0029,12,8),green)
  base.scale.y=.56;base.position.copy(neck);root.add(base)
  const vertices:number[]=[],colors:number[]=[],faces:number[]=[]
  const count=daisy?21:white?5:14
  const palette=white?['#c9c6aa','#f2edda','#fff7e8']:['#a05a02','#eaa000','#ffb900']
  const shades=palette.map(c=>new Color(c))
  const widths=white?[.17,.63,.94,1,.72,.18]:[.17,.55,.85,.98,.70,.10]
  for(let i=0;i<count;i++){
    const a=(i+(white?.1:.04)*Math.sin(i*3.1))*2*Math.PI/count
    const dx=Math.cos(a),dz=Math.sin(a),length=size*(.93+.07*Math.sin(1+i*5.2))
    const offset=vertices.length/3
    for(let step=0;step<6;step++){
      const t=[0,.22,.50,.77,.94,1][step],radius=length*((white?.13:.19)+(white?.87:.81)*t)
      const width=(daisy?.00130:white?.00285:.00163)*widths[step]
      for(let side=-1;side<=1;side++){
        const rise=size*(.11*Math.sin(t*Math.PI)+(.09+.10*Math.sin(i*1.8))*t*t)
        vertices.push(neck.x+dx*radius-dz*side*width,neck.y+rise+.00045*(1-side*side),neck.z+dz*radius+dx*side*width)
        const tint=shades[0].clone().lerp(shades[1],Math.min(1,3*t)).lerp(shades[2],(.26+.45*t)*(side===0?.84:1))
        colors.push(tint.r,tint.g,tint.b)
      }
      if(step>0)for(let j=0;j<2;j++){
        const front=offset+step*3+j,back=front-3
        faces.push(back,back+1,front,front,back+1,front+1)
      }
    }
  }
  const petals=new BufferGeometry()
  petals.setAttribute('position',new Float32BufferAttribute(vertices,3));petals.setAttribute('color',new Float32BufferAttribute(colors,3))
  petals.setIndex(faces);petals.computeVertexNormals()
  const rays=new Mesh(petals,white?petalMaterial:goldMaterial);rays.name=daisy?'daisy-white-rays':white?'five-ivory-petals':'golden-ray-florets';root.add(rays)
  const radius=daisy?.0038:white?.00174:.00345
  const disc=new SphereGeometry(radius,24,10),positions=disc.getAttribute('position'),grains=[]
  for(let i=0;i<positions.count;i++){
    const variation=.5+.5*Math.cos(positions.getX(i)*9300+positions.getZ(i)*6700)
    const tint=amber.clone().lerp(white?ivoryPollen:pollen,.16+.54*variation)
    grains.push(tint.r,tint.g,tint.b)
  }
  disc.setAttribute('color',new Float32BufferAttribute(grains,3))
  const centre=new Mesh(disc,goldMaterial);centre.name='pollen-disc'
  centre.position.copy(neck);centre.position.y+=.00060;centre.scale.y=.51;root.add(centre)
  return root
}
