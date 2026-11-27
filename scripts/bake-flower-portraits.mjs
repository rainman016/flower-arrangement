import { chromium } from '@playwright/test'
import { access,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const html=resolve(process.env.FLOWER_DELIVERY??'art/deliverables/five-forms','play.html')
await access(html)
const browser=await chromium.launch({channel:'chrome'})
try{
  const page=await browser.newPage()
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true})
  await page.goto(pathToFileURL(html).href)
  await page.getByRole('button',{name:'竹林清风',exact:true}).click()
  await page.waitForFunction(()=>window.__coreInspect?.world.portraits,null,{timeout:90000})
  const pictures=await page.evaluate(async()=>{
    const entries=Object.entries(window.__coreInspect.world.portraits())
    const samples={}
    for(const [kind,src] of entries){
      const img=new Image();img.src=src;await img.decode()
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height
      canvas.getContext('2d').drawImage(img,0,0)
      samples[kind]=canvas.toDataURL('image/webp',.86)
    }
    return samples
  })
  await writeFile('src/content/flower-thumbnails.json',JSON.stringify(pictures)+'\n')
  console.log('已生成',Object.keys(pictures).length,'张游戏模型缩略图')
}finally{await browser.close()}
