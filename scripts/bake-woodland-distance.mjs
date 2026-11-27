import {createHash} from 'node:crypto'
import {compactCaptureImage} from './pack-woodland-images.mjs'
import {chromium} from '@playwright/test'
import {build} from 'vite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {relative,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
const compactDepth=encoded=>compactCaptureImage(Buffer.from(encoded,'base64'))
const dir=resolve(process.argv[2]||'art/deliverables/click-cut-final')
const sha=JSON.parse(await readFile(resolve(dir,'build.json'),'utf8')).sha256
const out=resolve('public/assets/woodland-distance');await mkdir(out,{recursive:true})
const lib=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('scripts/capture-woodland-face.ts'),name:'WoodlandCapture',formats:['iife']}}})
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const [id,name] of [['bamboo','竹林清风'],['creek','溪畔观流']]){
  if(process.argv[3]&&!process.argv[3].split(',').includes(id))continue
  const page=await browser.newPage({viewport:{width:800,height:600}})
  const shaderErrors=new Set()
  page.on('pageerror',error=>shaderErrors.add(error.message))
  page.on('console',message=>{
    const log=message.text()
    if(/Shader Error|THREE.WebGLProgram:|WebGL: INVALID/.test(log)){
      shaderErrors.add((log.match(/ERROR: [^\n]+/g)||[log.slice(0,500)]).slice(0,3).join('\n'))
    }
  })
  await page.addInitScript(()=>window.flowerCoreReview=true)
  const url=pathToFileURL(resolve(dir,'play.html'));url.searchParams.set('quality','full')
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000})
  await page.getByRole('group',{name:'选择场景'}).getByRole('button',{name,exact:true}).click({timeout:120000})
  await page.waitForFunction(id=>window.__coreInspect?.read().ritual.sceneId===id&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='开始插花'&&!b.disabled),id,{timeout:120000})
  const sourceImage=await page.evaluate(()=>{
    const {scene,camera,renderer}=window.__coreInspect
    scene.getObjectByName('nature_environment').userData.natureClock.value=0
    const view=camera.clone();view.position.set(0,1.472120159550991,1.1414794894642404)
    view.quaternion.set(-.19936793441719716,0,0,.9799247046208296);view.fov=47;view.aspect=1.5
    view.updateProjectionMatrix();view.updateMatrixWorld(true)
    renderer.setPixelRatio(1);renderer.setSize(1536,1024,false);renderer.render(scene,view)
    return renderer.domElement.toDataURL('image/png').split(',')[1]
  })
  await writeFile(resolve(dir,id+'-full-source.png'),Buffer.from(sourceImage,'base64'))
  await page.addScriptTag({content:(Array.isArray(lib)?lib[0]:lib).output[0].code})
  const data=await page.evaluate(()=>WoodlandCapture.capture())
  if(shaderErrors.size)throw new Error('远景渲染失败 '+id+' '+[...shaderErrors].join('\n'))
  const origin=Buffer.alloc(12)
  data.origin.forEach((v,i)=>origin.writeFloatLE(v,i*4))
  const chunks=[Buffer.from('WDS4'),Buffer.from([data.grid,6,0,0]),origin]
  for(const f of data.faces){
   const pic=Buffer.from(f.color,'base64'),depth=Buffer.from(f.depth,'base64'),size=Buffer.alloc(4)
   const occlusion=compactDepth(f.occlusion),length=Buffer.alloc(4)
   length.writeUInt32LE(occlusion.length);size.writeUInt32LE(pic.length);chunks.push(size,pic,depth,length,occlusion)
  }
  if(!data.faces.some(f=>Buffer.from(f.depth,'base64').some(Boolean)))throw Error('Empty depth capture: '+id)
  chunks.push(compactDepth(data.shadow))
  const file=Buffer.concat(chunks),fileHash=createHash('sha256').update(file).digest('hex')
  const filename=id+'-'+fileHash.slice(0,12)+'.bin'
  await writeFile(resolve(out,filename),file)
  await writeFile(resolve(dir,id+'-bake.json'),JSON.stringify({sourceHtml:sha,format:'WDS4',file:filename,sha256:fileHash,bytes:file.length,origin:data.origin,grid:data.grid},null,2)+'\n')
  if(process.argv.includes('--register')){
    const path=resolve(process.env.FLOWER_ASSET_MANIFEST||'public/assets/manifest.json')
    const manifest=JSON.parse(await readFile(path,'utf8'))
    const source=manifest.assets.find(a=>a.id==='environment-'+id)
    if(!source)throw Error('Missing environment '+id)
    manifest.assets=manifest.assets.filter(a=>a.id!=='distance-'+id)
    manifest.assets.push({id:'distance-'+id,file:'assets/woodland-distance/'+filename,distanceFor:source.file,source:'scripts/capture-woodland-face.ts',provenance:'Six views of the authored 3D forest with measured depths from the seated player eye.',license:'Project generated from the licensed source geometry'})
    await writeFile(path,JSON.stringify(manifest,null,2)+'\n')
  }
  console.log(id,file.length);await page.close()
 }
}finally{await browser.close()}
