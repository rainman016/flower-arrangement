import {readFileSync} from 'node:fs'
import {beforeAll,describe,expect,it,vi} from 'vitest'
import {Box3,Euler,LineLoop,Mesh,PerspectiveCamera,Quaternion,Raycaster,Texture,Vector3,type Group,type Object3D} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {flowerOutline,surfaceHeight,restFlower} from '../../src/scene/core/flower-rest'
import {DESK} from '../../src/game/desk-layout'
import {CUP_FLOWERS,FLOWERS} from '../../src/content/catalog'
import type {FlowerKind,FlowerState} from '../../src/game/types'
import {createPiece,createPlant,disposeGeometry} from '../../src/scene/core/botanical-geometry'
import {ritualHistory} from '../../src/services/ritual-progress'
import {coreFlowerPose} from '../../src/scene/core/core-transforms'
import {deskView,localBounds} from '../../src/scene/core/desk-space'
import {CupLiquid,GLASS_LIP,radiusAt} from '../../src/scene/core/tumbler'

let kit:Group
beforeAll(async()=>{
  const manifest=JSON.parse(readFileSync('public/assets/manifest.json','utf8'))
  const path=manifest.assets.find((a:{id:string})=>a.id==='prop-kit').file
  const bytes=readFileSync('public/'+path)
  const loader=new GLTFLoader().register(()=>({name:'no-image-decode',loadTexture:()=>Promise.resolve(new Texture())}))
  kit=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
})
function details(part:Object3D){
  const result:string[]=[]
  for(const child of part.children.slice(1)){
    const at=child.position.toArray().map(n=>n.toFixed(5)).join(',')
    let vertices=0
    child.traverse(o=>{if(o instanceof Mesh)vertices+=o.geometry.attributes.position.count})
    result.push(at+'/'+vertices)
  }
  return result.sort()
}
it('备席三枝在杯口内错开，浸水部分留在杯壁内',()=>{
  const work=ritualHistory().present,cup=new Vector3(...work.tools!.cup)
  const tops:number[]=[],centres:Vector3[]=[]
  for(const f of work.flowers){
    const model=createPlant(kit,f),pose=coreFlowerPose(f,work,false)
    model.position.copy(pose.position).sub(cup);model.quaternion.copy(pose.quaternion);model.updateMatrixWorld(true)
    const crown=model.getObjectByName('flower-crown')!.children[0],box=new Box3().setFromObject(crown)
    tops.push(box.max.y);centres.push(box.getCenter(new Vector3()))
    let maxExcess=-Infinity
    model.traverse(o=>{
      if(!(o instanceof Mesh))return
      const attr=o.geometry.getAttribute('position'),point=new Vector3()
      for(let i=0;i<attr.count;i++){
        point.fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld)
        if(point.y<GLASS_LIP.brim&&point.y>GLASS_LIP.floor){
          const inner=radiusAt(point.y)
          maxExcess=Math.max(maxExcess,Math.hypot(point.x,point.z)-inner)
        }
      }
    })
    expect(maxExcess,f.kind+' cup wall').toBeLessThan(.0005)
    expect(model.position.y-GLASS_LIP.floor).toBeGreaterThan(0)
    expect(model.position.y-GLASS_LIP.floor).toBeLessThan(.002)
    disposeGeometry(model)
  }
  expect(tops[1]-tops[0]).toBeGreaterThan(.024)
  expect(tops[2]-tops[1]).toBeGreaterThan(.045)
  expect(centres[1].x).toBeLessThan(-GLASS_LIP.radius)
  expect(centres[2].x).toBeGreaterThan(centres[0].x+.025)
})
it('实际备席相机中，七处花冠和穗尖跟随檐雨原图的杯口相对坐标',()=>{
  const work=ritualHistory().present,cup=new Vector3(...work.tools!.cup)
  const view=deskView(1000,590),camera=new PerspectiveCamera(view.fov,1000/590,.01,30)
  camera.position.copy(view.eye);camera.rotation.x=view.pitch;camera.updateMatrixWorld()
  const pixel=(v:Vector3)=>{const p=v.clone().project(camera);return [(1+p.x)*500,(1-p.y)*295]}
  const rim=pixel(cup.clone().add(new Vector3(0,GLASS_LIP.height,0)))
  const width=2*(pixel(cup.clone().add(new Vector3(GLASS_LIP.outerRadius,GLASS_LIP.height,0)))[0]-rim[0])
  // 02-rain.png, 1672 × 941. Rim centre (490,522), outer width 146 px.
  function check(part:Object3D,target:number[],tip=false){
    let screen=pixel(new Box3().setFromObject(part).getCenter(new Vector3()))
    if(tip)part.traverse(o=>{
      if(!(o instanceof Mesh))return
      const points=o.geometry.attributes.position,vertex=new Vector3()
      for(let i=0;i<points.count;i++){
        const p=pixel(vertex.fromBufferAttribute(points,i).applyMatrix4(o.matrixWorld))
        if(p[1]<screen[1])screen=p
      }
    })
    for(let axis=0;axis<2;axis++){
      const reference=(target[axis]-[490,522][axis])/146
      expect(Math.abs((screen[axis]-rim[axis])/width-reference)).toBeLessThan(.10)
    }
  }
  for(const flower of work.flowers){
    const model=createPlant(kit,flower),pose=coreFlowerPose(flower,work,false)
    model.position.copy(pose.position);model.quaternion.copy(pose.quaternion);model.updateMatrixWorld(true)
    const crown=model.getObjectByName('flower-crown')!,side=model.getObjectByName('part-branch-0')!.children.at(-1)!
    if(flower.kind==='yellow'){check(crown.children[0],[498,371]);check(side,[453,409])}
    if(flower.kind==='white'){check(crown.children[0],[354,339]);check(model.getObjectByName('part-crown-branch')!.children.at(-1)!,[395,347]);check(side,[433,454])}
    if(flower.kind==='grass'){check(crown.children[0],[594,208],true);check(side,[473,175],true)}
    disposeGeometry(model)
  }
})
it('180 毫升接近半杯，倾杯及翻转时水线水平且位于内腔',()=>{
  const liquid=new CupLiquid(),edge=liquid.getObjectByName('water-meniscus') as LineLoop
  for(const angle of [0,.01,1.15,Math.PI/2,2.3,Math.PI]){
    const rotation=new Quaternion().setFromEuler(new Euler(0,0,angle))
    let previous=Infinity
    for(const amount of [180,75,2]){
      liquid.updateLevel(rotation,amount)
      const vertex=edge.geometry.getAttribute('position'),heights:number[]=[]
      for(let i=0;i<edge.geometry.drawRange.count;i++){
        const p=new Vector3().fromBufferAttribute(vertex,i)
        expect(p.y).toBeGreaterThan(GLASS_LIP.floor-.0001);expect(p.y).toBeLessThan(GLASS_LIP.brim+.0001)
        heights.push(p.applyQuaternion(rotation).y)
      }
      expect(heights.length).toBeGreaterThan(3)
      expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(.00001)
      expect(heights[0]).toBeLessThan(previous)
      if(!angle&&amount===180){
        const y=heights[0],r0=radiusAt(GLASS_LIP.floor),r=radiusAt(y)
        expect(Math.PI*(y-GLASS_LIP.floor)*(r0*r0+r0*r+r*r)*1e6/3).toBeCloseTo(180,1)
        expect((GLASS_LIP.height-y)/GLASS_LIP.height).toBeCloseTo(.39,1)
      }
      previous=heights[0]
    }
  }
  liquid.updateLevel(new Quaternion(),0);expect(liquid.visible).toBe(false);liquid.dispose()
})
it.each(['catalog','cup'] as const)('%s 四类花材的剪口、主茎中段与真正花冠均获得支撑，恢复摆位保持朝向',sample=>{
  for(const [slot,kind] of (['yellow','white','grass','daisy'] as const).entries()){
    const length=sample==='catalog'?FLOWERS[kind].length:CUP_FLOWERS[kind].length
    const f:FlowerState={id:'flower',kind,slot,location:'table',length,removed:[],pose:{x:0,z:0,tilt:0,depth:.1,yaw:0}}
    const model=createPlant(kit,f)
    const heading=new Quaternion().setFromEuler(new Euler(-Math.PI/2,0,-.22+slot*.12))
    const pose=restFlower(model,new Vector3(-.40,0,.23),heading)
    const saved=restFlower(model,pose.position,pose.quaternion,false)
    expect(saved.quaternion.angleTo(pose.quaternion)).toBeLessThan(.00001)
    const point=new Vector3(),placed=new Vector3()
    const basePoint=new Vector3(),midPoint=new Vector3(),headPoint=new Vector3()
    let base=Infinity,middle=Infinity,head=Infinity
    pose.model.updateWorldMatrix(true,true)
    for(const part of pose.model.children)part.traverse(o=>{
      if(!(o instanceof Mesh))return
      const attr=o.geometry.getAttribute('position')
      for(let i=0;i<attr.count;i++){
        point.fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld)
        placed.copy(point).applyQuaternion(pose.quaternion).add(pose.position)
        if(part.name==='part-stem'&&point.y<.05*f.length&&placed.y-DESK.top<base){base=placed.y-DESK.top;basePoint.copy(placed)}
        if(part.name==='part-stem'&&point.y>.40*f.length&&point.y<.56*f.length&&placed.y-DESK.top<middle){middle=placed.y-DESK.top;midPoint.copy(placed)}
        if(part.name==='flower-crown'&&placed.y-DESK.top<head){head=placed.y-DESK.top;headPoint.copy(placed)}
      }
    })
    const table=kit.getObjectByName('wood_table_root')!.clone(true)
    table.position.set(0,0,0);table.quaternion.identity();table.updateMatrixWorld(true)
    const down=new Vector3(0,-1,0)
    for(const p of [basePoint,midPoint,headPoint]){
      const hit=new Raycaster(p.clone().addScaledVector(down,-.10),down).intersectObject(table,true)[0]
      expect(hit).toBeDefined()
      const gap=p.y-hit.point.y
      expect(gap,kind+' wood surface').toBeGreaterThanOrEqual(0)
      expect(gap,kind+' wood surface').toBeLessThan(.0025)
    }
    disposeGeometry(model)
  }
})
it('草叶切片保留每个顶点的颜色',()=>{
  const f:FlowerState={id:'grass',kind:'grass',slot:2,location:'table',length:FLOWERS.grass.length,removed:[],pose:{x:0,z:0,tilt:0,depth:.1,yaw:0}}
  const plant=createPlant(kit,f),piece=createPiece(kit,f,'leaf-0',0,1)
  for(const leaf of [plant.getObjectByName('part-leaf-0')!,piece]){
    let colored=0
    leaf.traverse(o=>{
      if(!(o instanceof Mesh)||!o.material.vertexColors)return
      const {position,color}=o.geometry.attributes
      expect(color?.count).toBe(position.count)
      colored++
    })
    expect(colored).toBeGreaterThan(0)
  }
  disposeGeometry(plant);disposeGeometry(piece)
})
describe('侧枝的两次剪切',()=>{
  for(const kind of ['yellow','white','grass'] as FlowerKind[])it(kind+' 的装饰恰好进入一个保留段或碎屑',()=>{
    const f:FlowerState={id:'f-1',kind,slot:1,location:'table',length:FLOWERS[kind].length,removed:[],pose:{x:0,z:0,tilt:0,depth:.1,yaw:0}}
    const plant=createPlant(kit,f)
    const initial=details(plant.getObjectByName('part-branch-0')!)
    const first=createPiece(kit,f,'branch-0',.68,1)
    const second=createPiece(kit,{...f,sections:{'branch-0':.68}},'branch-0',.29,.68)
    const rest=createPlant(kit,{...f,sections:{'branch-0':.29}})
    const after=[...details(first.children[0]),...details(second.children[0]),...details(rest.getObjectByName('part-branch-0')!)].sort()
    expect(after).toEqual(initial)
    expect(initial.length).toBeGreaterThan(2)
    for(const root of [plant,first,second,rest])disposeGeometry(root)
  })
})

