import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa','warmup-failure'),server=await preview({preview:{host:'127.0.0.1',port:0,open:false}})
await mkdir(out,{recursive:true});let browser
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[]
 page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('场景材质编译失败'))errors.push(m.text().slice(0,1500))})
 await page.addInitScript(()=>{
  globalThis.flowerCoreReview=true
  if(sessionStorage.getItem('flower-test-valid-shader'))return
  const source=WebGL2RenderingContext.prototype.shaderSource
  WebGL2RenderingContext.prototype.shaderSource=function(shader,text){return source.call(this,shader,text+'\n#error FLOWER_INTENTIONAL_SHADER_FAILURE\n')}
 })
 await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:'竹林清风',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'花席暂时无法显示'}).waitFor()
 assert.equal(await page.locator('main[data-core-ready="true"]').count(),0,'Failed shaders cannot report a ready scene')
 assert.ok(errors.some(e=>e.includes('场景材质编译失败')),'The explicit link validator reported the actual failure')
 await page.evaluate(()=>sessionStorage.setItem('flower-test-valid-shader','1'));await page.getByRole('button',{name:'重新载入',exact:true}).click()
 await page.getByRole('button',{name:'竹林清风',exact:true}).click();if(await page.getByRole('button',{name:'开启新花席',exact:true}).count())await page.getByRole('button',{name:'开启新花席',exact:true}).click()
 await page.locator('main[data-core-ready="true"]').waitFor()
 const restored=await page.evaluate(()=>window.__coreInspect.renderer.debug.checkShaderErrors);assert.equal(restored,true)
 const report={failedSafely:true,retryReady:true,checksRestored:restored,explicitFailureReported:true}
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
