import { Camera, Matrix4, Mesh, Object3D, Raycaster, Vector2, Vector3, type Intersection } from 'three'
import type { FlowerState } from '../../game/types'
import type { CoreWorld } from './CoreCanvas'

function rendered(hit:Intersection){
  const object=hit.object
  if(!(object instanceof Mesh))return false
  const material=Array.isArray(object.material)?object.material[hit.face?.materialIndex??0]:object.material
  if(!material?.visible||material.opacity===0)return false
  for(let node:Object3D|null=object;node;node=node.parent)if(!node.visible)return false
  return true
}

// When a whole flower is selectable, measure the miss distance in CSS pixels.
// The cut tool retains its independent, precise section picker.
export function createLooseFlowerPicker(world:CoreWorld,camera:Camera,canvas:HTMLCanvasElement,flowers:()=>FlowerState[]){
  const ray=new Raycaster(),sight=new Raycaster(),ndc=new Vector2()
  const vertex=new Vector3(),screen=new Vector3(),center=new Vector3(),clip=new Matrix4()
  type Hit={id:string;point:Vector3}
  return (event:PointerEvent):Hit|undefined=>{
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top
    const radius=event.pointerType==='touch'?22:15
    ndc.set(2*x/rect.width-1,1-2*y/rect.height)
    ray.setFromCamera(ndc,camera)
    const stems=new Map<Object3D,string>()
    const obstacles=[world.table,world.tray,world.vase,world.scissors,world.cup,...world.pieces.values()].filter((o):o is Object3D=>!!o)
    for(const flower of flowers()){
      const root=world.flowers.get(flower.id)
      if(!root?.visible)continue
      // Switching from the resting plant to its flexible close-up replaces the
      // primitive. Its sibling order relative to the invisible handle can change.
      const model=root.getObjectByName('botanical-'+flower.id)
      if(!model?.visible)continue
      model.updateWorldMatrix(true,true)
      if(flower.location==='vase')obstacles.push(model)
      else stems.set(model,flower.id)
    }
    const hit=ray.intersectObjects([...stems.keys(),...obstacles],true).find(rendered)
    if(hit){
      for(let node:Object3D|null=hit.object;node;node=node.parent){
        const id=stems.get(node)
        if(id)return {id,point:hit.point}
        if(node===world.table||node===world.tray)break
        if(obstacles.includes(node))return
      }
    }

    let best=radius*radius,nearest=Infinity,result:Hit|undefined
    const pixelScale=2/(camera.projectionMatrix.elements[5]*rect.height)
    for(const [model,id] of stems){
      model.traverseVisible(object=>{
        if(!(object instanceof Mesh))return
        const geometry=object.geometry,position=geometry.attributes.position
        if(!position||geometry.drawRange.count===0)return
        if(!geometry.boundingSphere)geometry.computeBoundingSphere()
        const sphere=geometry.boundingSphere
        center.copy(sphere.center).applyMatrix4(object.matrixWorld)
        const reach=sphere.radius*object.matrixWorld.getMaxScaleOnAxis()+radius*pixelScale*center.distanceTo(ray.ray.origin)
        if(ray.ray.distanceSqToPoint(center)>reach*reach)return
        const index=geometry.index,start=geometry.drawRange.start
        const end=Math.min(index?.count??position.count,start+geometry.drawRange.count)
        const stride=Math.max(1,Math.floor((end-start)/180))
        clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(object.matrixWorld)
        for(let i=start;i<end;i+=stride){
          vertex.fromBufferAttribute(position,index?index.getX(i):i)
          screen.copy(vertex).applyMatrix4(clip)
          if(screen.z< -1||screen.z>1)continue
          const dx=(1+screen.x)*rect.width/2-x,dy=(1-screen.y)*rect.height/2-y
          const gap=dx*dx+dy*dy
          if(gap>best)continue
          vertex.applyMatrix4(object.matrixWorld)
          const depth=vertex.distanceTo(ray.ray.origin)
          if(gap===best&&depth>=nearest)continue
          sight.ray.origin.copy(ray.ray.origin)
          sight.ray.direction.copy(vertex).sub(sight.ray.origin).normalize()
          sight.far=depth-.001
          if(sight.intersectObjects(obstacles,true).some(rendered))continue
          best=gap;nearest=depth;result={id,point:vertex.clone()}
        }
      })
    }
    return result
  }
}
