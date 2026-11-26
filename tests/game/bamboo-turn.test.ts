import {mkdir} from 'node:fs/promises'
import {readFile,writeFile} from 'node:fs/promises'
import {expect,it} from 'vitest'
import {Euler,Matrix4,Mesh,PerspectiveCamera,Raycaster,Texture,Vector2,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {terrainSampler} from '../../src/scene/terrain-height'
import {continueBambooGround} from '../../src/scene/BambooDepth'
import {shapeWoodlandGround} from '../../src/scene/WoodlandGroundShape'
import {detailForestFloor} from '../../src/scene/ForestFloor'
import {bambooTurn} from '../../src/scene/BambooTurn'
import {deskView} from '../../src/scene/core/desk-space'

it('grounds uneven side shrubs around an open left turn without a suspended leaf wall',async()=>{
  const catalog=JSON.parse(await readFile('public/assets/manifest.json','utf8'))
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'cpu-geometry',loadTexture:()=>Promise.resolve(new Texture())}))
  async function model(id:string){
    const bytes=await readFile('public/'+catalog.assets.find((a:{id:string})=>a.id===id).file)
    return (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene
  }
  const root=await model('environment-bamboo'),kit=await model('nature-kit')
  root.updateMatrixWorld(true);kit.updateMatrixWorld(true)
  const terrain=root.getObjectByName('terrain') as Mesh,original=terrainSampler(terrain)
  const filled=continueBambooGround(root,terrain,original),shaped=shapeWoodlandGround(root,terrain,filled.at,filled.at,'bamboo')
  const floor=detailForestFloor(root,kit,shaped.at,'bamboo'),surfaces=[terrain,root.getObjectByName('root_bank_soil') as Mesh]
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80)
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  const ray=new Raycaster(),uv=new Vector2(),point=new Vector3(),projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  const begin=performance.now(),turn=bambooTurn(root,shaped.at,camera,(x,y)=>{ray.setFromCamera(uv.set(x*2-1,1-y*2),camera);return ray.intersectObjects(surfaces,false)[0]?.point})
  const buildMs=performance.now()-begin,width=512,height=342,mask=new Uint8Array(width*height)
  let maxLeafReflectance=0,lowLeafVertices=0,leafVertices=0,minLeafClearance=Infinity
  for(const mesh of turn.meshes){
    const vertices=mesh.geometry.attributes.position,index=mesh.geometry.index!,points:number[][]=[]
    for(let i=0;i<vertices.count;i++){
      point.fromBufferAttribute(vertices,i).applyMatrix4(projection)
      points.push([(point.x+1)*width/2,(1-point.y)*height/2,point.z])
      if(mesh.name.endsWith('leaves')){
        maxLeafReflectance=Math.max(maxLeafReflectance,...Array.from(mesh.geometry.attributes.color.array.slice(i*3,i*3+3)))
        const clearance=vertices.getY(i)-shaped.at(vertices.getX(i),vertices.getZ(i))
        minLeafClearance=Math.min(minLeafClearance,clearance);leafVertices++;if(clearance<.060)lowLeafVertices++
      }
    }
    for(let i=0;i<index.count;i+=3){
      const a=points[index.getX(i)],b=points[index.getX(i+1)],c=points[index.getX(i+2)]
      if([a,b,c].some(p=>p[2]< -1||p[2]>1))continue
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])))
      const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])))
      const edge=(p:number[],q:number[],x:number,y:number)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]),sign=Math.sign(edge(a,b,c[0],c[1]))
      if(!sign)continue
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sign*edge(a,b,x+.5,y+.5)>=0&&sign*edge(b,c,x+.5,y+.5)>=0&&sign*edge(c,a,x+.5,y+.5)>=0)mask[y*width+x]=1
    }
  }
  const coverage=(left:number,top:number,right:number,bottom:number)=>{
    const x0=Math.floor(left*width),x1=Math.ceil(right*width),y0=Math.floor(top*height),y1=Math.ceil(bottom*height)
    let count=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)count+=mask[y*width+x]
    return count/((x1-x0)*(y1-y0))
  }
  const burial:number[]=[]
  for(const [x,y,z] of turn.report.roots){ray.ray.origin.set(x,8,z);ray.ray.direction.set(0,-1,0);burial.push(y-ray.intersectObjects(surfaces,false)[0].point.y)}
  const composition={barrier:coverage(.40,.17,.63,.265),turnAt24Percent:coverage(.43,.232,.60,.249),
    lowerFade:coverage(.40,.26,.63,.295),openPath:coverage(.36,.30,.68,.56),
    columns:Array.from({length:6},(_,i)=>coverage(.40+i*.038,.20,.438+i*.038,.255))}
  const pathSamples=[[.434,.227],[.446,.246],[.459,.266],[.475,.290]].map(([x,y])=>({screen:[x,y],obstruction:coverage(x-.005,y-.004,x+.005,y+.004)}))
  let longestUpperRun=0
  for(let y=Math.floor(.17*height);y<Math.ceil(.235*height);y++){
    let run=0
    for(let x=Math.floor(.37*width);x<Math.ceil(.67*width);x++){
      run=mask[y*width+x]?run+1:0;longestUpperRun=Math.max(longestUpperRun,run)
    }
  }
  const rootLeafContact=turn.report.roots.map(([x,,z])=>{
    const p=turn.meshes[0].geometry.attributes.position;let lowest=Infinity
    for(let i=0;i<p.count;i++)if(Math.hypot(p.getX(i)-x,p.getZ(i)-z)<.075)lowest=Math.min(lowest,p.getY(i)-shaped.at(p.getX(i),p.getZ(i)))
    return lowest
  })
  const report={...turn.report,buildMs,composition,pathSamples,longestUpperRun:longestUpperRun/width,
    lowLeafFraction:lowLeafVertices/leafVertices,minLeafClearance,rootLeafContact,maxLeafReflectance,burial:{min:Math.min(...burial),max:Math.max(...burial)},
    depthSpan:Math.max(...turn.report.roots.map(p=>p[2]))-Math.min(...turn.report.roots.map(p=>p[2]))}
  await mkdir('test-results',{recursive:true})
  await writeFile('test-results/bamboo-turn-check.json',JSON.stringify(report,null,2)+'\n')
  console.log({plants:report.plants,triangles:report.triangles,composition,pathSamples,longestUpperRun:report.longestUpperRun,lowLeafFraction:report.lowLeafFraction,rootLeafContact,burial:report.burial})
  expect(report.plants).toBe(9);expect(report.triangles).toBeLessThan(6000)
  expect(pathSamples.every(p=>p.obstruction<.10)).toBe(true)
  expect(report.longestUpperRun).toBeLessThan(.12)
  expect(report.lowLeafFraction).toBeGreaterThan(.25);expect(report.minLeafClearance).toBeGreaterThan(-.002)
  expect(rootLeafContact.every(v=>v<.025)).toBe(true)
  expect(composition.openPath).toBe(0)
  expect(report.burial.min).toBeGreaterThan(-.018);expect(report.burial.max).toBeLessThan(0)
  expect(report.depthSpan).toBeGreaterThan(1);expect(maxLeafReflectance).toBeLessThan(.30)
  turn.dispose();floor.dispose();shaped.dispose();filled.dispose()
},15000)
