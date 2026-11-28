import {BufferGeometry, Color, DoubleSide, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, Vector3} from 'three'
import type {HeightAt} from './terrain-height'

// Small soil aggregates collect in pockets. Young blades grow at their margins.
export function bambooVerge(root:Object3D, heightAt:HeightAt, leafGaps:Vector3[]){
  let seed=0x702f1029
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const grainGeometry=new IcosahedronGeometry(1,0)
  const mineral=new MeshStandardMaterial({roughness:.96})
  const grains=new InstancedMesh(grainGeometry,mineral,5600)
  const grainColours=[0x534936,0x766a50,0x8e8064,0x655d4e,0x524e40,0x968871]
  const seedlingColours=[0x647337,0x839446,0x59693b,0x7b8242,0x606d30]
  const marker=new Object3D(),tone=new Color(),groundNormal=new Vector3(),up=new Vector3(0,1,0)
  const points:number[]=[],colours:number[]=[],indices:number[]=[],bends:number[]=[],phases:number[]=[]
  let grainCount=0,tufts=0
  function shoot(x:number,z:number,h:number,angle:number,tint:number){
    const near=z> -3.1&&Math.abs(x)<2.8
    const pocket=.5+.5*Math.sin(x*4.7+z*3.1+.7*Math.sin(z*2.4))
    // Low, broken pockets beside the desk; keep the distinct farther fern groups.
    if(near&&z> -2.05&&Math.abs(x)>1.0&&pocket<.40){random();random();random();return}
    if(near)h*=.78
    const dx=Math.cos(angle),dz=Math.sin(angle),bed=heightAt(x,z)-.002
    const lean=h*(.34+random()*.76),width=.0016+h*(.023+random()*.019)
    const twist=(random()-.5)*1.6,base=points.length/3
    tone.setHex(tint)
    const steps=near?[0,.55,1]:[0,.38,.73,1],widths=near?[.42,1,.018]:[.42,1,.65,.018]
    for(let row=0;row<steps.length;row++){
      const t=steps[row],turn=angle+twist*t,sx=-Math.sin(turn),sz=Math.cos(turn)
      const w=width*widths[row],y=bed+h*(t-.46*t*t*t),bend=lean*t*t
      for(let col=0;col<3;col++){
        const cross=(col-1)*w,fold=col===1?w*.46:0
        points.push(x+dx*(bend+fold)+sx*cross,y+fold,z+dz*(bend+fold)+sz*cross)
        const light=(.42+.60*t)*(col===1?1.10:col===2?.88:1.)
        colours.push(tone.r*light,tone.g*light,tone.b*light)
        bends.push(h*t*t*.25);phases.push(angle)
      }
      if(row){const a=base+(row-1)*3;indices.push(a,a+3,a+1,a+3,a+4,a+1,a+1,a+4,a+2,a+4,a+5,a+2)}
    }
  }
  for(let i=0;i<670;i++){
    const x=(random()-.5)*9.4,z=.40-random()*9.3
    const lane=Math.abs(x-.36*Math.sin(z*.77)),pocket=.51+.27*Math.sin(x*4.3-z*1.8)+.22*Math.cos(z*3.4+x)
    const shoulder=Math.exp(-Math.pow((lane-1.16)/.83,2))
    const radius=.045+.23*random(),grit=Math.floor((3+random()*21)*(.38+.72*pocket))
    for(let j=0;j<grit&&grainCount<grains.instanceMatrix.count;j++){
      const a=random()*2*Math.PI,r=radius*Math.sqrt(random()),gx=x+r*Math.cos(a),gz=z+.68*r*Math.sin(a)
      const size=.0034+.016*random()**2.3,depth=size*(.39+random()*.41)
      groundNormal.set(heightAt(gx-.014,gz)-heightAt(gx+.014,gz),.028,heightAt(gx,gz-.014)-heightAt(gx,gz+.014)).normalize()
      marker.position.set(gx,heightAt(gx,gz)-depth*.15,gz)
      marker.quaternion.setFromUnitVectors(up,groundNormal);marker.rotateY(random()*Math.PI*2)
      marker.scale.set(size*(.7+random()*.72),depth,size*(.53+random()*.45));marker.updateMatrix()
      grains.setMatrixAt(grainCount,marker.matrix)
      tone.setHex(grainColours[Math.floor(random()*grainColours.length)]).multiplyScalar(.70+.42*random())
      grains.setColorAt(grainCount++,tone)
    }
    if(random()>(.17+.79*shoulder)*pocket||lane<.46&&random()<.87)continue
    const height=.044+random()*.103,count=2+Math.floor(random()*7),orientation=random()*6.28
    for(let j=0;j<count;j++){
      const cx=x+(random()-.5)*radius*2,cz=z+(random()-.5)*radius,tint=seedlingColours[Math.floor(random()*seedlingColours.length)]
      for(let k=0,n=4+Math.floor(random()*6);k<n;k++)
        shoot(cx+(random()-.5)*.019,cz+(random()-.5)*.019,height*(.55+random()*.76),orientation+(random()-.5)*4.8,
          random()<.08?0x97804f:tint)
      tufts++
    }
  }
  // Low runners advance into the path in separate tongues, leaving warm earth between them.
  for(let i=0;i<590;i++){
    const z=-1.1-random()*10.4,centre=-.12+.46*Math.sin(z*.81),side=random()<.58?-1:1
    const shoulder=.37+.24*Math.sin(z*1.34+side)+random()*.82
    const x=centre+side*shoulder
    if(Math.sin(x*5.4+z*2.6)+.61*Math.cos(z*4.2-x)<-.31)continue
    const heading=random()*6.28,height=.038+.085*random(),tint=seedlingColours[i%seedlingColours.length]
    for(let j=0;j<6;j++)shoot(x+.031*(random()-.5),z+.034*(random()-.5),height*(.72+.65*random()),heading+2.5*(random()-.5),tint)
    tufts++
  }
  // Broken low mats on the two near banks: many fine blades, with small exposed
  // soil gaps between their roots. Keep the path crown and stone face readable.
  for(let patch=0;patch<110;patch++){
    const sign=patch%2?-1:1,z=-1.4-random()*5.1,x=sign*(.91+random()*1.95)
    if(x>1.05&&x<2.45&&z< -2.95&&z> -4.15)continue
    const radius=.10+.18*random(),direction=random()*6.28,tint=seedlingColours[patch%seedlingColours.length]
    for(let tuft=0;tuft<7;tuft++){
      const a=random()*6.28,r=radius*Math.sqrt(random()),px=x+r*Math.cos(a),pz=z+r*Math.sin(a)
      const h=.041+.072*random()
      for(let blade=0;blade<7;blade++)shoot(px+(random()-.5)*.016,pz+(random()-.5)*.016,
        h*(.58+.67*random()),direction+(random()-.5)*5.4,random()<.10?0x8e7b46:tint)
      tufts++
    }
  }
  for(const gap of leafGaps){
    for(let i=0;i<7;i++)shoot(gap.x+(random()-.5)*.012,gap.z+(random()-.5)*.012,
      .048+.073*random(),random()*6.28,seedlingColours[i%seedlingColours.length])
    tufts++
  }
  grains.count=grainCount;grains.computeBoundingSphere();grains.name='bamboo_verge_grit'
  const blades=new BufferGeometry()
  for(const [key,values,size] of [['position',points,3],['color',colours,3],['_bend',bends,1],['_phase',phases,1]] as const)
    blades.setAttribute(key,new Float32BufferAttribute(values,size))
  blades.setIndex(indices);blades.computeVertexNormals()
  const tissue=new MeshStandardMaterial({side:DoubleSide,roughness:.92,vertexColors:true})
  const grass=new Mesh(blades,tissue);grass.name='bamboo_verge_grass';grass.userData.wind=true
  root.add(grains,grass)
  root.userData.bambooVerge={grainCount,tufts}
  return ()=>{grains.dispose();grainGeometry.dispose();mineral.dispose();blades.dispose();tissue.dispose()}
}
