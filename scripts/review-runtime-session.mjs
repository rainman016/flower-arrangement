import {gpuArguments,verifyGpu} from './browser-gpu.mjs'
import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {visibleDeskPoint,deskMouseTargets} from './desk-mouse-targets.mjs'
const sceneId=process.argv[2]||'bamboo',label=process.argv[3]||'session',seconds=Number(process.env.FLOWER_SECONDS||300),out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa',label)
await mkdir(out,{recursive:true});const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:gpuArguments()});const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[]
 page.setDefaultTimeout(90000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR '+e.message)});page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1000))})
 await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor();await page.waitForTimeout(4000)
 const actualGpu=await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})
 verifyGpu(actualGpu);console.log(sceneId+' GPU '+actualGpu)
 if(errors.length)throw Error(errors.slice(0,2).join('\n'))
 await page.evaluate(()=>{
  const {renderer,scene,camera}=window.__coreInspect,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),render=renderer.render,pending=[]
  let depth=0,last=0,ordinal=0
  const data=globalThis.__sessionFrames={frames:[],gpu:[],phase:'orbit',enabled:true,setPhase(phase){this.phase=phase;last=0}}
  renderer.render=function(s,c){
   const top=depth===0&&s===scene&&c===camera&&!renderer.getRenderTarget(),now=performance.now()
   if(top&&data.enabled){
    while(pending.length&&gl.getQueryParameter(pending[0].q,gl.QUERY_RESULT_AVAILABLE)){
     const sample=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))data.gpu.push({ms:gl.getQueryParameter(sample.q,gl.QUERY_RESULT)/1e6,phase:sample.phase});gl.deleteQuery(sample.q)
    }
    if(last)data.frames.push({ms:now-last,phase:data.phase,dpr:renderer.getPixelRatio()});last=now
   }
   const q=top&&data.enabled&&ext&&pending.length<4&&ordinal++%12===0?gl.createQuery():null
   if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);depth++
   try{return render.call(this,s,c)}finally{depth--;if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({q,phase:data.phase})}}
  }
 })
 const turns=[],before=await page.evaluate(()=>window.__coreInspect.camera.quaternion.toArray()),turnCount=Math.max(8,Math.floor(seconds*.4/20)*8),duration=seconds*.4*1000/turnCount
 for(let i=0;i<turnCount;i++){
  await page.mouse.move(1280,600);await page.mouse.down();const at=Date.now()
  while(Date.now()-at<duration){await page.mouse.move(1280-Math.min(1,(Date.now()-at)/duration)*Math.PI/4/.005,600);await new Promise(r=>setTimeout(r,8))}
  await page.mouse.move(1280-Math.PI/4/.005,600);await page.mouse.up();turns.push(await page.evaluate(()=>window.__coreInspect.camera.quaternion.toArray()))
  if(i%8===7)console.log(sceneId+' orbit '+(i+1)+' turns')
 }
 const dot=(a,b)=>Math.abs(a.reduce((sum,n,i)=>sum+n*b[i],0));assert.ok(dot(before,turns[3])<.05,'Orbit passed the rear');assert.ok(dot(before,turns.at(-1))>.999,'Orbit returned to the front')
 await page.evaluate(()=>globalThis.__sessionFrames.setPhase('transition'))
 await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.locator('main[data-stage="prepare"]').waitFor();await page.waitForTimeout(1200)
 const grip=await visibleDeskPoint(page,'vase');assert.ok(grip,'Vase is visible')
 const points=await deskMouseTargets(page,'vase',grip,[[-.28,.16],[.26,.16],[.25,-.18],[-.25,-.18]])
 await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(grip.x+2,grip.y+1);await page.mouse.up();await page.waitForTimeout(200)
 assert.equal(await page.evaluate(()=>window.__coreInspect.world.active?.id),'vase','Real pointer input picked up the vase')
 await page.evaluate(()=>globalThis.__sessionFrames.setPhase('carry'))
 const carryStart=Date.now(),carryMs=seconds*.6*1000;let announced=0
 while(Date.now()-carryStart<carryMs){
  const elapsed=Date.now()-carryStart,position=(elapsed/2600)%4,i=Math.floor(position),f=position-i,a=points[i],b=points[(i+1)%4]
  await page.mouse.move(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f);await new Promise(r=>setTimeout(r,8))
  if(elapsed-announced>30000){announced=elapsed;console.log(sceneId+' carry '+Math.round(elapsed/1000)+' seconds')}
 }
 await page.evaluate(()=>globalThis.__sessionFrames.enabled=false)
 await page.mouse.move(points[0].x,points[0].y,{steps:6});await page.mouse.click(points[0].x,points[0].y);await page.waitForTimeout(300)
 const placed=await page.evaluate(()=>({active:window.__coreInspect.world.active?.id,position:window.__coreInspect.world.vase.position.toArray()}));assert.equal(placed.active,undefined,'Vase placed back on desk')
 const data=await page.evaluate(()=>{const {renderer,scene}=window.__coreInspect,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');const d=globalThis.__sessionFrames;return {frames:d.frames,gpu:d.gpu,environmentCache:scene.userData.deskEnvironmentCache,calibration:scene.userData.runtimeCalibration,gpuName:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}})
 const stats=rows=>{const a=rows.map(r=>r.ms).sort((a,b)=>a-b),p=q=>a[Math.min(a.length-1,Math.floor(a.length*q))];return {count:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:a.at(-1),over100:a.filter(n=>n>100).length}}
 const phases=Object.fromEntries(['orbit','carry','transition'].map(phase=>[phase,{frames:stats(data.frames.filter(r=>r.phase===phase)),gpu:stats(data.gpu.filter(r=>r.phase===phase))}]))
 await page.screenshot({path:resolve(out,sceneId+'-after-session.png')});const report={sceneId,seconds,viewport:[1536,1024],errors,phases,environmentCache:data.environmentCache,gpuName:data.gpuName,calibration:data.calibration,dpr:[...new Set(data.frames.map(r=>r.dpr))],turns,placed,samples:data.frames}
 await writeFile(resolve(out,sceneId+'-session.json'),JSON.stringify(report,null,2)+'\n');delete report.samples;delete report.turns;console.log(JSON.stringify(report,null,2));if(errors.length)throw Error('Browser errors')
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
