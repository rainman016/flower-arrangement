import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {visibleDeskPoint,deskMouseTargets} from './desk-mouse-targets.mjs'
const out='../runtime-qa/runtime-v2/opaque-order';await mkdir(out,{recursive:true})
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];page.setDefaultTimeout(90000)
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|WebGL: INVALID/.test(m.text()))errors.push(m.text())})
 await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'溪畔观流',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor()
 await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.waitForTimeout(1500)
 await page.evaluate(()=>{
  const {renderer,scene,camera}=window.__coreInspect,set=renderer.setPixelRatio.bind(renderer);renderer.setPixelRatio=()=>set(.53);renderer.setPixelRatio(.53)
  const draw=renderer.render.bind(renderer),gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),pending=[];let depth=0,last=0,ordinal=0
  const data=globalThis.__order={mode:'warm',frames:[],gpu:[]}
  renderer.render=function(s,c){
   const top=!depth&&s===scene&&c===camera&&!renderer.getRenderTarget(),now=performance.now()
   if(top){if(last)data.frames.push({mode:data.mode,ms:now-last});last=now;while(pending.length&&gl.getQueryParameter(pending[0].q,gl.QUERY_RESULT_AVAILABLE)){const p=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))data.gpu.push({mode:p.mode,ms:gl.getQueryParameter(p.q,gl.QUERY_RESULT)/1e6});gl.deleteQuery(p.q)}}
   const q=top&&ext&&ordinal++%6===0?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);depth++
   try{return draw(s,c)}finally{depth--;if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({q,mode:data.mode})}}
  }
 })
 const grip=await visibleDeskPoint(page,'vase'),points=await deskMouseTargets(page,'vase',grip,[[-.28,.16],[.26,.16],[.25,-.18],[-.25,-.18]])
 await page.mouse.click(grip.x,grip.y)
 for(const mode of ['baseline','bench-first','near-first','baseline-repeat']){
  await page.evaluate(mode=>{
   const {renderer,scene}=window.__coreInspect,bench=new Set();scene.getObjectByName('workbench_and_tools')?.traverse(o=>bench.add(o.id))
   renderer.setOpaqueSort(mode==='bench-first'?(a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||Number(bench.has(b.id))-Number(bench.has(a.id))||a.material.id-b.material.id||a.z-b.z||a.id-b.id:mode==='near-first'?(a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||a.z-b.z||a.material.id-b.material.id||a.id-b.id:null)
   globalThis.__order.mode='warm'
  },mode)
  await page.waitForTimeout(500);await page.evaluate(mode=>globalThis.__order.mode=mode,mode)
  const start=Date.now();while(Date.now()-start<18000){const p=((Date.now()-start)/2600)%4,i=Math.floor(p),f=p-i,a=points[i],b=points[(i+1)%4];await page.mouse.move(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f);await new Promise(r=>setTimeout(r,8))}
  console.log(mode+' complete')
 }
 const data=await page.evaluate(()=>globalThis.__order),stats=a=>{a=a.map(r=>r.ms).sort((a,b)=>a-b);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)}}
 const result={errors,modes:Object.fromEntries(['baseline','bench-first','near-first','baseline-repeat'].map(mode=>[mode,{frame:stats(data.frames.filter(r=>r.mode===mode)),gpu:stats(data.gpu.filter(r=>r.mode===mode))}]))}
 await writeFile(out+'/report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
