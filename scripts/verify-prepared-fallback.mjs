import {preview} from 'vite'
import {chromium} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const manifest=JSON.parse(await readFile('public/assets/manifest.json','utf8')),out=resolve(process.env.FLOWER_DELIVERY||'../runtime-qa','prepared-fallback'),server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});let browser
await mkdir(out,{recursive:true})
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const report=[]
 for(const [sceneId,mode]of [['bamboo','missing-pack'],['creek','missing-image'],['bamboo','resize'],['creek','missing-fallback']]){
  const context=await browser.newContext({viewport:{width:1536,height:1024}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(120000)
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Shader Error|THREE.WebGLProgram|WebGL: INVALID/.test(m.text()))errors.push(m.text())})
  const prepared=manifest.assets.find(a=>a.id==='prepared-'+sceneId)
  if(mode!=='resize'){const file=mode==='missing-pack'?prepared.file:manifest.assets.find(a=>a.id===prepared.preparedTextures[0]).file;await page.route('**/'+file,route=>route.fulfill({status:404,body:'test missing optional resource'}))}
  if(mode==='missing-fallback')await page.route('**/'+manifest.assets.find(a=>a.id==='nature-kit').file,route=>route.fulfill({status:404,body:'test missing fallback resource'}))
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('button',{name:sceneId==='bamboo'?'竹林清风':'溪畔观流',exact:true}).click()
  if(mode==='missing-fallback'){
   await page.getByRole('alert').filter({hasText:'花席未能载入'}).waitFor();await page.getByRole('group',{name:'选择场景'}).waitFor()
   await page.unrouteAll();await page.getByRole('button',{name:'溪畔观流',exact:true}).click()
   if(await page.getByRole('button',{name:'开启新花席',exact:true}).count())await page.getByRole('button',{name:'开启新花席',exact:true}).click()
  }
  await page.locator('main[data-core-ready="true"]').waitFor()
  const state=await page.evaluate(()=>{const {scene}=window.__coreInspect;return {prepared:scene.getObjectByName('nature_environment').userData.preparedNature===true,ready:scene.userData.runtimeTimings.ready,start:scene.userData.runtimeTimings.start}})
  assert.equal(state.prepared,mode==='resize')
  if(mode==='resize'){await page.setViewportSize({width:1200,height:800});await page.waitForTimeout(700);const next=await page.evaluate(()=>window.__coreInspect.scene.userData.runtimeTimings);assert.equal(next.start,state.start);assert.equal(next.ready,state.ready);await page.getByRole('button',{name:'开始插花',exact:true}).click();await page.locator('main[data-stage="opening"]').waitFor()}
  assert.equal(errors.length,0,errors.join('\n'));report.push({sceneId,mode,passed:true,state});console.log(JSON.stringify(report.at(-1)));await context.close()
 }
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n')
}finally{await browser?.close();await new Promise(done=>server.httpServer.close(done))}