it('修剪近景横竖屏的长短花材均悬在桌面上方',()=>{
  const work=ritualHistory().present,point=new Vector3()
  try{
    for(const [width,height] of [[1182,676],[390,844]]){
      vi.stubGlobal('window',{innerWidth:width,innerHeight:height})
      for(const f of work.flowers)for(const length of [.14,.42]){
        const flower={...f,length,stockLength:length,headScale:1.4}
        const model=createPlant(kit,flower),outline=flowerOutline(model)
        const frame={bounds:localBounds(model),outline,editing:true,overDesk:true}
        for(const tilt of [0,.72,1.47]){
          const turn=new Quaternion().setFromEuler(new Euler(.18,-.2,tilt))
          const pose=coreFlowerPose(flower,work,true,turn.toArray(),0,frame)
          let clearance=Infinity
          for(const local of outline){
            point.copy(local).applyQuaternion(turn).add(pose.position)
            clearance=Math.min(clearance,point.y-surfaceHeight(point.x,point.z))
          }
          expect(clearance,JSON.stringify({width,kind:f.kind,length,tilt})).toBeGreaterThanOrEqual(.02499)
        }
        disposeGeometry(model)
      }
    }
  }finally{vi.unstubAllGlobals()}
})

it('细穗按小枝中段分开，保留相邻小枝，落下段与保留段在同一平面相接',()=>{
  const stem=ritualHistory().present.flowers.find(f=>f.kind==='grass')!
  const target='side-panicle-twig-8',at=.54
  const original=createPlant(kit,stem)
  const before=original.getObjectByName('part-'+target)!
  const kept=createPlant(kit,{...stem,sections:{[target]:at}})
  const fallen=createPiece(kit,stem,target,at,1)
  const still=kept.getObjectByName('part-'+target)!,piece=fallen.getObjectByName('part-'+target)!
  expect(localBounds(still).max.y).toBeCloseTo(at*before.userData.extent,6)
  expect(localBounds(piece).min.y).toBeCloseTo(at*before.userData.extent,6)
  expect(localBounds(piece).max.y).toBeCloseTo(localBounds(before).max.y,6)
  expect(kept.getObjectByName('part-side-panicle-twig-9')).toBeDefined()
  expect(fallen.getObjectByName('part-side-panicle-twig-9')).toBeUndefined()
  for(const item of [original,kept,fallen])disposeGeometry(item)
})
