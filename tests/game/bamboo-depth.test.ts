import {mkdir} from 'node:fs/promises'
import {readFile,writeFile} from 'node:fs/promises'
import {describe,it,expect} from 'vitest'
import {Euler,Matrix4,Mesh,PerspectiveCamera,Texture,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {bambooCulmLOD,bambooLeafLOD,bambooMiddleGrove,bambooOuterGround,bambooPathCenter,continueBambooGround,keepBambooPlant} from '../../src/scene/BambooDepth'
import {terrainSampler} from '../../src/scene/terrain-height'
import {bambooCanopy} from '../../src/scene/BambooCanopy'
import {deskView} from '../../src/scene/core/desk-space'

describe('live bamboo depth using the shipped GLB',()=>{
  it('keeps the foreground and seats the extended path, plants and all LODs in real geometry',async()=>{
    const bytes=await readFile('public/assets/environments/bamboo-garden-v17.glb')
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
      .register(()=>({name:'cpu-geometry',loadTexture:()=>Promise.resolve(new Texture())}))
    const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
    scene.updateMatrixWorld(true)
    const terrain=scene.getObjectByName('terrain') as Mesh,original=terrain.geometry,bed=terrainSampler(terrain)
    const markers: {node:typeof scene;position:Vector3;clearance:number}[]=[]
    scene.traverse(node=>{if(node.userData.prototype){
      const position=node.getWorldPosition(new Vector3())
      markers.push({node:node as typeof scene,position,clearance:position.y-bed(position.x,position.z)})
    }})
    const changed=continueBambooGround(scene,terrain,bed)
    expect(terrain.geometry).not.toBe(original)
    for(const [x,z] of [[0,0],[-1,-2],[1.77,-3.68],[2.45,-2.96]])expect(changed.at(x,z)).toBeCloseTo(bed(x,z),6)
    let previous=changed.at(bambooPathCenter(-4.8),-4.8)
    for(let z=-5;z>=-27;z-=.2){
      const y=changed.at(bambooPathCenter(z),z)
      expect(Number.isFinite(y)).toBe(true)
      expect(y).toBeGreaterThan(-.76)
      expect(Math.abs(y-previous),`path slope at ${z}: ${previous} -> ${y}`).toBeLessThan(.075)
      previous=y
    }
    expect(changed.at(bambooPathCenter(-20),-20)).toBeLessThan(-.35)
    expect(changed.at(bambooPathCenter(-27),-27)).toBeLessThan(-.40)
    for(const {node,position,clearance} of markers){
      const p=node.getWorldPosition(new Vector3())
      expect(p.x).toBeCloseTo(position.x,6);expect(p.z).toBeCloseTo(position.z,6)
      if(String(node.userData.prototype).startsWith('grove_')&&p.z< -4.25)
        expect(p.y-changed.at(p.x,p.z)).toBeLessThan(-.05)
      else expect(Math.abs(p.y-changed.at(p.x,p.z)-clearance)).toBeLessThan(.058)
    }
    let low=0,full=0
    const counts:number[]=[]
    for(let i=0;i<3;i++){
      const culm=scene.getObjectByName(`grove_${i}_culm`) as Mesh,leaves=scene.getObjectByName(`grove_${i}_leaves`) as Mesh
      const reduced=bambooCulmLOD(culm.geometry),leafLOD=bambooLeafLOD(leaves.geometry)
      expect(reduced.index!.count).toBeLessThan(culm.geometry.index!.count*.55)
      expect(leafLOD.index!.count).toBeLessThan(leaves.geometry.index!.count*.25)
      expect(reduced.index!.count).toBeGreaterThan(300)
      counts.push(reduced.index!.count/3,leafLOD.index!.count/3)
      for(const {node} of markers.filter(({node})=>node.userData.prototype===`grove_${i}`)){
        expect(keepBambooPlant(node.userData.prototype,node.matrixWorld)).toBe(true)
        const distance=Math.hypot(node.position.x,node.position.z)
        low+=(distance>6.8?reduced.index!.count+leafLOD.index!.count:culm.geometry.index!.count+leaves.geometry.index!.count)/3
        full+=(culm.geometry.index!.count+leaves.geometry.index!.count)/3
      }
      reduced.dispose();if(leafLOD!==leaves.geometry)leafLOD.dispose()
    }
    expect(low/full).toBeLessThan(.25)
    bambooMiddleGrove(scene,changed.at)
    let young=0
    scene.traverse(node=>{if(node.name.startsWith('bamboo_regrowth_')){
      young++
      expect(node.position.y-changed.at(node.position.x,node.position.z)).toBeCloseTo(-.065,5)
      expect(Math.abs(node.position.x-bambooPathCenter(node.position.z))).toBeGreaterThan(node.position.z> -25?.81:.43)
    }})
    expect(young).toBeGreaterThan(80);expect(young).toBeLessThan(160)
    const releaseOuter=bambooOuterGround(scene,changed.at,new Texture())
    const outer=scene.getObjectByName('bamboo_outer_soil') as Mesh
    expect(outer.geometry.index!.count/3).toBeLessThan(4000)
    const releaseCanopy=bambooCanopy(scene,changed.at),view=deskView(1536,1024)
    const camera=new PerspectiveCamera(view.fov,1.5,.01,80)
    camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
    const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
    const width=384,height=256,mask=new Uint8Array(width*height),nearMask=new Uint8Array(width*height),point=new Vector3(),leafPixels:number[]=[]
    scene.traverse(node=>{
      if(!(node instanceof Mesh)||!node.name.startsWith('bamboo_side_crown_')||!node.name.endsWith('_leaves'))return
      const vertices=node.geometry.attributes.position,index=node.geometry.index!,points:number[][]=[]
      for(let i=0;i<vertices.count;i++){
        point.fromBufferAttribute(vertices,i).applyMatrix4(projection)
        points.push([(point.x+1)*width/2,(1-point.y)*height/2,point.z])
      }
      if(node.name.includes('_0_'))for(let i=0;i<vertices.count;i+=12){
        const a=points[i],b=points[i+9]
        if(a[0]>0&&a[0]<width&&a[1]>0&&a[1]<70)leafPixels.push(Math.hypot(a[0]-b[0],a[1]-b[1])*4)
      }
      for(let i=0;i<index.count;i+=3){
        const a=points[index.getX(i)],b=points[index.getX(i+1)],c=points[index.getX(i+2)]
        if([a,b,c].some(v=>v[2]<-1||v[2]>1))continue
        const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])))
        const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])))
        const edge=(p:number[],q:number[],x:number,y:number)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0])
        const sign=Math.sign(edge(a,b,c[0],c[1]))
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sign*edge(a,b,x+.5,y+.5)>=0&&sign*edge(b,c,x+.5,y+.5)>=0&&sign*edge(c,a,x+.5,y+.5)>=0){
          mask[y*width+x]=1;if(node.name.includes('_0_'))nearMask[y*width+x]=1
        }
      }
    })
    const coverage=(x0:number,y0:number,x1:number,y1:number,source=mask)=>{
      let covered=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)covered+=source[y*width+x]
      return covered/((x1-x0)*(y1-y0))
    }
    leafPixels.sort((a,b)=>a-b)
    const bendPoint=new Vector3(bambooPathCenter(-6.6),changed.at(bambooPathCenter(-6.6),-6.6),-6.6).applyMatrix4(projection)
    const composition={upperBand:coverage(0,0,384,54),nearUpperBand:coverage(0,0,384,54,nearMask),middleBand:coverage(0,54,384,100),
      pathBendScreenY:(1-bendPoint.y)/2,endOfPathFoliage:coverage(154,39,250,64),
      clearPath:coverage(160,65,224,119),nearLeafMedianPixels:leafPixels[Math.floor(leafPixels.length*.5)],canopy:scene.userData.bambooCanopy}
    console.log('canopy projection',composition)
    await mkdir('test-results',{recursive:true})
  await writeFile('test-results/bamboo-geometry-check.json',JSON.stringify({composition,profile:scene.userData.bambooPath},null,2)+'\n')
    expect(composition.nearUpperBand).toBeLessThan(.18)
    expect(composition.endOfPathFoliage).toBeGreaterThan(.50);expect(composition.endOfPathFoliage).toBeLessThan(.90)
    expect(composition.pathBendScreenY).toBeGreaterThan(.21);expect(composition.pathBendScreenY).toBeLessThan(.30)
    expect(composition.clearPath).toBeLessThan(.35)
    expect(composition.nearLeafMedianPixels).toBeGreaterThan(12);expect(composition.nearLeafMedianPixels).toBeLessThan(38)
    expect(composition.canopy.triangles).toBeLessThan(260000)
    console.log(JSON.stringify({profile:scene.userData.bambooPath,culmAndLeafTriangles:{full,low},lodPerSpecies:counts}))
    releaseCanopy();releaseOuter();changed.dispose()
  })
})
