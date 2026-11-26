import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {expect,it} from 'vitest'
import {DataUtils,Mesh,PerspectiveCamera,Raycaster,ShaderLib,Texture,Vector2,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {terrainSampler} from '../../src/scene/terrain-height'
import {bambooMiddleGrove,continueBambooGround} from '../../src/scene/BambooDepth'
import {shapeWoodlandGround} from '../../src/scene/WoodlandGroundShape'
import {detailForestFloor} from '../../src/scene/ForestFloor'
import {bambooSunEnvelope,bambooSunlight,bambooSunResponse,bambooSunSampling,bambooWindowLayout,bambooWindowOpticalDepth} from '../../src/scene/BambooSunlight'
import {bambooCanopy} from '../../src/scene/BambooCanopy'
import {bambooLeafProjection} from './helpers/bamboo-leaf-projection'
import {woodlandSky} from '../../src/scene/WoodlandSky'

it('places attached golden leaf sprays and three separated sun patches on real bamboo geometry',async()=>{
  const catalog=JSON.parse(await readFile('public/assets/manifest.json','utf8'))
  const capture=JSON.parse(await readFile('tests/game/fixtures/seated-camera.json','utf8')).shots.find((s:{id:string})=>s.id==='bamboo')
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'cpu-geometry',loadTexture:()=>Promise.resolve(new Texture())}))
  async function model(id:string){
    const bytes=await readFile('public/'+catalog.assets.find((a:{id:string})=>a.id===id).file)
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
  }
  const root=await model('environment-bamboo'),kit=await model('nature-kit')
  root.updateMatrixWorld(true);kit.updateMatrixWorld(true)
  const terrain=root.getObjectByName('terrain') as Mesh,filled=continueBambooGround(root,terrain,terrainSampler(terrain))
  const shaped=shapeWoodlandGround(root,terrain,filled.at,filled.at,'bamboo'),floor=detailForestFloor(root,kit,shaped.at,'bamboo')
  const layout=bambooSunlight(shaped.at),camera=new PerspectiveCamera(capture.fov,capture.aspect,.01,80)
  camera.position.fromArray(capture.eye);camera.quaternion.fromArray(capture.rotation);camera.updateMatrixWorld(true)
  const ray=new Raycaster(),surfaces=[terrain,root.getObjectByName('root_bank_soil') as Mesh],uv=new Vector2()
  const trail=layout.trail.map(p=>{
    const world=new Vector3().fromArray(p.world),screen=world.clone().project(camera)
    ray.setFromCamera(uv.set(p.screen[0]*2-1,1-p.screen[1]*2),camera)
    const hit=ray.intersectObjects(surfaces,false)[0]
    const error=world.distanceTo(hit.point),screenError=Math.hypot((screen.x*.5+.5-p.screen[0])*1536,(.5-screen.y*.5-p.screen[1])*1024)
    expect(error).toBeLessThan(.025);expect(screenError).toBeLessThan(.2)
    expect(bambooSunEnvelope(layout,world)).toBeCloseTo(1,5)
    return {screen:p.screen,world:p.world,projectedSunPlane:p.patch.toArray(),actualGroundError:error,screenErrorPixels:screenError}
  })
  const gaps=[[0,1],[1,2]].map(([a,b])=>{
    const midpoint=new Vector3().fromArray(layout.trail[a].world).lerp(new Vector3().fromArray(layout.trail[b].world),.5)
    const energy=bambooSunEnvelope(layout,midpoint);expect(energy).toBeLessThan(.24);return energy
  })
  const tableEnvelope=bambooSunEnvelope(layout,new Vector3(0,.758,0));expect(tableEnvelope).toBeLessThan(.001)
  const outsideEnvelope=bambooSunEnvelope(layout,new Vector3(2,.25,-2));expect(outsideEnvelope).toBeLessThan(.02)
  bambooMiddleGrove(root,shaped.at)
  const releaseCanopy=bambooCanopy(root,shaped.at),sprays=root.userData.bambooBacklitLeaves as {
    attachments:{surfaceDistance:number;reach:number}[];triangles:number;leaves:number
  }
  root.updateMatrixWorld(true)
  const mesh=root.getObjectByName('bamboo_sunlit_spray_leaves') as Mesh,p=mesh.geometry.attributes.position
  const lengths:number[]=[],nearLengths:number[]=[],nearWidths:number[]=[],centers:number[][]=[]
  for(let i=0;i<p.count;i+=5){
    const base=new Vector3().fromBufferAttribute(p,i).project(camera),tip=new Vector3().fromBufferAttribute(p,i+4).project(camera)
    lengths.push(Math.hypot((tip.x-base.x)*768,(tip.y-base.y)*512))
    if(i<10*63*5){
      nearLengths.push(lengths[lengths.length-1])
      const left=new Vector3().fromBufferAttribute(p,i+1).project(camera),right=new Vector3().fromBufferAttribute(p,i+3).project(camera)
      nearWidths.push(Math.hypot((right.x-left.x)*768,(right.y-left.y)*512))
    }
    centers.push([.5+(base.x+tip.x)*.25,.5-(base.y+tip.y)*.25])
  }
  lengths.sort((a,b)=>a-b)
  const visibleLeafFraction=centers.filter(([x,y])=>x>=0&&x<640/1536&&y>=0&&y<235/1024).length/centers.length
  nearLengths.sort((a,b)=>a-b);nearWidths.sort((a,b)=>a-b)
  const leafPixels={median:lengths[Math.floor(lengths.length*.5)],p90:lengths[Math.floor(lengths.length*.9)],nearMedian:nearLengths[Math.floor(nearLengths.length*.5)],
    nearWidthMedian:nearWidths[Math.floor(nearWidths.length*.5)],nearWidthP90:nearWidths[Math.floor(nearWidths.length*.9)]}
  expect(sprays.attachments.length).toBe(28);expect(sprays.triangles).toBeLessThan(12000)
  expect(Math.max(...sprays.attachments.map(a=>a.surfaceDistance))).toBeLessThan(.12)
  expect(Math.max(...sprays.attachments.map(a=>a.reach))).toBeLessThan(2)
  expect(visibleLeafFraction).toBeGreaterThan(.75);expect(leafPixels.nearMedian).toBeGreaterThan(12)
  expect(leafPixels.nearWidthMedian).toBeGreaterThan(2);expect(leafPixels.nearWidthP90).toBeLessThan(8)
  const projection=bambooLeafProjection(root,camera)
  expect(projection.selectedVisibleLeafFraction).toBeGreaterThan(.13)
  const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
  bambooSunResponse(shader,true,false)
  expect(shader.fragmentShader.indexOf('sunlitMineral')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <lights_fragment_end>'))
  expect(shader.fragmentShader.indexOf('outgoingLight+=sunlitMineral')).toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'))
  expect(shader.fragmentShader.match(/uniform sampler\w+\s+\w+/g)).toEqual(ShaderLib.standard.fragmentShader.match(/uniform sampler\w+\s+\w+/g))
  expect(bambooSunSampling).not.toMatch(/\bvec4\s+patch\b/)
  for(const golden of [false,true]){
    const leafShader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
    bambooSunResponse(leafShader,false,golden,true)
    expect(leafShader.fragmentShader).toContain('transmittedPigment')
    expect(leafShader.fragmentShader).not.toContain('sunlitMineral')
    expect(leafShader.vertexShader.includes('attribute float _sunTissue')).toBe(golden)
    expect(leafShader.fragmentShader.match(/uniform sampler\w+\s+\w+/g)).toEqual(ShaderLib.standard.fragmentShader.match(/uniform sampler\w+\s+\w+/g))
  }
  const windyLeaf={vertexShader:'attribute float _phase;\n'+ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
  bambooSunResponse(windyLeaf,false,false,true)
  expect(windyLeaf.vertexShader.match(/attribute float _phase;/g)).toHaveLength(1)
  const trunkShader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader}
  bambooSunResponse(trunkShader,false,false,false)
  expect(trunkShader.fragmentShader).toBe(ShaderLib.standard.fragmentShader)
  const window=bambooWindowLayout(),front=window.eye.clone().lerp(window.center,.35),behind=window.center.clone().addScaledVector(window.direction,9)
  const windowCheck={center:window.center.toArray(),radius:window.radius.toArray(),foregroundDepth:bambooWindowOpticalDepth(window.eye,front),
    rearDepth:bambooWindowOpticalDepth(window.eye,behind),outsideDepth:bambooWindowOpticalDepth(window.eye,new Vector3(5,1,-24)),
    footprintAspect:layout.trail.map(t=>t.patch.z/t.patch.w)}
  expect(windowCheck.foregroundDepth).toBe(0);expect(windowCheck.outsideDepth).toBe(0);expect(windowCheck.rearDepth).toBeGreaterThan(2)
  expect(Math.min(...windowCheck.footprintAspect)).toBeGreaterThan(3)
  const sky=woodlandSky('bamboo'),skyData=sky.image.data as Uint16Array,width=sky.image.width,height=sky.image.height
  const lon=Math.atan2(window.direction.z,window.direction.x),lat=Math.asin(window.direction.y)
  const col=Math.floor((lon/(Math.PI*2)+.5)*width),row=Math.floor((lat/Math.PI+.5)*height),k=(row*width+col)*4
  const skyWindowRGB=[0,1,2].map(i=>DataUtils.fromHalfFloat(skyData[k+i]))
  expect(skyWindowRGB[0]).toBeGreaterThan(3);expect(skyWindowRGB[0]).toBeGreaterThan(skyWindowRGB[2]*1.7)
  await mkdir('test-results',{recursive:true})
  await writeFile('test-results/bamboo-sunlight-check-4.json',JSON.stringify({camera:capture,trail,rims:layout.rims.map(p=>({screen:p.screen,world:p.world,projectedSunPlane:p.patch.toArray()})),gaps,tableEnvelope,outsideEnvelope,sprays,visibleLeafFraction,leafPixels,projection,windowCheck,skyWindowRGB},null,2)+'\n')
  sky.dispose();releaseCanopy();floor.dispose();shaped.dispose();filled.dispose()
},30000)
