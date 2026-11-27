import {deskMouseTargets,visibleDeskPoint} from './desk-mouse-targets.mjs'
import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
const dir=resolve(process.env.FLOWER_DELIVERY || 'art/deliverables/five-forms')
const build=JSON.parse(await readFile(resolve(dir,'build.json'),'utf8'))
const url=pathToFileURL(resolve(dir,'play.html'));url.searchParams.set('build',build.sha256.slice(0,12))
const browser=await chromium.launch({channel:'chrome',headless:true})
const measurements=[]
try{
  const ctx=await browser.newContext({viewport:{width:1000,height:590},recordVideo:{dir:tmpdir(),size:{width:1000,height:590}}}),page=await ctx.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{window.flowerCoreReview=true})
  await page.goto(url.href);await page.getByRole('button',{name:'竹林清风',exact:true}).click();await page.getByRole('button',{name:'开始插花',exact:true}).click({timeout:60000});await page.getByRole('button',{name:'准备花材'}).click();await page.getByRole('button',{name:'用这些花材开始备席'}).click()
  await page.waitForTimeout(550)
  const position=id=>page.evaluate(id=>{
    const a=window.__coreInspect,o=a.world.flowers.get(id)||a.world[id]
    const v=o.getWorldPosition(new a.Vector3())
    return {x:v.x,y:v.y,z:v.z,active:a.world.active?.id}
  },id)
  // Actual screen pixels picked from the 1000 × 590 desk, the same size as the reported view.
  const crowns=await page.evaluate(()=>{
    const a=window.__coreInspect
    return a.read().history.present.flowers.map(f=>{
      const main=a.world.flowers.get(f.id).getObjectByName('flower-crown').children[0]
      const box=new a.Box3().setFromObject(main),p=box.getCenter(new a.Vector3()).project(a.camera)
      return {id:f.id,height:box.max.y,x:Math.round((1+p.x)*innerWidth/2),y:Math.round((1-p.y)*innerHeight/2)}
    })
  })
  console.log('crowns',crowns)
  assert.ok(crowns[1].height-crowns[0].height>.024&&crowns[2].height-crowns[1].height>.045,'three height tiers')
  const spots=[['vase',432,322],['cup',500,332],['scissors',566,343],...crowns.map(c=>[c.id,c.x,c.y])]
  for(const [id,x,y] of spots){
    const before=await position(id)
    const field=await deskMouseTargets(page,id,{x,y},[[.19,.11],[-.22,-.15],[-.34,.18]])
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+2,y+1);await page.mouse.up()
    if(id==='cup'){
      // Begin the drift measurement at the end of the lift, with finer precision than its 0.1 mm tolerance.
      await page.waitForFunction(y=>Math.abs(window.__coreInspect.world.cup.position.y-y)<.000001,before.y+.08,{timeout:2000})
    }else await page.waitForTimeout(70)
    const picked=await position(id),expected=id.startsWith('f-')?.12:.08
    assert.equal(picked.active,id,'picked '+id)
    assert.ok(Math.abs(picked.y-before.y-expected)<.001,'automatic lift '+id)
    const moved=[]
    for(const {x:px,y:py} of [...field,{x:986,y:250},field[0]]){
      await page.mouse.move(px,py,{steps:6});await page.waitForTimeout(60)
      moved.push(await position(id))
    }
    for(const [i,[x,z]] of [[.19,.11],[-.22,-.15],[-.34,.18]].entries())
      assert.ok(Math.hypot(moved[i].x-x,moved[i].z-z)<.01,'reached physical target '+i+' '+id+' '+JSON.stringify(moved[i]))
    const excursion=Math.max(...moved.map(p=>Math.abs(p.y-picked.y)))
    assert.ok(moved.every(p=>p.active===id&&Math.abs(p.x)<=.601&&p.z>=-.501&&p.z<=.371)&&excursion<.0001,'fixed carry height and desk bounds '+id+' '+JSON.stringify({picked,moved,excursion}))
    assert.ok(moved[0].x-moved[1].x>.13&&moved[0].z-moved[1].z>.13&&moved[2].z>moved[1].z+.18,'mouse can move left/right and front/back '+id)
    assert.ok(Math.hypot(moved[4].x-moved[0].x,moved[4].z-moved[0].z)<.002,'return to same tabletop point '+id)
    if(id==='vase')await page.screenshot({path:resolve(dir,'vase-lifted.png')})
    await page.keyboard.press('Escape');await page.waitForTimeout(260)
    const returned=await position(id)
    assert.ok(Math.hypot(returned.x-before.x,returned.y-before.y,returned.z-before.z)<.002,'cancel returns to source '+id)
    measurements.push({id,liftCm:Math.round(100*(picked.y-before.y)),heightDriftMm:excursion*1000,sideTravelCm:Math.round(100*(moved[0].x-moved[1].x)),depthTravelCm:Math.round(100*(moved[2].z-moved[1].z))})
    console.log(id,measurements.at(-1))
  }
  // Use three distinct visible points on the bare left side, in front of the box.
  for(const [i,[id,x,y]] of spots.slice(3).entries()){
    const [p]=await deskMouseTargets(page,id,{x,y},[[-.44+i*.085,-.045+i*.035]],true)
    const destination=[p.x,p.y]
    await page.mouse.click(x,y)
    await page.mouse.move(...destination,{steps:8})
    const predicted=await page.evaluate(id=>{
      const root=window.__coreInspect.world.flowers.get(id)
      const ghost=root.parent.children.find(o=>o.name==='botanical-'+id&&o.visible)
      return ghost&&[...ghost.position.toArray(),...ghost.quaternion.toArray()]
    },id)
    assert.ok(predicted,'visible landing preview '+id)
    await page.mouse.click(...destination)
    await page.waitForFunction(({id,predicted})=>{
      const root=window.__coreInspect.world.flowers.get(id),q=root.quaternion
      // A quaternion and its negative encode exactly the same orientation.
      const dot=q.x*predicted[3]+q.y*predicted[4]+q.z*predicted[5]+q.w*predicted[6]
      return root.position.toArray().every((n,i)=>Math.abs(n-predicted[i])<.00001)&&Math.abs(dot)>1-1e-9
    },{id,predicted},{timeout:2500})
    assert.equal(await page.evaluate(id=>window.__coreInspect.read().history.present.flowers.find(f=>f.id===id).location,id),'table')
  }
  const contact=()=>page.evaluate(()=>{
    const a=window.__coreInspect,desk=new a.Box3().setFromObject(a.world.table).max.y
    return a.read().history.present.flowers.map(f=>{
      const root=a.world.flowers.get(f.id),model=root.getObjectByName('botanical-'+f.id)
      let min=Infinity,nearBase=Infinity,midStem=Infinity,nearHead=Infinity;const v=new a.Vector3(),local=new a.Vector3()
      model.updateWorldMatrix(true,true)
      for(const part of model.children)part.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){
        v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);min=Math.min(min,v.y)
        root.worldToLocal(local.copy(v))
        if(part.name==='part-stem'&&local.y<f.length*.05)nearBase=Math.min(nearBase,v.y)
        if(part.name==='part-stem'&&local.y>f.length*.4&&local.y<f.length*.56)midStem=Math.min(midStem,v.y)
        if(part.name==='flower-crown')nearHead=Math.min(nearHead,v.y)
      }}})
      const crown=model.getObjectByName('flower-crown').getWorldPosition(new a.Vector3())
      return {id:f.id,gapMm:(min-desk)*1000,baseGapMm:(nearBase-desk)*1000,midStemGapMm:(midStem-desk)*1000,headGapMm:(nearHead-desk)*1000,headAwayCm:100*(root.position.z-crown.z)}
    })
  })
  const contacts=await contact();console.log('contact',contacts)
  function checkRest(flowers){
    for(const f of flowers){
      assert.ok(f.gapMm>=-.1&&f.gapMm<.8,'contact '+f.id)
      assert.ok(f.headAwayCm>20,'flower points into the desk '+f.id)
      assert.ok(f.baseGapMm<2.5&&f.midStemGapMm<2.5&&f.headGapMm<2.5,'wood supports shaft and crown '+f.id)
    }
  }
  checkRest(contacts)
  const tablePickups=[]
  for(const {id} of contacts){
    const before=await position(id)
    const grip=await visibleDeskPoint(page,id,'part-stem')
    assert.ok(grip,'visible resting stem '+id)
    const [site]=await deskMouseTargets(page,id,grip,[[before.x+.10,before.z-.06]])
    await page.mouse.click(grip.x,grip.y);await page.waitForTimeout(90)
    const lifted=await position(id)
    if(lifted.active!==id){
      console.log('resting pick',id,grip,before,lifted,await page.evaluate(({id,grip})=>{
        const a=window.__coreInspect,target=document.elementFromPoint(grip.x,grip.y),ray=new a.Raycaster()
        const roots=[a.world.cup,a.world.vase,a.world.scissors,...a.world.flowers.values()]
        return {element:target?.tagName,classes:target?.className,state:a.world.active,stage:a.read().ritual.stage,hits:[[0,0],[4,0],[-4,0],[0,4],[0,-4],[6,4],[-6,4]].map(([dx,dy])=>{
          ray.setFromCamera({x:2*(grip.x+dx)/innerWidth-1,y:1-2*(grip.y+dy)/innerHeight},a.camera)
          return ray.intersectObjects(roots,true)[0]?.object?.name
        }),message:document.querySelector('[role=status]')?.textContent}
      },{id,grip}))
      await page.screenshot({path:resolve(dir,'rest-pick-diagnostic.png')})
    }
    assert.equal(lifted.active,id,'picked from wood '+id)
    await page.mouse.move(site.x,site.y,{steps:6});await page.waitForTimeout(80)
    const moved=await position(id)
    assert.ok(Math.abs(lifted.y-before.y-.08)<.001&&Math.abs(moved.y-lifted.y)<.0001,'fixed height on second pickup '+id)
    assert.ok(Math.hypot(moved.x-before.x-.10,moved.z-before.z+.06)<.012,'moves freely from wood '+id)
    await page.keyboard.press('Escape');await page.waitForTimeout(320)
    const restored=await position(id)
    assert.ok(Math.hypot(restored.x-before.x,restored.y-before.y,restored.z-before.z)<.002,'place restored after cancel '+id)
    tablePickups.push({id,liftCm:Math.round((lifted.y-before.y)*100),heightDriftMm:Math.abs(moved.y-lifted.y)*1000})
  }
  checkRest(await contact())
  // Compare the real render with and without the contact layer, in the flowers' clear desk area.
  const shadowPixels=await page.evaluate(()=>{
    const a=window.__coreInspect,layer=a.scene.getObjectByName('tool_contact_shadows')
    const screen=document.createElement('canvas')
    screen.width=innerWidth;screen.height=innerHeight
    const ctx=screen.getContext('2d',{willReadFrequently:true})
    function pixels(){
      a.renderer.render(a.scene,a.camera)
      ctx.drawImage(a.renderer.domElement,0,0,innerWidth,innerHeight)
      return ctx.getImageData(160,365,245,125).data
    }
    layer.visible=false
    let without
    try{without=pixels()}finally{layer.visible=true}
    const withShadow=pixels()
    let changed=0
    for(let i=0;i<without.length;i+=4)if(without[i]-withShadow[i]>4)changed++
    return changed
  })
  assert.ok(shadowPixels>35,'flower contact shadows darken the desk')
  await page.screenshot({path:resolve(dir,'flowers-on-desk.png')})
  await page.reload();await page.getByRole('button',{name:'继续上次花席',exact:true}).click();await page.waitForFunction(()=>!!window.__coreInspect,null,{timeout:45000});await page.waitForTimeout(450)
  checkRest(await contact())
  assert.deepEqual(errors,[])
  const video=page.video();await ctx.close();await video.saveAs(resolve(dir,'pick-up-and-place.webm'));await video.delete()
  await writeFile(resolve(dir,'desk-carry.json'),JSON.stringify({build:build.sha256,viewport:[1000,590],crowns,measurements,contacts,tablePickups,shadowPixels,errors},null,2))
}finally{await browser.close()}

