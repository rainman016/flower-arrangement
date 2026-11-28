import {gpuArguments,verifyGpu} from './browser-gpu.mjs'
import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {visibleDeskPoint} from './desk-mouse-targets.mjs'
const out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa/runtime-v2','desk-environment-cache');await mkdir(out,{recursive:true})
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:gpuArguments()});const reports=[]
 for(const sceneId of ['bamboo','creek']){
  const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];page.setDefaultTimeout(90000)
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|WebGL: INVALID/.test(m.text()))errors.push(m.text())})
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor()
  await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.waitForTimeout(1200)
  const gpu=await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});verifyGpu(gpu)
  const grip=await visibleDeskPoint(page,'vase');assert.ok(grip);await page.mouse.click(grip.x,grip.y);await page.mouse.move(grip.x+50,grip.y-20);await page.waitForTimeout(500)
  await page.evaluate(()=>{const {renderer,scene}=window.__coreInspect,clock=scene.getObjectByName('nature_environment').userData.natureClock,value=clock.value,ratio=renderer.getPixelRatio(),set=renderer.setPixelRatio.bind(renderer);Object.defineProperty(clock,'value',{get:()=>value,set:()=>{},configurable:true});renderer.setPixelRatio=()=>set(ratio)})
  await page.waitForTimeout(180)
  const data=await page.evaluate(async()=>{
   const {renderer,scene,camera,world}=window.__coreInspect,render=renderer.render,stats=scene.userData.deskEnvironmentCache
   if(!stats)throw Error('The real carry did not enter the environment cache')
   const cached=await new Promise(resolve=>{renderer.render=function(s,c){const result=render.call(this,s,c);if(s===scene&&c===camera&&!renderer.getRenderTarget()){renderer.render=render;resolve(renderer.domElement.toDataURL().split(',')[1])}return result}})
   renderer.render(scene,camera);const complete=renderer.domElement.toDataURL().split(',')[1]
   return {cached,complete,stats:{...stats},active:world.active?.kind}
  })
  const difference=await page.evaluate(async data=>{
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),rows=[]
   for(const key of ['cached','complete']){const image=new Image();image.src='data:image/png;base64,'+data[key];await image.decode();canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);rows.push(ctx.getImageData(0,0,canvas.width,canvas.height).data)}
   let sum=0,bad=0;for(let i=0;i<rows[0].length;i+=4){let peak=0;for(let c=0;c<3;c++){const d=Math.abs(rows[0][i+c]-rows[1][i+c]);sum+=d;peak=Math.max(peak,d)}if(peak>8)bad++}return {mean:sum/(rows[0].length/4*3),pixelsOver8:bad/(rows[0].length/4)}
  },data)
  for(const key of ['cached','complete'])await writeFile(resolve(out,sceneId+'-'+key+'.png'),Buffer.from(data[key],'base64'))
  const before=await page.evaluate(()=>window.__coreInspect.scene.userData.deskEnvironmentCache.viewUpdates)
  await page.setViewportSize({width:1500,height:1000});await page.waitForTimeout(200)
  const view={before,after:await page.evaluate(()=>window.__coreInspect.scene.userData.deskEnvironmentCache.viewUpdates)}
  reports.push({sceneId,gpu,errors,difference,stats:data.stats,active:data.active,view});console.log(JSON.stringify(reports.at(-1)));await page.close()
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify(reports,null,2)+'\n')
 for(const r of reports){assert.deepEqual(r.errors,[]);assert.ok(r.stats.reused>0);assert.ok(r.stats.batches>0);assert.ok(r.view.after>r.view.before);assert.ok(r.difference.mean<.2&&r.difference.pixelsOver8<.002,JSON.stringify(r))}
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
