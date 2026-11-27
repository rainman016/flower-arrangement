import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {chromium} from '@playwright/test'

const label=process.argv[2]||'candidate',sceneId=process.argv[3]||'bamboo'
const out=resolve(process.env.FLOWER_DELIVERY||'../quality-startup-qa',label)
const root=resolve('dist'),types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.glb':'model/gltf-binary','.bin':'application/octet-stream','.hdr':'application/octet-stream'}
await mkdir(out,{recursive:true})
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname))
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return}
    const file=(await stat(path)).isDirectory()?resolve(path,'index.html'):path
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'})
    res.end(await readFile(file))
  }catch{res.writeHead(404);res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
try{
  browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({viewport:{width:1536,height:1024},deviceScaleFactor:1})
  const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[]
  page.setDefaultTimeout(120000)
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1200))})
  await page.addInitScript(()=>{
    globalThis.flowerCoreReview=true;globalThis.shaderWaits=[]
    const sources=new WeakMap(),attached=new WeakMap(),proto=WebGL2RenderingContext.prototype
    const source=proto.shaderSource,attach=proto.attachShader,log=proto.getProgramInfoLog
    proto.shaderSource=function(shader,text){sources.set(shader,text);return source.call(this,shader,text)}
    proto.attachShader=function(program,shader){const list=attached.get(program)||[];list.push(shader);attached.set(program,list);return attach.call(this,program,shader)}
    proto.getProgramInfoLog=function(program){
      const start=performance.now(),result=log.call(this,program),ms=performance.now()-start
      if(ms>100)globalThis.shaderWaits.push({ms,sources:(attached.get(program)||[]).map(s=>sources.get(s))})
      return result
    }
  })
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:20e6/8,uploadThroughput:5e6/8})
  const started=Date.now()
  await page.goto('http://127.0.0.1:'+server.address().port+(process.env.FLOWER_QUERY||''),{waitUntil:'domcontentloaded'})
  await page.getByRole('group',{name:'选择场景'}).waitFor()
  const selectableMs=Date.now()-started
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start')
  const selection=Date.now()
  await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click()
  await page.locator('main[data-core-ready="true"]').waitFor()
  const readyMs=Date.now()-selection,{profile}=await cdp.send('Profiler.stop')
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),times=new Map()
  for(let i=0;i<(profile.samples?.length||0);i++)times.set(profile.samples[i],(times.get(profile.samples[i])||0)+(profile.timeDeltas[i]||0)/1000)
  const hotspots=[...times].sort((a,b)=>b[1]-a[1]).slice(0,28).map(([id,ms])=>({ms:Math.round(ms),...nodes.get(id).callFrame}))
  await writeFile(resolve(out,sceneId+'.cpuprofile'),JSON.stringify(profile))
  await page.getByRole('button',{name:'开始插花',exact:true}).click()
  await page.getByRole('button',{name:'进入备席',exact:true}).click()
  await page.locator('main[data-stage="prepare"]').waitFor()
  const capture=await page.evaluate(async()=>{
    const {renderer,scene,camera}=window.__coreInspect,env=scene.getObjectByName('nature_environment')
    const view=camera.clone();view.position.set(0,1.472120159550991,1.1414794894642404)
    view.quaternion.set(-.19936793441719716,0,0,.9799247046208296);view.fov=47;view.aspect=1.5
    view.updateProjectionMatrix();view.updateMatrixWorld(true)
    const t=env.userData.natureClock.value;env.userData.natureClock.value=0
    renderer.render(scene,view)
    const image=renderer.domElement.toDataURL('image/png').split(',')[1]
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),p=new Uint8Array(4),samples=[]
    for(let i=0;i<12;i++){
      await new Promise(requestAnimationFrame)
      const at=performance.now();renderer.render(scene,view);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p)
      if(i>1)samples.push(performance.now()-at)
    }
    env.userData.natureClock.value=t
    samples.sort((a,b)=>a-b)
    return {image,serialFrameMedianMs:samples[5],pixelRatio:renderer.getPixelRatio(),antialias:gl.getContextAttributes().antialias,
      gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      resources:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('blob:')).map(r=>({file:r.name.split('/').pop(),startMs:Math.round(r.startTime),durationMs:Math.round(r.duration),bytes:r.transferSize})),
      camera:{position:view.position.toArray(),quaternion:view.quaternion.toArray(),fov:view.fov}}
  })
  await writeFile(resolve(out,sceneId+'-actual.png'),Buffer.from(capture.image,'base64'));delete capture.image
  const waits=await page.evaluate(()=>globalThis.shaderWaits)
  for(let i=0;i<waits.length;i++)await writeFile(resolve(out,sceneId+'-shader-'+i+'.txt'),waits[i].sources.join('\n\n'))
  const report={label,sceneId,networkMbps:20,selectableMs,readyMs,errors,hotspots,shaderWaits:waits.map(w=>({ms:w.ms,lengths:w.sources.map(s=>s.length)})),...capture}
  await writeFile(resolve(out,sceneId+'.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({label,sceneId,selectableMs,readyMs,errors,serialFrameMedianMs:capture.serialFrameMedianMs,gpu:capture.gpu,out,hotspots:hotspots.slice(0,12)},null,2))
  if(errors.length)throw Error('Browser errors')
}finally{await browser?.close();await new Promise(done=>server.close(done))}
