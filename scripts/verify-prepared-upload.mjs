import {gpuArguments,verifyGpu} from './browser-gpu.mjs'
import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa','prepared-upload'),server=await preview({preview:{host:'127.0.0.1',port:0,open:false}})
await mkdir(out,{recursive:true});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:gpuArguments()});const results=[]
 for(const scene of ['bamboo','creek']){
  const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message))
  const ready=()=>page.locator('main[data-core-ready="true"]').waitFor().catch(async error=>{await writeFile(resolve(out,scene+'-failure.json'),JSON.stringify({errors,state:await page.evaluate(()=>({text:document.body.innerText,timing:window.__coreInspect?.scene.userData.runtimeTimings,calibration:window.__coreInspect?.scene.userData.runtimeCalibration,glLost:window.__coreInspect?.renderer.getContext().isContextLost()}))},null,2));throw error})
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true;globalThis.flowerUploadReview=!sessionStorage.getItem('flower-qa-release')});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:scene==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();await ready()
  const gpu=await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});verifyGpu(gpu)
  const rows=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=257
   const gl=canvas.getContext('webgl2',{premultipliedAlpha:false,preserveDrawingBuffer:true}),program=gl.createProgram(),seen=new Set(),rows=[]
   for(const [kind,source]of [[gl.VERTEX_SHADER,'#version 300 es\nout vec2 uv;void main(){vec2 p=gl_VertexID==0?vec2(-1.,-1.):gl_VertexID==1?vec2(3.,-1.):vec2(-1.,3.);uv=.5+.5*p;gl_Position=vec4(p,0.,1.);}'],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform sampler2D image;in vec2 uv;out vec4 colour;void main(){colour=texture(image,uv);}']]){
    const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);gl.deleteShader(shader)
   }
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);gl.viewport(0,0,257,257)
   const draw=(image,flip,premultiply)=>{
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.drawArrays(gl.TRIANGLES,0,3)
    const pixels=new Uint8Array(257*257*4);gl.readPixels(0,0,257,257,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteTexture(texture);if(gl.getError()!==gl.NO_ERROR)throw Error('Upload comparison GL error');return pixels
   }
   for(const row of globalThis.flowerPreparedUploads||[]){
    if(seen.has(row.bitmap))continue;seen.add(row.bitmap)
    const a=draw(row.original,row.flipY,row.premultiplyAlpha),b=draw(row.bitmap,false,false)
    let total=0,count=0,max=0,alphaMax=0
    for(let i=0;i<a.length;i++){if(i%4!==3&&a[i-i%4+3]===0&&b[i-i%4+3]===0)continue;const difference=Math.abs(a[i]-b[i]);total+=difference;count++;max=Math.max(max,difference);if(i%4===3)alphaMax=Math.max(alphaMax,difference)}
    rows.push({name:row.name,width:row.bitmap.width,height:row.bitmap.height,flipY:row.flipY,premultiplyAlpha:row.premultiplyAlpha,mean:total/count,max,alphaMax})
   }
   gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();globalThis.flowerPreparedUploads=[];return rows
  })
  assert.ok(rows.length>10,'Actual prepared textures were converted')
  await writeFile(resolve(out,scene+'.json'),JSON.stringify(rows,null,2)+'\n')
  for(const row of rows){assert.ok(row.mean<.2&&row.alphaMax<=1,JSON.stringify(row))}
  const retained=await page.evaluate(()=>{
   const renderer=window.__coreInspect.renderer,release=renderer.forceContextLoss.bind(renderer)
   sessionStorage.setItem('flower-qa-release','0')
   renderer.forceContextLoss=()=>{sessionStorage.setItem('flower-qa-release',String(Number(sessionStorage.getItem('flower-qa-release'))+1));release()}
   window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))
   return !renderer.getContext().isContextLost()
  });assert.ok(retained,'A retained back-navigation page keeps its renderer')
  const requests=[];page.on('request',r=>{if(/\/assets\/(prepared\/textures|models\/prop-kit|surfaces\/forest-light)/.test(r.url()))requests.push(r.url())})
  await page.reload();await page.getByRole('group',{name:'选择场景'}).waitFor()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('flower-qa-release')),'1','Reload releases the old graphics context')
  await page.getByRole('button',{name:scene==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click()
  if(await page.getByRole('button',{name:'开启新花席',exact:true}).count())await page.getByRole('button',{name:'开启新花席',exact:true}).click()
  await ready()
  assert.equal(await page.evaluate(()=>window.__coreInspect.scene.userData.runtimeCalibration.cached),true,'Reload reuses the recent viewport calibration')
  assert.deepEqual(requests,[],'Reload reuses exact cached model, light and texture bytes')
  results.push({scene,gpu,textures:rows.length,maxMean:Math.max(...rows.map(r=>r.mean)),maxAlphaDifference:Math.max(...rows.map(r=>r.alphaMax)),retainedPage:true,reloadReleased:true,calibrationReused:true,assetNetworkRequests:requests.length});await page.close()
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results))
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
