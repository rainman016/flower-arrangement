import {mkdir} from 'node:fs/promises'
import {readFile,writeFile} from 'node:fs/promises'
import {expect,it} from 'vitest'
import {Euler,Mesh,PerspectiveCamera,Raycaster,Texture,Triangle,Vector2,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {terrainSampler} from '../../src/scene/terrain-height'
import {continueBambooGround} from '../../src/scene/BambooDepth'
import {shapeWoodlandGround} from '../../src/scene/WoodlandGroundShape'
import {detailForestFloor} from '../../src/scene/ForestFloor'
import {bambooBanks} from '../../src/scene/BambooBanks'
import {deskView} from '../../src/scene/core/desk-space'

it('projects authored bank regions onto the real ground, buries roots and keeps the centre soil strip',async()=>{
  const catalog=JSON.parse(await readFile('public/assets/manifest.json','utf8'))
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'cpu-geometry',loadTexture:()=>Promise.resolve(new Texture())}))
  async function model(id:string){
    const bytes=await readFile('public/'+catalog.assets.find((a:{id:string})=>a.id===id).file)
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
  }
  const begin=performance.now(),root=await model('environment-bamboo'),kit=await model('nature-kit'),loaded=performance.now()
  root.updateMatrixWorld(true);kit.updateMatrixWorld(true)
  const terrain=root.getObjectByName('terrain') as Mesh,original=terrainSampler(terrain)
  const filled=continueBambooGround(root,terrain,original),shaped=shapeWoodlandGround(root,terrain,filled.at,filled.at,'bamboo')
  const groundReady=performance.now(),floor=detailForestFloor(root,kit,shaped.at,'bamboo'),floorReady=performance.now(),banks=bambooBanks(root,shaped.at),banksReady=performance.now()
  const timingMs={load:loaded-begin,ground:groundReady-loaded,floor:floorReady-groundReady,banks:banksReady-floorReady}
  console.log({timingMs,anchors:banks.report.anchors,blades:banks.report.blades,fronds:banks.report.fronds,burial:banks.report.burial})
  expect(banks.report.anchors).toBeGreaterThan(100)
  expect(banks.report.blades).toBeGreaterThan(3000)
  expect(banks.report.blades).toBeLessThan(15000)
  expect(banks.report.fronds).toBeGreaterThan(80)
  expect(banks.report.understoryLeaves).toBeGreaterThan(250)
  expect(banks.report.understorySites.length).toBeGreaterThan(10)
  expect(banks.report.triangles).toBeLessThan(60000)
  expect(banks.report.meshes.filter(m=>m.name.includes('grass')).reduce((sum,m)=>sum+m.triangles,0)).toBe(banks.report.blades*2)
  expect(banks.report.meshes.every(m=>m.triangles>0)).toBe(true)
  expect(banks.report.patchDiameter.min).toBeGreaterThanOrEqual(.2)
  expect(banks.report.patchDiameter.max).toBeLessThanOrEqual(.7)
  expect(banks.report.foregroundBladeHeight.p95).toBeLessThan(.065)
  expect(banks.report.foregroundBladeHeight.median).toBeLessThan(banks.report.bladeHeight.median)
  expect(banks.report.minimumDeskClearance).toBeGreaterThan(.13)
  expect(banks.report.burial.samples).toBeGreaterThan(150)
  expect(banks.report.burial.min).toBeGreaterThan(-.018)
  expect(banks.report.burial.max).toBeLessThan(.002)
  expect(banks.report.burial.mean).toBeLessThan(-.003)
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80)
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  const ray=new Raycaster(),surfaces=[terrain,root.getObjectByName('root_bank_soil') as Mesh],v=new Vector3()
  const measured:Record<string,number>={}
  const samplePositions:Record<string,number[]>={}
  for(const [name,x,y] of [['left',.20,.43],['right',.75,.43],['path',.49,.41]] as const){
    ray.setFromCamera(new Vector2(x*2-1,1-y*2),camera)
    const hit=ray.intersectObjects(surfaces,false)[0],mesh=hit.object as Mesh,face=hit.face!,p=mesh.geometry.attributes.position
    samplePositions[name]=hit.point.toArray()
    const bary=new Triangle(new Vector3().fromBufferAttribute(p,face.a),new Vector3().fromBufferAttribute(p,face.b),new Vector3().fromBufferAttribute(p,face.c))
      .getBarycoord(mesh.worldToLocal(hit.point.clone()),v)!
    const cover=mesh.geometry.attributes._bambooBankCover
    measured[name]=bary.x*cover.getX(face.a)+bary.y*cover.getX(face.b)+bary.z*cover.getX(face.c)
  }
  expect(measured.left).toBeGreaterThan(.9);expect(measured.right).toBeGreaterThan(.9);expect(measured.path).toBeLessThan(.02)
  await mkdir('test-results',{recursive:true})
  await writeFile('test-results/bamboo-bank-planting-check.json',JSON.stringify({...banks.report,timingMs,groundCoverAtScreenSamples:measured,groundWorldAtScreenSamples:samplePositions},null,2)+'\n')
  banks.dispose();floor.dispose();shaped.dispose();filled.dispose()
},15000)
