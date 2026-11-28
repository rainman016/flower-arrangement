import {gpuArguments,verifyGpu} from './browser-gpu.mjs'
import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa/runtime-v2','creek-rendering');await mkdir(out,{recursive:true})
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:gpuArguments()});const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[]
 page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1000))})
 await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'溪畔观流',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor()
 await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.waitForTimeout(1200)
 const gpu=await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});verifyGpu(gpu)
 const result=await page.evaluate(()=>{
  const {renderer,scene,camera}=window.__coreInspect,water=scene.getObjectByName('creek_surface'),env=scene.getObjectByName('nature_environment'),draw=renderer.renderBufferDirect,p=camera.position.clone(),q=camera.quaternion.clone(),clock=env.userData.natureClock
  renderer.setPixelRatio(1);clock.value=1000;scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.needsUpdate=true});renderer.render(scene,camera)
  const shot=()=>renderer.domElement.toDataURL().split(',')[1],images={optimized:shot()},initial=water.userData.creekMirrorCache.renders;let skipped=0
  renderer.renderBufferDirect=function(...args){if(args[4].name==='creek_opaque_depth'){skipped++;return}return draw.apply(this,args)}
  renderer.render(scene,camera);images.withoutDepth=shot();renderer.renderBufferDirect=draw
  const beforeRotation=water.userData.creekMirrorCache.renders;camera.rotateY(.07);camera.updateMatrixWorld();renderer.render(scene,camera);images.cachedRotation=shot();const smallRotation=water.userData.creekMirrorCache.renders
  camera.position.x+=1e-8;camera.updateMatrixWorld();renderer.render(scene,camera);images.freshRotation=shot();const translation=water.userData.creekMirrorCache.renders
  camera.rotateY(.20);camera.updateMatrixWorld();renderer.render(scene,camera);const largeRotation=water.userData.creekMirrorCache.renders
  camera.aspect*=.9;camera.updateProjectionMatrix();renderer.render(scene,camera);const projection=water.userData.creekMirrorCache.renders
  camera.position.copy(p);camera.quaternion.copy(q);camera.updateMatrixWorld()
  env.visible=false;renderer.render(scene,camera);images.hiddenDepth=shot()
  renderer.renderBufferDirect=function(...args){if(args[4].name==='creek_opaque_depth')return;return draw.apply(this,args)};renderer.render(scene,camera);images.hiddenNoDepth=shot();renderer.renderBufferDirect=draw;env.visible=true
  const mask=camera.layers.mask,background=scene.background,auto=renderer.autoClear;camera.layers.set(31);scene.background=null;renderer.setClearColor(0x8b3c62,1);renderer.clear();renderer.autoClear=false
  const gl=renderer.getContext(),basePixel=new Uint8Array(4),overlayPixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,basePixel);renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,overlayPixel)
  camera.layers.mask=mask;scene.background=background;renderer.autoClear=auto
  return {images,basePixel:[...basePixel],overlayPixel:[...overlayPixel],skipped,initial,beforeRotation,smallRotation,translation,largeRotation,projection,bed:water.userData.creekBedCache,mirror:water.userData.creekMirrorCache}
 })
 const differences=await page.evaluate(async images=>{
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),pixels={};for(const [name,data]of Object.entries(images)){const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);pixels[name]=ctx.getImageData(0,0,canvas.width,canvas.height).data}
  return [['optimized','withoutDepth'],['hiddenDepth','hiddenNoDepth']].map(([a,b])=>{const x=pixels[a],y=pixels[b];let sum=0,bad=0;for(let i=0;i<x.length;i+=4){let peak=0;for(let c=0;c<3;c++){const d=Math.abs(x[i+c]-y[i+c]);sum+=d;peak=Math.max(peak,d)}if(peak>8)bad++}return {a,b,mean:sum/(x.length/4*3),pixelsOver8:bad/(x.length/4)}})
 },result.images)
 for(const row of differences){assert.ok(row.mean<.2&&row.pixelsOver8<.002,JSON.stringify(row))}assert.deepEqual(result.overlayPixel,result.basePixel,'Foreground-only render preserves the existing backdrop')
 for(const [name,data] of Object.entries(result.images))await writeFile(resolve(out,name+'.png'),Buffer.from(data,'base64'));delete result.images
 assert.ok(result.skipped>0,'Actual early-depth pass was exercised');assert.equal(result.smallRotation,result.beforeRotation,'Small rotation reuses world-projective capture');assert.equal(result.translation,result.smallRotation+1,'Translation refreshes immediately');assert.equal(result.largeRotation,result.translation+1,'Capture margin refreshes immediately');assert.equal(result.projection,result.largeRotation+1,'Projection refreshes immediately');assert.equal(result.bed.renders,1,'Static riverbed captured once');assert.deepEqual(errors,[])
 await writeFile(resolve(out,'report.json'),JSON.stringify({gpu,...result,differences,errors},null,2)+'\n');console.log(JSON.stringify({...result,differences,errors}))
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
