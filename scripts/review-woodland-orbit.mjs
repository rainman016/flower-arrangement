import {createServer} from 'node:http'
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {chromium} from '@playwright/test'
import {CustomBlending,OneFactor,ZeroFactor} from 'three'
import assert from 'node:assert/strict'

const label=process.argv[2]||'candidate',quality=process.argv[3]||'default'
const alphaProbe=process.argv.includes('--probe-alpha')
const out=resolve(process.env.FLOWER_DELIVERY||'../../art/deliverables/woodland-orbit-v1',label)
const root=resolve('dist'),types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary','.bin':'application/octet-stream','.hdr':'application/octet-stream'}
await mkdir(out,{recursive:true})
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname))
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return}
    const file=(await stat(path)).isDirectory()?resolve(path,'index.html'):path
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file))
  }catch{res.writeHead(404);res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser,page
try{
  browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({viewport:{width:1536,height:1024},deviceScaleFactor:1})
  page=await context.newPage()
  const cdp=await context.newCDPSession(page),errors=[]
  page.setDefaultTimeout(180000)
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text().slice(0,1200))})
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true})
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:20e6/8,uploadThroughput:5e6/8})
  const started=Date.now(),query=quality==='default'?'':'?quality='+quality
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+query,{waitUntil:'domcontentloaded'})
  await page.getByRole('group',{name:'选择场景'}).waitFor()
  const selectableMs=Date.now()-started,selection=Date.now()
  await page.getByRole('button',{name:'竹林清风',exact:true}).click()
  await page.locator('main[data-core-ready="true"]').waitFor()
  const readyMs=Date.now()-selection
  const turns=[]
  if(!alphaProbe&&quality!=='full'){
    const before=await page.evaluate(()=>window.__coreInspect.camera.quaternion.toArray())
    for(let i=0;i<8;i++){
      await page.mouse.move(1280,600);await page.mouse.down()
      await page.mouse.move(1280-Math.PI/4/.005,600,{steps:5});await page.mouse.up()
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
      turns.push(await page.evaluate(()=>window.__coreInspect.camera.quaternion.toArray()))
    }
    const dot=(a,b)=>Math.abs(a.reduce((v,n,i)=>v+n*b[i],0))
    assert.ok(dot(before,turns[7])>.999,'完整鼠标环视后回到原朝向')
    assert.ok(dot(before,turns[3])<.05,'鼠标环视实际经过背面')
    await page.waitForTimeout(800)
  }
  if(alphaProbe)await page.evaluate(({CustomBlending,OneFactor,ZeroFactor})=>{
    window.__coreInspect.scene.getObjectByName('woodland_distance_surfaces').traverse(o=>{
      if(!o.isMesh||!o.material.uniforms?.image)return
      Object.assign(o.material,{blending:CustomBlending,blendSrc:OneFactor,blendDst:ZeroFactor,blendSrcAlpha:ZeroFactor,blendDstAlpha:OneFactor,needsUpdate:true})
    })
  },{CustomBlending,OneFactor,ZeroFactor})
  const arrival=await page.evaluate(()=>window.__coreInspect.camera.position.toArray())
  const views=[]
  async function capture(name,yaw,eye,pitch=-.30){
    const result=await page.evaluate(async({yaw,eye,pitch})=>{
      const {renderer,scene,camera}=window.__coreInspect,env=scene.getObjectByName('nature_environment')
      const view=camera.clone();view.position.fromArray(eye);view.fov=47;view.aspect=1.5
      const angle=yaw*Math.PI/180,aim=view.position.clone().add({x:Math.sin(angle),y:pitch,z:-Math.cos(angle)})
      view.lookAt(aim);view.updateProjectionMatrix();view.updateMatrixWorld(true)
      const clock=env.userData.natureClock.value;env.userData.natureClock.value=0
      renderer.render(scene,view)
      const image=renderer.domElement.toDataURL('image/png').split(',')[1]
      const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
      env.userData.natureClock.value=clock
      return {image,eye,quaternion:view.quaternion.toArray(),fov:view.fov,yaw,pitch,
        gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
        pixelRatio:renderer.getPixelRatio(),antialias:gl.getContextAttributes().antialias,
        calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}
    },{yaw,eye,pitch})
    await writeFile(resolve(out,name+'.png'),Buffer.from(result.image,'base64'));delete result.image
    views.push({name,...result});console.log('已记录 '+name)
  }
  const dirs=[['front',0],['front-right',45],['right',90],['back-right',135],['back',180],['back-left',225],['left',270],['front-left',315]]
  if(quality!=='full')for(const [name,yaw] of dirs.filter((_,i)=>alphaProbe?i===2:i%2===0))await capture('arrival-'+name,yaw,arrival)
  await page.getByRole('button',{name:'开始插花',exact:true}).click()
  await page.locator('main[data-stage="opening"]').waitFor()
  if(await page.getByRole('button',{name:'准备花材',exact:true}).count()){
    await page.getByRole('button',{name:'准备花材',exact:true}).click()
    await page.getByRole('button',{name:'用这些花材开始备席',exact:true}).click()
  }else await page.getByRole('button',{name:'进入备席',exact:true}).click()
  await page.locator('main[data-stage="prepare"]').waitFor()
  const eye=[0,1.472120159550991,1.1414794894642404]
  for(const [name,yaw] of dirs.filter((_,i)=>alphaProbe?i===0||i===2:quality!=='full'||i%2===0))await capture(name,yaw,eye,-.424088)
  const diagnostic=await page.evaluate(()=>{
    const {scene,renderer}=window.__coreInspect,env=scene.getObjectByName('nature_environment'),meshes=[]
    env.traverse(o=>{if(o.isMesh&&/rock|stone|bamboo_outer|woodland_distance/.test(o.name))meshes.push({name:o.name,visible:o.visible,count:o.count,position:o.position.toArray()})})
    return {meshes,planting:env.userData.bambooSurround,stoneContact:env.userData.bambooStoneContact,programs:renderer.info.programs.length,geometry:renderer.info.memory.geometries,
      resources:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith('blob:')).map(r=>({file:r.name.split('/').pop(),bytes:r.transferSize,durationMs:r.duration}))}
  })
  await writeFile(resolve(out,'verification.json'),JSON.stringify({label,quality,selectableMs,readyMs,networkMbps:20,arrival,errors,mouseOrbit:turns,views,...diagnostic},null,2)+'\n')
  console.log(JSON.stringify({out,quality,selectableMs,readyMs,errors,views:views.length}))
  if(errors.length)throw Error('环视检查出现渲染错误')
}catch(error){
  if(page){
    await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{})
    const state=await page.evaluate(()=>({stage:document.querySelector('main')?.dataset.stage,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent)})).catch(()=>null)
    await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),state},null,2))
  }
  throw error
}finally{await browser?.close();await new Promise(done=>server.close(done))}
