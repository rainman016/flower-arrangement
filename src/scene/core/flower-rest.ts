import { Box3, BufferAttribute, BufferGeometry, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { BOX, DESK, inBox } from '../../game/desk-layout'
import { stemPoint } from '../objects/BotanicalStem'
import { TABLE_BOUNDS } from '../../game/free-cut'

const up=new Vector3(0,1,0)
const geometryCache=new WeakMap<Object3D,{vertices:Float32Array;outline:Vector3[]}>()

function contactGeometry(model:Object3D){
  const cached=geometryCache.get(model)
  if(cached)return cached
  model.updateWorldMatrix(true,true)
  const inverse=model.matrixWorld.clone().invert(),point=new Vector3()
  const coords:number[]=[],bounds=new Box3()
  model.traverse(part=>{
    if(!(part instanceof Mesh)||!part.visible)return
    const matrix=new Matrix4().multiplyMatrices(inverse,part.matrixWorld)
    const attr=part.geometry.getAttribute('position')
    for(let i=0;i<attr.count;i++){
      point.fromBufferAttribute(attr,i).applyMatrix4(matrix)
      coords.push(point.x,point.y,point.z);bounds.expandByPoint(point)
    }
  })
  // Extremes along each section of the stem retain the outline of the leaves and crown.
  const directions=24
  const scores=Array(10*directions).fill(-Infinity),tips:Vector3[]=[]
  const axes=Array.from({length:directions},(_,i)=>[Math.cos(2*Math.PI*i/directions),Math.sin(2*Math.PI*i/directions)])
  for(let i=0;i<coords.length;i+=3){
    const [x,y,z]=[coords[i],coords[i+1],coords[i+2]]
    const band=Math.min(9,Math.floor((y-bounds.min.y)/Math.max(.001,bounds.max.y-bounds.min.y)*10))
    axes.forEach(([a,b],j)=>{const k=band*directions+j,d=x*a+z*b;if(d>scores[k]){scores[k]=d;tips[k]=new Vector3(x,y,z)}})
  }
  const data={vertices:new Float32Array(coords),outline:tips.filter(Boolean)}
  geometryCache.set(model,data);return data
}
export function surfaceHeight(x:number,z:number){
  if(!inBox(x,z))return DESK.top
  return inBox(x,z,.012)?BOX.base:BOX.rim
}
export function flowerOutline(model:Object3D):readonly Vector3[]{return contactGeometry(model).outline}
export function flowerShadowGeometry(model:Object3D){
  const geometry=new BufferGeometry(),indices:number[]=[]
  geometry.setAttribute('position',new BufferAttribute(contactGeometry(model).vertices,3))
  let offset=0
  model.traverse(part=>{
    if(!(part instanceof Mesh)||!part.visible)return
    const index=part.geometry.index,count=part.geometry.getAttribute('position').count
    for(let i=0;i<(index?.count??count);i++)indices.push(offset+(index?index.getX(i):i))
    offset+=count
  })
  geometry.setIndex(indices)
  return geometry
}
export function flowerSupport(model:Object3D,at:Vector3,q:Quaternion){
  const point=new Vector3()
  let y=-Infinity
  for(const p of contactGeometry(model).outline){
    point.copy(p).applyQuaternion(q)
    y=Math.max(y,surfaceHeight(at.x+point.x,at.z+point.z)-point.y)
  }
  return y+.00018
}
const sourcePlant=new WeakMap<Object3D,Object3D>()
type RestShape={preferred:Quaternion;settle:boolean;q:Quaternion;box:Box3;rotated:Float32Array;model:Object3D;owned:BufferGeometry[]}
const orientationCache=new WeakMap<Object3D,RestShape>()
export function releaseRestShape(model:Object3D){
  const shape=orientationCache.get(model)
  if(shape){shape.owned.forEach(g=>g.dispose());orientationCache.delete(model)}
}

// Let each side branch hinge at its node until its distal foliage meets the support.
function lowerBranch(part:Object3D,normal:Vector3){
  const points=contactGeometry(part).outline.map(p=>p.clone().multiply(part.scale).applyQuaternion(part.quaternion))
  const direction=new Vector3()
  for(const p of points)direction.addScaledVector(p,p.lengthSq())
  const axis=direction.cross(normal).normalize()
  if(axis.lengthSq()<.5||!points.length)return
  const extent=Math.max(...points.map(p=>p.lengthSq()))
  const tips=points.filter(p=>p.lengthSq()>.40*extent)
  const height=part.position.dot(normal),n=new Vector3()
  let best=Infinity,angle=0
  for(let i=-36;i<=36;i++){
    const tilt=i*Math.PI/90
    n.copy(normal).applyAxisAngle(axis,-tilt)
    let lowest=Infinity,tip=Infinity
    for(const p of points)lowest=Math.min(lowest,height+n.dot(p))
    for(const p of tips)tip=Math.min(tip,height+n.dot(p))
    const cost=45*Math.max(0,-lowest)+Math.max(0,tip)+.0014*Math.abs(tilt)
    if(cost<best){best=cost;angle=tilt}
  }
  part.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis,angle))
}
function restingShape(base:Object3D,q:Quaternion){
  const model=base.clone(true),stem=model.getObjectByName('part-stem')!,crown=model.getObjectByName('flower-crown')!
  const owned:BufferGeometry[]=[],normal=up.clone().applyQuaternion(q.clone().invert())
  const length=Number(stem.userData.extent),original=Number(stem.userData.originalLength)||length
  const cut=original-length,foot=stemPoint(cut,original)
  const crownBottom=Math.min(...contactGeometry(crown).outline.map(p=>normal.dot(p)))
  const neck=Math.max(.0012,.00015-crownBottom)
  // Support the shaft along its length, lifting the last section just enough for the intact corolla.
  const shift=(y:number)=>{
    const t=Math.max(0,Math.min(1,y/length)),u=Math.max(0,(t-.54)/.46)
    const center=stemPoint(cut+y,original).sub(foot)
    const height=.00125+.0008*Math.sin(t*Math.PI)+(neck-.00125)*u*u*(3-2*u)
    return height-center.dot(normal)
  }
  model.updateMatrixWorld(true)
  stem.traverse(o=>{
    if(!(o instanceof Mesh))return
    const geometry=o.geometry.clone(),vertices=geometry.getAttribute('position')
    const inverse=o.matrixWorld.clone().invert(),v=new Vector3()
    for(let i=0;i<vertices.count;i++){
      v.fromBufferAttribute(vertices,i).applyMatrix4(o.matrixWorld)
      v.addScaledVector(normal,shift(v.y)).applyMatrix4(inverse);vertices.setXYZ(i,v.x,v.y,v.z)
    }
    vertices.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    o.geometry=geometry;owned.push(geometry)
  })
  for(const part of model.children){
    if(part===stem)continue
    part.position.addScaledVector(normal,shift(part.position.y))
    if(part!==crown)lowerBranch(part,normal)
  }
  model.updateMatrixWorld(true);sourcePlant.set(model,base)
  return {model,owned}
}
function oriented(input:Object3D,preferred:Quaternion,settle:boolean){
  const model=sourcePlant.get(input)??input,last=orientationCache.get(model)
  if(last&&((last.settle===settle&&Math.abs(last.preferred.dot(preferred))>.9999999)||Math.abs(last.q.dot(preferred))>.9999999))return last
  const direction=up.clone().applyQuaternion(preferred)
  const heading=Math.hypot(direction.x,direction.z)>.22?Math.atan2(direction.x,direction.z):Math.PI
  const q=preferred.clone()
  if(settle||Math.abs(direction.y)>.26){
    const axis=new Vector3(Math.sin(heading),0,Math.cos(heading))
    const flat=new Quaternion().setFromUnitVectors(up,axis),roll=new Quaternion(),n=new Vector3()
    const outline=contactGeometry(model).outline
    const crown=model.getObjectByName('flower-crown')!,petals=contactGeometry(crown).outline
    let best=Infinity
    for(let i=0;i<72;i++){
      const rotation=roll.setFromAxisAngle(axis,i*Math.PI/36).multiply(flat)
      n.copy(up).applyQuaternion(rotation.clone().invert())
      let lowest=Infinity,head=Infinity
      for(const p of outline)lowest=Math.min(lowest,p.dot(n))
      for(const p of petals)head=Math.min(head,p.dot(n))
      const cost=-lowest+.45*Math.abs(head+crown.position.dot(n))+.0007*rotation.angleTo(preferred)
      if(cost<best){best=cost;q.copy(rotation)}
    }
  }
  releaseRestShape(model)
  const relaxed=restingShape(model,q),vertices=contactGeometry(relaxed.model).vertices
  const box=new Box3(),rotated=new Float32Array(vertices.length),point=new Vector3()
  for(let i=0;i<vertices.length;i+=3){
    point.fromArray(vertices,i).applyQuaternion(q);point.toArray(rotated,i);box.expandByPoint(point)
  }
  const result={preferred:preferred.clone(),settle,q,box,rotated,...relaxed}
  orientationCache.set(model,result);return result
}
/** Lower the visible geometry to its support. Picking handles never bear weight. */
export function restFlower(model:Object3D,at:Vector3,preferred:Quaternion,settle=true,anchor?:Vector3){
  const {q,box,rotated,model:rested}=oriented(model,preferred,settle)
  const offset=anchor?anchor.clone().applyQuaternion(q):new Vector3()
  const left=Math.max(TABLE_BOUNDS.left,DESK.left-box.min.x),right=Math.min(TABLE_BOUNDS.right,DESK.right-box.max.x)
  const back=Math.max(TABLE_BOUNDS.back,DESK.back-box.min.z),front=Math.min(TABLE_BOUNDS.front,DESK.front-box.max.z)
  const x=Math.max(left,Math.min(right,at.x-offset.x))
  const z=Math.max(back,Math.min(front,at.z-offset.z))
  let y=DESK.top-box.min.y
  const crossesBox=x+box.max.x>=-BOX.halfX&&x+box.min.x<=BOX.halfX&&z+box.max.z>=BOX.z-BOX.halfZ&&z+box.min.z<=BOX.z+BOX.halfZ
  if(crossesBox){
    for(let i=0;i<rotated.length;i+=3)y=Math.max(y,surfaceHeight(x+rotated[i],z+rotated[i+2])-rotated[i+1])
  }
  return {position:new Vector3(x,y+.00010,z),quaternion:q.clone(),model:rested}
}
