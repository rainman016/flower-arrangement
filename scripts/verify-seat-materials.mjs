import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
import {deskMouseTargets,visibleDeskPoint} from './desk-mouse-targets.mjs'
const output=resolve(process.env.FLOWER_DELIVERY??'art/deliverables/five-forms')
const browser=await chromium.launch({channel:'chrome'})
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{globalThis.flowerCoreReview=true})
  await page.goto(process.argv[2]??pathToFileURL(resolve(output,'play.html')).href)
  const button=name=>page.getByRole('button',{name,exact:true})
  const ready=()=>page.locator('main[data-core-ready="true"]').waitFor({timeout:120000})
  const flowers=()=>page.evaluate(()=>window.__coreInspect.read().history.present.flowers)
  await button('溪畔观流').click();await ready();await button('开始插花').click();await button('准备花材').click()
  await button('花材库').click();await page.setViewportSize({width:390,height:844})
  for(const [section,kind] of [['线条花材','雪柳'],['花材','金盏花'],['山野花材','山野叶枝三']]){
    await button(section).click();await button('添加'+kind).click()
  }
  await page.screenshot({path:resolve(output,'library-phone.png')})
  await button('选好了').click()
  await page.setViewportSize({width:1280,height:800});await button('用这些花材开始备席').click()
  const selection=await flowers()
  assert.deepEqual(selection.slice(-3).map(f=>f.kind),['snow-willow','calendula','wild-frond'])
  assert.ok(await button('本席花材已定').isDisabled())
  await button('重新备席').click();await button('确认重新备席').click()
  assert.deepEqual(await flowers(),selection)
  await page.reload();await button('继续上次花席').click();await ready()
  assert.deepEqual(await flowers(),selection)
  const mat=await page.evaluate(()=>{
    const a=window.__coreInspect, mesh=a.world.table.getObjectByName('seat-mat')
    const b=new a.Box3().setFromObject(mesh)
    return {left:b.min.x,right:b.max.x,back:b.min.z,front:b.max.z}
  })
  assert.ok(mat.left>-.41 && mat.right<.41 && mat.front<.48 && mat.back>.13)
  await page.screenshot({path:resolve(output,'seat-mat.png')})
  const placements=[]
  for(const [id,x,z] of [['vase',-.09,.36],['scissors',.18,.335],['f-1',-.235,.312],['vase',.48,.42]]){
    const grip=await visibleDeskPoint(page,id)
    assert.ok(grip,'visible grip '+id)
    const [target]=await deskMouseTargets(page,id,grip,[[x,z]],id.startsWith('f-'))
    await page.mouse.click(grip.x,grip.y);await page.waitForTimeout(330)
    await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.click(target.x,target.y);await page.waitForTimeout(600)
    const position=await page.evaluate(id=>{
      const a=window.__coreInspect,root=a.world.flowers.get(id)??a.world[id]
      const surface=root.getObjectByName('botanical-'+id)??root
      surface.updateWorldMatrix(true,true)
      const p=new a.Vector3(),bounds=new a.Box3()
      surface.traverseVisible(mesh=>{
        if(!mesh.isMesh||mesh.material?.opacity===0)return
        const points=mesh.geometry.getAttribute('position')
        for(let i=0;i<points.count;i++)bounds.expandByPoint(p.fromBufferAttribute(points,i).applyMatrix4(mesh.matrixWorld))
      })
      return {minX:bounds.min.x,maxX:bounds.max.x,minZ:bounds.min.z,maxZ:bounds.max.z,base:bounds.min.y}
    },id)
    assert.ok(Math.abs(position.base-.758)<.002,id+' rests on the work surface')
    const onMat=x<mat.right
    assert.ok(onMat
      ? position.minX>=mat.left && position.maxX<=mat.right && position.minZ>=mat.back && position.maxZ<=mat.front
      : position.minX>mat.right && position.maxZ>.37 && position.maxZ<.49,
      id+' placed on '+(onMat?'cloth':'wood')+' '+JSON.stringify(position))
    placements.push({id,onMat,...position})
    if(placements.length===3)await page.screenshot({path:resolve(output,'cloth-placements.png')})
  }
  assert.deepEqual(errors,[])
  await writeFile(resolve(output,'seat-materials-check.json'),JSON.stringify({selection:selection.map(f=>f.kind),mat,placements,errors},null,2))
  console.log('开场新花材、窄屏、锁定/恢复、三件实物放上小席布、花瓶移到旁边木面：通过',placements)
}finally{await browser.close()}
