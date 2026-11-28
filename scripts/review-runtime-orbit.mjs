import {gpuArguments,verifyGpu} from './browser-gpu.mjs'
import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa','verified-orbit'),server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
await mkdir(out,{recursive:true})
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:gpuArguments()});const report=[]
 for(const sceneId of ['bamboo','creek']){
  const context=await browser.newContext({viewport:{width:1536,height:1024}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(90000)
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text())})
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor()
  await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.waitForTimeout(1300)
  const actualGpu=await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})
  verifyGpu(actualGpu);console.log(sceneId+' GPU '+actualGpu)
  const names=['front','front-right','right','back-right','back','back-left','left','front-left']
  for(let i=0;i<8;i++){
   const data=await page.evaluate(angle=>{
    const {renderer,scene,camera}=window.__coreInspect,env=scene.getObjectByName('nature_environment'),q=camera.quaternion.clone(),p=camera.position.clone(),time=env.userData.natureClock.value
    const rotation=q.clone().setFromAxisAngle(camera.up,angle);camera.quaternion.premultiply(rotation);camera.position.x+=1e-7;camera.updateMatrixWorld(true);env.userData.natureClock.value=1000
    scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.needsUpdate=true});renderer.render(scene,camera)
    const image=renderer.domElement.toDataURL('image/png').split(',')[1],result={image,eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,dpr:renderer.getPixelRatio(),pixels:[renderer.domElement.width,renderer.domElement.height]}
    camera.position.copy(p);camera.quaternion.copy(q);camera.updateMatrixWorld(true);env.userData.natureClock.value=time;return result
   },-i*Math.PI/4)
   await writeFile(resolve(out,sceneId+'-'+names[i]+'.png'),Buffer.from(data.image,'base64'));delete data.image;report.push({sceneId,gpu:actualGpu,direction:names[i],...data})
  }
  if(errors.length)throw Error(errors.join('\n'));console.log(sceneId+' eight actual-camera seated views saved');await context.close()
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify({note:'Eight visual inspection directions use the real seated camera at automatic quality. Real mouse orbit is tested separately by review-runtime-session.',views:report},null,2)+'\n')
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
