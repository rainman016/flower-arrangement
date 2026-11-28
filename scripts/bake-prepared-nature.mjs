import {compressPreparedNature} from './pack-prepared-nature.mjs'
import {chromium} from '@playwright/test'
import {build,preview} from 'vite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

const sceneId=process.argv[2]||'bamboo',out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa',sceneId+'-preparation')
await mkdir(out,{recursive:true})
const lib=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:resolve('scripts/capture-prepared-nature.ts'),name:'PreparedNatureCapture',formats:['iife']}}})
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true})
 const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1000))})
 await page.addInitScript(()=>{
  globalThis.flowerCoreReview=true;globalThis.flowerPrepareCapture=true
  globalThis.__preparedImageBlobs=new Map();globalThis.__preparedBitmaps=new WeakMap()
  const createURL=URL.createObjectURL.bind(URL),bitmap=globalThis.createImageBitmap.bind(globalThis)
  URL.createObjectURL=blob=>{const url=createURL(blob);globalThis.__preparedImageBlobs.set(url,blob);return url}
  globalThis.createImageBitmap=async(...args)=>{const image=await bitmap(...args);if(args[0] instanceof Blob)globalThis.__preparedBitmaps.set(image,{blob:args[0],flip:args.at(-1)?.imageOrientation==='flipY'});return image}
 })
 await page.goto(server.resolvedUrls.local[0]+'?native-render',{waitUntil:'domcontentloaded'})
 await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click()
 await page.locator('main[data-core-ready="true"]').waitFor({timeout:180000})
 await page.evaluate(()=>{
  const {renderer,scene,camera}=window.__coreInspect,view=camera.clone()
  view.position.set(0,1.472120159550991,1.1414794894642404);view.fov=47;view.aspect=1.5;view.updateProjectionMatrix()
  for(let i=0;i<8;i++){const a=i*Math.PI/4;view.lookAt(Math.sin(a),view.position.y-.424088,view.position.z-Math.cos(a));view.updateMatrixWorld();renderer.render(scene,view)}
 })
 await page.addScriptTag({content:(Array.isArray(lib)?lib[0]:lib).output[0].code})
 const result=await page.evaluate(()=>PreparedNatureCapture.capture())
 if(errors.length)throw Error(errors.join('\n'))
 await browser.close();browser=undefined
 const externalImages=new Map(),bytes=await compressPreparedNature(Buffer.from(result.data,'base64'),{externalImages});delete result.data;result.bytes=bytes.length
 const hash=createHash('sha256').update(bytes).digest('hex'),filename=sceneId+'-'+hash.slice(0,12)+'.pns',file='assets/prepared/'+filename
 await mkdir(resolve('public/assets/prepared'),{recursive:true});await writeFile(resolve('public',file),bytes)
 await mkdir(resolve('public/assets/prepared/textures'),{recursive:true});for(const image of externalImages.values())await writeFile(resolve('public',image.file),image.bytes)
 const record={...result,file,sha256:hash,textureBytes:[...externalImages.values()].reduce((s,i)=>s+i.bytes.length,0),errors}
 await writeFile(resolve(out,'preparation.json'),JSON.stringify(record,null,2)+'\n')
 if(process.argv.includes('--register')){
  const path=resolve('public/assets/manifest.json'),manifest=JSON.parse(await readFile(path,'utf8')),source=manifest.assets.find(a=>a.id==='environment-'+sceneId)
  manifest.assets=manifest.assets.filter(a=>a.id!=='prepared-'+sceneId)
  manifest.assets.push({id:'prepared-'+sceneId,file,preparedTextures:[...externalImages.keys()],preparedFor:source.file,source:'scripts/bake-prepared-nature.mjs',provenance:'Actual prepared 3D geometry, instances, textures and shader parameters. No screenshot background.',license:'Project generated from the licensed source geometry'})
  for(const image of externalImages.values())if(!manifest.assets.some(a=>a.id===image.id))manifest.assets.push({id:image.id,file:image.file,source:'scripts/bake-prepared-nature.mjs',provenance:'Original encoded prepared texture',license:'Project generated from licensed source textures'})
  const used=new Set(manifest.assets.flatMap(a=>a.preparedTextures??[]));manifest.assets=manifest.assets.filter(a=>!a.id.startsWith('prepared-texture-')||used.has(a.id))
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n')
 }
 console.log(JSON.stringify(record,null,2))
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
