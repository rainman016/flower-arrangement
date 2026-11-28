import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {chromium} from '@playwright/test'
import {gzipSync} from 'node:zlib'
const label=process.argv[2]||'candidate',sceneId=process.argv[3]||'bamboo',out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa',label)
await mkdir(out,{recursive:true})
const root=resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}
const server=createServer(async(req,res)=>{
 try{
  const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(p!==root&&!p.startsWith(root+sep)){res.writeHead(403);res.end();return}
  const file=(await stat(p)).isDirectory()?resolve(p,'index.html'):p
  const compressed=/\.(js|css|html|json|glb|hdr)$/.test(file)&&/gzip/.test(req.headers['accept-encoding']||''),raw=await readFile(file),body=compressed?gzipSync(raw):raw
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':body.length,...(compressed?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{}),'Connection':'close','Cache-Control':extname(file)==='.html'?'no-cache':'public,max-age=600'});res.end(body)
 }catch{res.writeHead(404);res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const runs=[],errors=[]
 for(let i=0;i<Number(process.env.FLOWER_RUNS||3);i++){
  const context=await browser.newContext({viewport:{width:1536,height:1024},deviceScaleFactor:1}),page=await context.newPage(),cdp=await context.newCDPSession(page)
  const browserSetupStart=Date.now()
  // Initialize Chrome's first blank-document compositor before navigation timing.
  // No application code, asset, WebGL context or shader is loaded by this step.
  await page.evaluate(()=>new Promise(done=>{
   const dot=document.createElement('div');Object.assign(dot.style,{width:'1px',height:'1px',background:'white'});document.body.appendChild(dot)
   requestAnimationFrame(()=>requestAnimationFrame(()=>{dot.remove();done()}))
  }))
  const browserSetupMs=Date.now()-browserSetupStart
  const pending=new Map();page.on('request',r=>pending.set(r,Date.now()));page.on('requestfinished',r=>pending.delete(r));page.on('requestfailed',r=>pending.delete(r))
  page.setDefaultTimeout(180000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR '+e.message)});page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1200))})
  await page.addInitScript(()=>{
   globalThis.flowerCoreReview=true;globalThis.flowerLoadingImages=[]
   globalThis.flowerReadyAt=0;globalThis.flowerSelectorAt=0;globalThis.flowerSelectionAt=0;let selectorPaint=false
   document.addEventListener('click',event=>{
    const button=event.target.closest?.('button')
    if(button?.closest('.scene-entry')&&(button.matches('.scene-entry-card,.scene-entry-primary')||button.getAttribute('aria-label')==='继续上次花席'))globalThis.flowerSelectionAt=Date.now()
   },true)
   // Timestamp the actual committed ready UI and a completed paint, rather
   // than the later Playwright selector polling response. Keep both readings.
   const readyObserver=new MutationObserver(()=>{
    if(!selectorPaint&&document.querySelector('[role="group"][aria-label="选择场景"]')){
     selectorPaint=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{globalThis.flowerSelectorAt=Date.now()}))
    }
    if(!document.querySelector('main[data-core-ready="true"]'))return
    readyObserver.disconnect()
    requestAnimationFrame(()=>requestAnimationFrame(()=>{globalThis.flowerReadyAt=Date.now()}))
   })
   readyObserver.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-core-ready']})
   const create=document.createElementNS.bind(document)
   document.createElementNS=(ns,name,...args)=>{const element=create(ns,name,...args);if(name==='img')flowerLoadingImages.push(new WeakRef(element));return element}
  })
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditionsByRule',{offline:false,matchedNetworkConditions:[{urlPattern:'',latency:40,downloadThroughput:20e6/8,uploadThroughput:5e6/8}]})
  for(const cache of ['cold','warm']){
   if(process.env.FLOWER_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start')}
   const started=Date.now();await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.getByRole('group',{name:'选择场景'}).waitFor()
   await page.waitForFunction(()=>globalThis.flowerSelectorAt>0)
   const observedSelectableMs=Date.now()-started,selectableMs=await page.evaluate(()=>globalThis.flowerSelectorAt)-started,selection=Date.now();await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();if(await page.getByRole('button',{name:'开启新花席',exact:true}).count())await page.getByRole('button',{name:'开启新花席',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor({timeout:45000}).catch(async error=>{
    const failure={errors,pending:[...pending].map(([r,t])=>({file:r.url().split('/').pop(),ms:Date.now()-t})),state:await page.evaluate(()=>({text:document.body.innerText.slice(-1000),timing:window.__coreInspect?.scene.userData.runtimeTimings,programs:window.__coreInspect?.renderer.info.programs.length,images:flowerLoadingImages.map(ref=>ref.deref()).filter(Boolean).filter(i=>!i.complete||!i.naturalWidth).map(i=>({file:i.src.startsWith('data:')?'embedded':i.src.split('/').pop(),complete:i.complete,width:i.naturalWidth})),resources:performance.getEntriesByType('resource').slice(-6).map(r=>({file:r.name.split('/').pop(),ms:r.duration}))}))}
    await writeFile(resolve(out,sceneId+'-failure.json'),JSON.stringify(failure,null,2));console.log(JSON.stringify(failure));throw error
   })
   await page.waitForFunction(()=>globalThis.flowerReadyAt>0)
   const observedReadyMs=Date.now()-selection,readyMs=await page.evaluate(()=>globalThis.flowerReadyAt-globalThis.flowerSelectionAt),detail=await page.evaluate(()=>{
    const {renderer,scene}=window.__coreInspect,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {marks:performance.getEntriesByType('mark').filter(m=>m.name.startsWith('flower:')).map(m=>({name:m.name,ms:m.startTime})),programs:scene.userData.runtimePrograms,timing:scene.userData.runtimeTimings,calibration:scene.userData.runtimeCalibration,dpr:renderer.getPixelRatio(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),prepared:scene.getObjectByName('nature_environment').userData.preparedNature===true,resources:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('blob:')).map(r=>({file:r.name.split('/').pop(),bytes:r.transferSize,duration:r.duration}))}
   })
   if(process.env.FLOWER_PROFILE){
    const {profile}=await cdp.send('Profiler.stop');await writeFile(resolve(out,sceneId+'-'+cache+'-'+i+'.cpuprofile'),JSON.stringify(profile))
    const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),times=new Map()
    profile.samples.forEach((id,i)=>times.set(id,(times.get(id)||0)+(profile.timeDeltas[i]||0)))
    console.log(JSON.stringify({cpu:cache,top:[...times].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,us])=>({name:nodes.get(id)?.functionName,file:nodes.get(id)?.url.split('/').pop(),ms:Math.round(us/1000)}))}))
   }
   const row={run:i+1,cache,browserSetupMs,selectableMs,observedSelectableMs,readyMs,observedReadyMs,...detail};runs.push(row);console.log(JSON.stringify({run:i+1,cache,browserSetupMs,selectableMs,observedSelectableMs,readyMs,observedReadyMs,dpr:row.dpr,calibration:row.calibration,prepared:row.prepared,timing:row.timing}))
   if(i===0&&cache==='cold'){
    await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.locator('main[data-stage="prepare"]').waitFor();await page.waitForTimeout(2000)
    await page.screenshot({path:resolve(out,sceneId+'-gameplay.png')})
   }
  }
  await context.close()
 }
 const cold=runs.filter(r=>r.cache==='cold').map(r=>r.readyMs).sort((a,b)=>a-b),report={sceneId,networkMbps:20,latencyMs:40,viewport:[1536,1024],note:'A blank-document compositor paint precedes navigation; browserSetupMs records that excluded browser initialization, with no game code/assets/WebGL preloaded. Production gzip for scripts, models and HDR; current request-rule throttling. Fresh browser contexts for cold network cache; browser/driver shader caching is not disabled. Same context reload for warm cache. readyMs runs from the actual final entry-confirmation click to the committed ready UI after two animation frames. selectableMs also waits for selector paint. observedReadyMs and observedSelectableMs retain automation elapsed time, including actionability, confirmation and polling waits. '+(process.env.FLOWER_PROFILE?'CPU profiler enabled: diagnostic only, not a performance acceptance run.':'No CPU profiler or synchronous readback during timing.'),coldMedian:cold[Math.floor(cold.length/2)],coldMax:cold.at(-1),runs,errors}
 await writeFile(resolve(out,sceneId+'-startup.json'),JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error(errors.join('\n'))
}finally{await browser?.close();await new Promise(done=>server.close(done))}
