import {chromium} from '@playwright/test'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const out=resolve(process.env.FLOWER_REPORT||'../../art/deliverables/woodland-runtime-v2'),browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(pathToFileURL(resolve(out,'index.html')).href)
 const checks=[]
 for(const scene of ['bamboo','creek']){
  await page.locator('[data-scene="'+scene+'"]').click();assert.equal(await page.locator('#current').getAttribute('src'),'images/'+scene+'-front.png')
  for(const direction of ['front','front-right','right','back-right','back','back-left','left','front-left']){
   await page.locator('[data-direction="'+direction+'"]').click();await page.locator('#orbit').evaluate(img=>img.decode());assert.equal(await page.locator('#orbit').getAttribute('src'),'images/'+scene+'-'+direction+'.png')
  }
  const broken=await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(i=>i.decode()));return images.filter(i=>!i.naturalWidth).map(i=>i.src)});assert.deepEqual(broken,[])
  assert.equal(await page.locator('#metrics tr').count(),8);checks.push({scene,images:true,directions:8,metrics:8})
 }
 await page.setViewportSize({width:390,height:844});await page.reload();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No narrow-screen horizontal overflow')
 assert.deepEqual(errors,[])
 const directions=['front','front-right','right','back-right','back','back-left','left','front-left'],labels=['正前','右前','右侧','右后','正后','左后','左侧','左前']
 const gallery='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>两景环视总览</title><style>body{margin:0;background:#f3f1e9;color:#213a30;font:16px system-ui}main{padding:18px}h2{margin:12px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}figure{margin:0}img{width:100%;display:block}figcaption{padding:4px}</style><main>'+['bamboo','creek'].map(scene=>'<h2>'+(scene==='bamboo'?'竹林':'溪畔')+' · 自动画质实拍</h2><div class="grid">'+directions.map((d,i)=>'<figure><img src="images/'+scene+'-'+d+'.png"><figcaption>'+labels[i]+'</figcaption></figure>').join('')+'</div>').join('')+'</main>'
 await writeFile(resolve(out,'orbit-gallery.html'),gallery)
 await page.setViewportSize({width:1920,height:1440});await page.goto(pathToFileURL(resolve(out,'orbit-gallery.html')).href);await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));await page.screenshot({path:resolve(out,'orbit-overview.png'),fullPage:true})
 await writeFile(resolve(out,'records/report-ui.json'),JSON.stringify({checks,narrowScreen:true,errors},null,2)+'\n');console.log(JSON.stringify({checks,narrowScreen:true,errors,browserClosedOnExit:true}))
}finally{await browser.close()}
