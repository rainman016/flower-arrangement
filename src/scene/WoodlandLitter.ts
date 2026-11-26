import {BufferGeometry,Color,DoubleSide,Float32BufferAttribute,Mesh,MeshStandardMaterial,Object3D,Vector3,type DataTexture} from 'three'
import type {HeightAt} from './terrain-height'
import type {SceneId} from '../game/types'

// Loose leaves gather in the lee of a root or stone. Each blade follows the
// sampled terrain at both ends; its fold is allowed to rise a few millimetres.
export function woodlandLitter(root:Object3D,ground:HeightAt,soil:DataTexture,id:SceneId){
  const pos:number[]=[],col:number[]=[],indices:number[]=[],film:number[]=[],skin:number[]=[]
  const rgb=new Color(),world=new Vector3(),scale=new Vector3()
  let seed={bamboo:62029,rain:8091,creek:9081}[id]
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const tone=id==='bamboo'?[0x89703a,0xb08f5a,0x705033,0x76623e,0x999050]:id==='creek'?[0x4b3d28,0x6a4e2c,0x5c422b,0x665138,0x80663f]:[0x635234,0x8a643b,0x775034,0x765b3a,0x967843]
  const water=id==='rain'?-.096:id==='creek'?-.132:-Infinity
  const data=soil.image.data as Uint8Array,resolution=soil.image.width
  const woodlandSamples=id==='creek'?9600:5700
  for(let i=0;i<woodlandSamples+(id==='bamboo'?1150:0);i++){
    const inDrift=i>=woodlandSamples
    let x=(random()-.5)*15,z=(id==='bamboo'?.30:-1.4)-random()*(id==='bamboo'?13.7:12)
    if(inDrift){
      // Dry culm leaves collect where the path starts to rise, and against its rock apron.
      z=-.90-7.40*random()
      x=-.12+.46*Math.sin(z*.81)+(random()<.5?-1:1)*(.40+1.30*random())
    }
    const bed=ground(x,z)
    if(bed<water+.018)continue
    const ix=Math.floor((x+16)*resolution/32),iz=Math.floor((z+29)*resolution/32)
    const local=(iz*resolution+ix)*4,core=data[local]/255,apron=data[local+1]/255
    const pocket=.50+.28*Math.sin(x*3.47+z*.89)+.22*Math.cos(z*4.68-x*.71)
    const margin=id==='bamboo'?.13*Math.exp(-Math.pow((Math.abs(x+.35*Math.sin(z)) -1.45)/1.15,2)):0
    if(core>.77||random()>(inDrift?.20:id==='creek'?.050:.020)+((id==='creek'?.30:.12)+margin)*pocket*pocket+apron*(1-core)*2.30)continue
    const number=1+Math.floor(random()*(apron>.17?9:4)*(1+margin*7)),direction=random()*Math.PI*2
    for(let j=0;j<number;j++){
      const sx=x+(random()-.5)*.13,sz=z+(random()-.5)*.10
      const angle=direction+(random()-.5)*3.8,cs=Math.cos(angle),sn=Math.sin(angle)
      const length=(inDrift?.065:.036)+random()*(id==='bamboo'?.108:.072),width=length*(id==='bamboo'?.08+random()*.08:.19+random()*.19)
      const curl=(random()-.32)*(id==='bamboo'?.032:.018),first=pos.length/3
      rgb.setHex(tone[Math.floor(random()*tone.length)]).multiplyScalar(id==='rain'?.76:1)
      for(const [along,side,h,light] of [[0,0,.0009,.49],[.23,-.57,.002,.73],[.32,.84,.004,.84],[.55,-.96,.002,1.04],
        [.51,.05,.008,1.12],[.60,.73,.002,.89],[.83,-.40,.002,.81],[1,0,.002,.65]]){
        const cross=side*width*.5+curl*along*along,vx=sx+length*cs*along-sn*cross,vz=sz+length*sn*along+cs*cross
        pos.push(vx,ground(vx,vz)+h+Math.max(0,curl)*along**3,vz);col.push(rgb.r*light,rgb.g*light,rgb.b*light)
        film.push(id==='rain'?.45:id==='creek'&&bed<.09?.56:.06)
        skin.push(along,side,first*.017%1)
      }
      for(const n of [0,1,2,1,3,4,1,4,2,2,4,5,3,6,4,4,6,5,5,6,7])indices.push(first+n)
    }
  }
  // Close drifts collect against a lip or a low bank. Some petioles are buried
  // while their opposite edges curl above the surface and cast a real shadow.
  const dripZ=root.getObjectByName('eave_drip_line')?.getWorldPosition(world).z??-3.05
  const pockets=id==='rain'?[
    [-2.28,dripZ-.07,.17,-.55],[-2.02,dripZ+.24,.18,1.16],[-1.75,-2.53,.21,.18],
    [-1.63,dripZ+.16,.50,1.35],[-1.03,-2.33,.46,.54],[.38,-2.03,.40,-.46],
    [1.44,-2.27,.54,-.36],[2.05,dripZ+.27,.45,-.57],[-2.82,-4.67,.59,.86],
    [-.96,-1.61,.30,1.72],[1.33,-1.52,.29,-.72],[2.58,-3.88,.56,.8]]:
    id==='bamboo'?[[-.95,-2.01,.47,-.8],[1.05,-2.60,.48,.66],[-.60,-3.68,.64,.32],
      [.87,-4.45,.46,-.40],[-1.39,-5.05,.63,.80],[1.39,-3.12,.36,-.70]]:
      [[-1.16,-.48,.32,-.36],[-1.86,-.98,.45,.61],[-2.23,-1.47,.36,-.53],
       [-1.53,-1.87,.43,.18],[-2.81,-2.63,.52,.33],[1.18,-.54,.31,-.35],
       [1.61,-1.43,.39,.25],[2.14,-2.41,.40,-.48],[-.95,-2.65,.70,.15],[.81,-2.65,.53,.34],[1.68,-2.96,.61,-.2],
        [-1.63,-3.22,.57,.30],[-2.17,-4.67,.59,.81],[2.34,-4.15,.42,-.28]]
  for(const [cx,cz,radius,heading] of pockets){
    const count=id==='creek'?Math.round(18+radius*31):radius<.24?8:radius<.35?15:24
    for(let leaf=0;leaf<count;leaf++){
      const azimuth=random()*Math.PI*2,r=radius*Math.sqrt(random()),x=cx+r*Math.cos(azimuth),z=cz+.56*r*Math.sin(azimuth)
      const bed=ground(x,z)
      if(bed<(id==='creek'?water+.021:water-.011))continue
      const wet=id==='rain'?Math.min(.96,.34+.56*Math.exp(-((z-dripZ)**2)/.18)+.25*Math.exp(-((bed+.02)**2)/.05)):
        id==='creek'?Math.max(.12,.91-2.7*Math.max(0,bed-water)):.10+.47*Math.exp(-((x-1.51)**2+(z+3.1)**2)/.31)
      const axis=heading+(random()-.5)*2.72,dx=Math.cos(axis),dz=Math.sin(axis)
      const length=(id==='bamboo'?.076:id==='rain'?.068:.069)+random()*.093,width=length*(id==='bamboo'?.071:.105+.101*random())
      const bend=(random()-.5)*width,twist=random()-.4,first=pos.length/3,age=random(),notch=2+Math.floor(random()*5)
      rgb.setHex(tone[Math.floor(random()*tone.length)]).multiplyScalar(.74+.43*random())
      for(let row=0;row<=9;row++){
        const t=row/9,span=Math.sin(Math.PI*t)**(.71+.37*age),acrossBend=bend*t*t
        for(let flank=-1;flank<=1;flank++){
          const eroded=row===notch&&flank===1?1.-.38*age:1.-.11*Math.sin(row*3.7+age*13.+flank)
          const side=flank*width*span*(flank<0?.83:1.13)*eroded+acrossBend
          const px=x+dx*t*length-dz*side,pz=z+dz*t*length+dx*side
          const overlap=.0008+(leaf%5)*(id==='creek'?.00135:.00065)
          const lip=.018*(1.-.72*wet)*t*t*(.55+Math.abs(twist))+.011*span*Math.max(0,flank*twist)
          const midrib=flank===0?.0045*span:0
          pos.push(px,ground(px,pz)+overlap+lip+midrib-.0065*(1.-t)**4,pz)
          const light=(.75+.25*t)*(flank===0?1.18:flank<0?.79:.98)*(.94+.06*Math.cos(17*t))
          col.push(rgb.r*light,rgb.g*light,rgb.b*light)
          film.push(wet*(1.-.33*t))
          skin.push(t,flank,age)
        }
        if(row){const a=first+row*3;indices.push(a-3,a-2,a,a-2,a+1,a,a-2,a-1,a+1,a-1,a+2,a+1)}
      }
    }
  }
  if(id==='rain'){
    const broadDrift=root.getObjectByName('wet_shore_leaf_litter')
    if(broadDrift) broadDrift.visible=false
  }
  if(id==='bamboo'){
    // Partially split basal sheaths. The lower edge disappears into the bank;
    // the upper edge tears along the axis of its own culm.
    root.traverse(o=>{
      const kind=String(o.userData.prototype??'')
      if(!kind.startsWith('grove_'))return
      o.getWorldPosition(world);o.getWorldScale(scale)
      if(Math.abs(world.x)>5||world.z>-.9||world.z< -9.3)return
      const radius=[.056,.076,.045][Number(kind.slice(-1))]??.06
      const start=random()*Math.PI*2,span=1.2+random()*2.9,base=ground(world.x,world.z)
      const height=(.09+random()*.15)*Math.min(1.4,scale.y),first=pos.length/3
      rgb.setHex(random()<.6?0x806331:0x6b5731)
      for(let k=0;k<=9;k++){
        const t=k/9,angle=start+t*span,edge=.33+.65*Math.sin(t*Math.PI)**.62,tear=.75+.25*random()
        for(let row=0;row<3;row++){
          const fraction=row*.5,r=radius*(1.07+.10*(1-fraction)+.018*Math.sin(angle*5))
          const p=new Vector3(r*Math.cos(angle),(base-world.y+height*fraction*edge*tear)/scale.y,r*Math.sin(angle)).applyMatrix4(o.matrixWorld)
          const floor=ground(p.x,p.z)
          pos.push(p.x,row===0?floor-.012:Math.max(floor+.001,p.y),p.z)
          const light=(.72+.15*row)*(.82+.18*Math.cos(3*t))
          col.push(rgb.r*light,rgb.g*light,rgb.b*light)
        }
        if(k)for(let row=0;row<2;row++){const s=first+(k-1)*3+row;indices.push(s,s+3,s+1,s+1,s+3,s+4)}
      }
    })
  }
  const geom=new BufferGeometry()
  while(film.length<pos.length/3)film.push(.08)
  while(skin.length<pos.length)skin.push(0,0,-1)
  geom.setAttribute('_leafFilm',new Float32BufferAttribute(film,1))
  geom.setAttribute('_litterCoord',new Float32BufferAttribute(skin,3))
  geom.setAttribute('position',new Float32BufferAttribute(pos,3));geom.setAttribute('color',new Float32BufferAttribute(col,3));geom.setIndex(indices);geom.computeVertexNormals()
  const mat=new MeshStandardMaterial({vertexColors:true,roughness:id==='rain'?.74:.93,side:DoubleSide})
  const mesh=new Mesh(geom,mat);mesh.name='root_pocket_litter';root.add(mesh)
  if(id==='creek')mesh.userData.liveCreekBank=true
  return ()=>{geom.dispose();mat.dispose()}
}
