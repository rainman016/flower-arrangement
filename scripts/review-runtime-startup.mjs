import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {chromium} from '@playwright/test'
const label=process.argv[2]||'candidate',sceneId=process.argv[3]||'bamboo',out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa',label)
await mkdir(out,{recursive:true})
const root=resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}
const server=createServer(async(req,res)=>{
 try{
  const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(p!==root&&!p.startsWith(root+sep)){res.writeHead(403);res.end();return}
  const file=(await stat(p)).isDirectory()?resolve(p,'index.html'):p
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public,max-age=600'});res.end(await readFile(file))
 }catch{res.writeHead(404);res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const runs=[],errors=[]
 for(let i=0;i<Number(process.env.FLOWER_RUNS||3);i++){
  const context=await browser.newContext({viewport:{width:1536,height:1024},deviceScaleFactor:1}),page=await context.newPage(),cdp=await context.newCDPSession(page)
  page.setDefaultTimeout(180000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR '+e.message)});page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1200))})
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true})
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:20e6/8,uploadThroughput:5e6/8})
  for(const cache of i===0?['cold','warm']:['cold']){
   const started=Date.now();await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.getByRole('group',{name:'选择场景'}).waitFor()
   const selectableMs=Date.now()-started,selection=Date.now();await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click();if(await page.getByRole('button',{name:'开启新花席',exact:true}).count())await page.getByRole('button',{name:'开启新花席',exact:true}).click();await page.locator('main[data-core-ready="true"]').waitFor({timeout:45000}).catch(async error=>{
    console.log(JSON.stringify({errors,state:await page.evaluate(()=>({text:document.body.innerText.slice(-1000),timing:window.__coreInspect?.scene.userData.runtimeTimings,programs:window.__coreInspect?.renderer.info.programs.length,resources:performance.getEntriesByType('resource').slice(-6).map(r=>({file:r.name.split('/').pop(),ms:r.duration}))}))}));throw error
   })
   const readyMs=Date.now()-selection,detail=await page.evaluate(()=>{
    const {renderer,scene}=window.__coreInspect,gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {timing:scene.userData.runtimeTimings,calibration:scene.userData.runtimeCalibration,dpr:renderer.getPixelRatio(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),prepared:scene.getObjectByName('nature_environment').userData.preparedNature===true,resources:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('blob:')).map(r=>({file:r.name.split('/').pop(),bytes:r.transferSize,duration:r.duration}))}
   })
   const row={run:i+1,cache,selectableMs,readyMs,...detail};runs.push(row);console.log(JSON.stringify({run:i+1,cache,selectableMs,readyMs,dpr:row.dpr,calibration:row.calibration,prepared:row.prepared,timing:row.timing}))
   if(i===0&&cache==='cold'){
    await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.getByRole('button',{name:'准备花材',exact:true}).click();await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click();await page.locator('main[data-stage="prepare"]').waitFor();await page.waitForTimeout(2000)
    await page.screenshot({path:resolve(out,sceneId+'-gameplay.png')})
   }
  }
  await context.close()
 }
 const cold=runs.filter(r=>r.cache==='cold').map(r=>r.readyMs).sort((a,b)=>a-b),report={sceneId,networkMbps:20,latencyMs:40,viewport:[1536,1024],note:'Fresh browser contexts for cold network cache; browser/driver shader caching is not disabled. Same context reload for warm cache. No CPU profiler or synchronous readback during timing.',coldMedian:cold[Math.floor(cold.length/2)],coldMax:cold.at(-1),runs,errors}
 await writeFile(resolve(out,sceneId+'-startup.json'),JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error(errors.join('\n'))
}finally{await browser?.close();await new Promise(done=>server.close(done))}
