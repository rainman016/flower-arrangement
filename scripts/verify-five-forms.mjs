import {deskMouseTargets,visibleDeskPoint} from './desk-mouse-targets.mjs'
import {chromium} from '@playwright/test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
const dir=process.env.FLOWER_DELIVERY
  ? resolve(process.env.FLOWER_DELIVERY)
  : fileURLToPath(new URL('../art/deliverables/five-forms/',import.meta.url))
const browser=await chromium.launch({channel:'chrome',headless:true})
const reports=[]
let page,current
try{
  for(const [id,name] of [['bamboo','竹林清风'],['creek','溪畔观流']]){
    if(process.argv[2]&&process.argv[2]!==id)continue
    current=id
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:id==='creek'?1.5:1,...(id==='bamboo'?{recordVideo:{dir:tmpdir(),size:{width:960,height:600}}}:{})})
    page=await context.newPage()
    const errors=[],checks=[]
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
    page.on('console',msg=>{if(/THREE.WebGLProgram|Shader Error|GL_INVALID|WebGL: INVALID/.test(msg.text()))errors.push(msg.text())})
    await page.addInitScript(()=>{
      globalThis.flowerCoreReview=true;globalThis.reviewGains=[]
      const create=AudioContext.prototype.createGain
      AudioContext.prototype.createGain=function(){const node=create.call(this);globalThis.reviewGains.push(node);return node}
    })
    page.setDefaultTimeout(12000)
    await page.goto(pathToFileURL(resolve(dir,'play.html')).href)
    const wait=ms=>page.waitForTimeout(ms)
    const read=()=>page.evaluate(()=>window.__coreInspect.read())
    const button=async label=>{
      const control=page.getByRole('button',{name:label,exact:true})
      if(label!=='开始插花')return control.click()
      const start=Date.now()
      await control.click({timeout:60000})
      console.log(id,'开场按钮等待',Date.now()-start,'ms')
    }
    const verify=(label,value)=>{assert.ok(value,label);checks.push(label);console.log(id,label)}
    const checkRail=async()=>{
      const layout=await page.evaluate(()=>{
        const title=document.querySelector('.step-card').getBoundingClientRect()
        const hint=document.querySelector('.ritual-feedback').getBoundingClientRect()
        const buttons=[...document.querySelectorAll('.ritual-actions>button:not(.finish-arrangement)')].map(b=>b.getBoundingClientRect())
        const stage=document.querySelector('main').dataset.stage
        const names={prepare:'静心备席',observe:'缘起赏花',trim:'慈心修剪',arrange:'正念插花',bless:'无限祝愿'}
        const centered=Math.abs((hint.left+hint.right)/2-innerWidth/2)<2
        return document.querySelector('.step-card h1').textContent===names[stage]&&hint.height>0&&centered&&buttons.length>0&&buttons.every((r,i)=>Math.abs(r.left-title.left)<1&&Math.abs(r.width-buttons[0].width)<1&&r.height>=44&&Math.abs(r.height-buttons[0].height)<1&&(!i||r.top>=buttons[i-1].bottom))
      })
      const stage=(await read()).ritual.stage
      verify(stage+' 式名固定，同级按钮等宽纵排，步骤提示在画面中上方',layout)
      if(id==='bamboo')await page.screenshot({path:resolve(dir,'actions-'+stage+'.png')})
    }
    const pos=(id,p)=>page.evaluate(({id,p})=>{
      const a=window.__coreInspect,obj=a.world.flowers.get(id)||a.world[id],v=new a.Vector3(...p)
      if(obj)obj.localToWorld(v);v.project(a.camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2}
    },{id,p})
    const click=async p=>{const v=await p;await page.mouse.click(v.x,v.y)}
    const drag=async(from,to,hold=0)=>{const a=await from,b=await to;await page.mouse.move(a.x,a.y);await page.mouse.down();if(hold)await wait(hold);await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();await wait(720)}
    const menu=page.getByRole('group',{name:'选择场景'})
    await menu.waitFor()
    verify('先选景再初始化三维画面',await menu.getByRole('button').count()===2&&await page.locator('canvas').count()===0)
    const started=Date.now()
    await menu.getByRole('button',{name,exact:true}).click()
    await page.waitForFunction(()=>!!window.__coreInspect,null,{timeout:120000})
    await page.getByRole('button',{name:'开始插花'}).waitFor({timeout:120000})
    console.log(id,'入场按钮',Date.now()-started,'ms',await page.evaluate(()=>{const gl=window.__coreInspect.renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');return info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}))
    // Each scene can compile materials on first entry, especially after changing scenes.
    await page.waitForFunction(()=>!document.querySelector('.ritual-intro [data-slot="button"]').disabled,null,{timeout:60000})
    await wait(500)
    const camera=()=>page.evaluate(()=>window.__coreInspect.camera.position.z)
    const far=await camera();await wait(750)
    verify('开场镜头前移',await camera()<far||await page.evaluate(()=>{const p=window.__coreInspect.camera.userData.approach;return p.first-p.last>.02}))
    await page.mouse.move(940,235);await page.mouse.down();await page.mouse.move(1070,250,{steps:6});await page.mouse.up()
    verify('桌前可环顾',await page.evaluate(()=>Math.abs(window.__coreInspect.camera.rotation.y)>.1))
    await page.waitForFunction(()=>window.reviewGains.at(-1)?.gain.value>.05)
    verify('入席时自然声可闻',true)
    await button('开始插花')
    const entry=await page.getByRole('button',{name:'准备花材'}).boundingBox()
    verify('进入备席为正文下方居中大按钮',entry&&entry.width>=280&&entry.height>=50&&Math.abs(entry.x+entry.width/2-page.viewportSize().width/2)<3)
    verify('显示调心原文',await page.getByText(/青青翠竹/).isVisible())
    for(let i=0;i<3;i++)await button('下一段')
    verify('调心末段完整',await page.getByText(/开启静心插花的旅程/).isVisible())
    await button('准备花材')
    if(id==='bamboo'){
      await button('花材库')
      await button('添加小雏菊');await button('添加小雏菊');await button('2 · 五瓣白野花');await button('移除当前这枝五瓣白野花')
      await page.screenshot({path:resolve(dir,'flower-library.png')})
      await button('选好了')
      const picked=await read()
      const daisies=picked.history.present.flowers.filter(f=>f.kind==='daisy')
      verify('小雏菊可多选且各有实体',daisies.length===2&&await page.evaluate(()=>[...window.__coreInspect.world.flowers.values()].filter(o=>o.getObjectByName('daisy-white-rays')).length===2))
      await button('花材库');await button('添加狗尾巴草');await page.keyboard.press('Escape')
      verify('关闭花单保留已确认的选择',(await read()).history.present.flowers.length===picked.history.present.flowers.length)
      await page.keyboard.press('Control+z');await wait(300)
      verify('整张选花单只需撤销一次',(await read()).history.present.flowers.map(f=>f.id).join(',')==='f-1,f-2,f-3')
    }
    await button('用这些花材开始备席');await wait(550);await checkRail()
    verify('开始备席后锁定花材库',await page.getByRole('button',{name:'本席花材已定'}).isDisabled())

    await page.screenshot({path:resolve(dir,id+'-prepare.png')})
    await page.waitForFunction(()=>document.querySelector('.ritual-heading')?.dataset.audio==='playing')
    await page.waitForFunction(()=>window.reviewGains.at(-1)?.gain.value>.05)
    verify('备席时当前场景自然声可闻',true)
    await page.evaluate(()=>{
      const env=window.__coreInspect.scene.getObjectByName('nature_environment')
      const sample=window.ritualPerf={intervals:[],last:performance.now(),frame:env.userData.renderedFrames}
      function probe(t){
        const f=env.userData.renderedFrames
        if(f!==sample.frame){sample.intervals.push(t-sample.last);sample.last=t;sample.frame=f}
        if(document.querySelector('main')?.dataset.stage!=='bless')requestAnimationFrame(probe)
      }
      requestAnimationFrame(probe)
    })
    verify('三种花材初始在杯中',(await read()).history.present.flowers.every(f=>f.location==='cup'))
    if(id==='bamboo'){
      await button('重新备席');await button('继续当前花席')
      verify('取消重新备席留在本式',(await read()).ritual.stage==='prepare')
      const beforeReset=(await read()).history
      await button('重新备席');await button('确认重新备席')
      verify('重新备席保留当前场景且可撤销',(await read()).ritual.sceneId===id&&(await read()).history.past.length===beforeReset.past.length+1)
      await page.keyboard.press('Control+z')
      verify('撤销重新备席恢复原桌面',JSON.stringify((await read()).history.present)===JSON.stringify(beforeReset.present))
      await click(pos('cup',[.021,.035,0]))
      verify('第一次拿起带花杯即有可执行的取花按钮',await page.getByRole('button',{name:'先放下花枝',exact:true}).isEnabled())
      const target=await pos('vase',[0,.179,0])
      await page.mouse.click(target.x,target.y)
      verify('杯中有花时点瓶口保留杯子且不会注水',(await read()).cupHeld&&(await read()).history.present.vaseMl===0)
      await button('先放下花枝');await wait(340)
      const cleared=await read()
      verify('取出整杯花枝后仍持杯',cleared.cupHeld&&cleared.history.present.flowers.every(f=>f.location==='table'))
      await page.keyboard.press('Control+z');await wait(250)
      verify('整杯取花一次撤销',(await read()).history.present.flowers.every(f=>f.location==='cup'))
      await click(pos('cup',[.021,.035,0]))
      await page.keyboard.press('Escape');await wait(250)
    }
    const corners=await Promise.all([-.6,.6].flatMap(x=>[-.50,.37].map(z=>pos('',[x,.758,z]))))
    verify('桌面四角完整入镜',corners.every(p=>p.x>=8&&p.x<1432&&p.y>=8&&p.y<892))
    const initial=(await read()).history.present
    verify('盒内从左到右是花器、杯和正放花剪',initial.vase.x<initial.tools.cup[0]&&initial.tools.cup[0]===0&&initial.tools.scissors[0]>0&&await page.evaluate(()=>Math.abs(window.__coreInspect.world.scissors.quaternion.y)<.001))
    const depth=await page.evaluate(()=>{const a=window.__coreInspect;return .37-new a.Box3().setFromObject(a.world.tray).max.z})
    verify('盒前留出至少 40 厘米操作区',depth>.40)
    if(id==='bamboo'){
      await page.setViewportSize({width:1000,height:715});await wait(320)
      const corners=await Promise.all([-.6,.6].flatMap(x=>[-.50,.37].map(z=>pos('',[x,.758,z]))))
      verify('用户截图比例也能看见整张桌面',corners.every(p=>p.x>=5&&p.x<995&&p.y>=5&&p.y<710))
      await page.screenshot({path:resolve(dir,'tabletop-1000.png')})
      await page.setViewportSize({width:1440,height:900});await wait(250)
      const cg=await pos('cup',[.024,.036,0])
      const position=id=>page.evaluate(id=>(window.__coreInspect.world.flowers.get(id)||window.__coreInspect.world[id]).position.toArray(),id)
      const start=await position('cup'),flower=await position('f-1')
      await page.mouse.move(cg.x,cg.y);await page.mouse.down();await page.mouse.move(cg.x+35,cg.y-100,{steps:5});await wait(120)
      const lift=await position('cup'),stems=await position('f-1')
      verify('装花的杯子能即时抬高并带动花草',lift[1]>start[1]+.035&&Math.abs(stems[1]-flower[1]-lift[1]+start[1])<.01)
      await page.mouse.wheel(0,100);await wait(150)
      verify('手持滚轮改变纵深',Math.abs((await position('cup'))[2]-lift[2])>.025)
      await page.keyboard.press('Escape');await page.mouse.up();await wait(200)
      verify('取消搬杯恢复杯与花枝',(await read()).history.present.tools.cup.every((n,i)=>Math.abs(n-start[i])<.003)&&Math.abs((await position('f-1'))[1]-flower[1])<.002)
      for(const prop of ['vase','cup','scissors']){
        const grip=await pos(prop,prop==='scissors'?[0,-.0014,-.005]:prop==='vase'?[0,.066,0]:[.022,.036,0])
        await page.mouse.move(grip.x,grip.y);await page.mouse.down({button:'right'})
        await page.mouse.move(grip.x+85,grip.y-55,{steps:6});await page.mouse.wheel(0,65);await wait(80)
        await page.mouse.up({button:'right'});await wait(180)
        verify('可翻转并落稳 '+prop,(await read()).history.present.tools.rotations?.[prop]?.slice(0,3).some(n=>Math.abs(n)>.08))
        await page.keyboard.press('Control+z');await wait(220)
      }
      const blossom=initial.flowers[0],tip=await pos(blossom.id,[0,blossom.length,0])
      await page.mouse.move(tip.x,tip.y);await page.mouse.down({button:'right'})
      await page.mouse.move(tip.x+565,tip.y+24,{steps:15});await page.mouse.wheel(0,60);await wait(100)
      await page.mouse.up({button:'right'});await wait(200)
      verify('花枝可连续旋过一圈并翻转放下',(await read()).history.present.flowers[0].tableRotation?.slice(0,3).some(v=>Math.abs(v)>.1))
      await page.keyboard.press('Control+z');await wait(720)
      const f=initial.flowers[0],head=await pos(f.id,[0,f.length,0]),origin=await position(f.id)
      await page.mouse.move(head.x,head.y);await page.mouse.down();await page.mouse.move(head.x-85,head.y-42,{steps:4});await wait(120)
      verify('快速拖花立即离开杯中高度',(await position(f.id))[1]>origin[1]+.02)
      await page.keyboard.press('Escape');await page.mouse.up();await wait(200)
    }
    const vaseGrip=await pos('vase',[0,.07,0])
    await drag(vaseGrip,(await deskMouseTargets(page,'vase',vaseGrip,[[0,.265]]))[0],0)
    verify('花器搬到木盒前方',(await read()).history.present.vase.z>.22)
    const shearsGrip=await pos('scissors',[0,-.0014,-.005])
    await drag(shearsGrip,(await deskMouseTargets(page,'scissors',shearsGrip,[[.40,.04]]))[0],320)
    verify('花剪移到右侧',(await read()).history.present.tools.scissors[0]>.33)
    for(const f of (await read()).history.present.flowers){
      const flowerGrip=await pos(f.id,[0,f.length,0]),[site]=await deskMouseTargets(page,f.id,flowerGrip,[[-.37-f.slot*.06,-.10+f.slot*.07]],true)
      await click(flowerGrip);await wait(760)
      verify('拿起杯中花材 '+f.id,(await read()).held===f.id)
      await click(site);await wait(760)
      verify('花材放到左侧 '+f.id,(await read()).history.present.flowers.find(o=>o.id===f.id).location==='table')
    }
    await click(pos('cup',[0,.035,0]));await wait(120)
    verify('实际点杯拿起',(await read()).cupHeld)
    const mouth=await pos('vase',[0,.179,0])
    const pourButton=name=>page.getByRole('button',{name,exact:true})
    const aimCup=async()=>{
      await page.mouse.move(mouth.x,mouth.y,{steps:10})
      await page.waitForFunction(()=>window.__coreInspect.world.vase.userData.pouring===true)
      await wait(720)
      verify('移近时杯沿自动轻倾',await page.evaluate(()=>Math.abs(window.__coreInspect.world.cup.quaternion.z)>.1))
      const preview=await page.evaluate(()=>{
        const w=window.__coreInspect.world,lip=w.cup.getObjectByName('glass_pour_lip').getWorldPosition(new window.__coreInspect.Vector3())
        const target=w.vase.localToWorld(new window.__coreInspect.Vector3(0,.179,0))
        const shell=w.vase.getObjectByName('vase-water-volume')
        return {seeThrough:w.vase.userData.pouring&&w.vase.userData.revealOpacity<.48,
          emptyIsDry:window.__coreInspect.read().history.present.vaseMl>0||shell.geometry.drawRange.count===0,
          gap:lip.distanceTo(target),flow:w.pouring,water:w.previewMl}
      })
      verify('靠近自动对准且花器半透明，点击前不出水',preview.seeThrough&&preview.emptyIsDry&&preview.gap<.051&&!preview.flow&&preview.water===0)
      const outside=await page.evaluate(()=>{
        const a=window.__coreInspect,base=a.world.vase.getWorldPosition(new a.Vector3()).project(a.camera)
        const card=document.querySelector('.cup-pour-actions').getBoundingClientRect()
        return Math.abs(card.x+card.width/2-innerWidth/2)<2&&card.top>(1-base.y)*innerHeight/2-3&&document.querySelectorAll('[data-water-note]').length===1
      })
      verify('开始提示避开杯身轮廓',outside)
    }
    await aimCup()
    if(id==='bamboo'){
      await page.screenshot({path:resolve(dir,'cup-ready.png')})
      await page.setViewportSize({width:390,height:844});await wait(320)
      const accessible=await page.evaluate(()=>{
        const actions=document.querySelector('.cup-pour-actions')
        if(!actions)return false
        return [...actions.querySelectorAll('button')].every(b=>{
          const r=b.getBoundingClientRect()
          return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))
        })
      })
      verify('窄屏瓶旁提示可点',accessible)
      await page.setViewportSize({width:1440,height:900});await wait(320)
      await button('返回桌面');await wait(350)
      verify('离开集中注水卡后仍持杯且花器恢复', (await read()).cupHeld&&(await read()).history.present.vaseMl===0&&!await page.evaluate(()=>window.__coreInspect.world.vase.userData.pouring))
      const historyBefore=(await read()).history.past.length
      const firstWater=page.evaluate(()=>new Promise(resolve=>{
        const a=window.__coreInspect,w=a.world,lip=w.cup.getObjectByName('glass_pour_lip'),rim=w.vase.localToWorld(new a.Vector3(0,.179,0))
        const deadline=performance.now()+10000
        function sample(){
          if(w.previewMl>0){
            const p=lip.getWorldPosition(new a.Vector3())
            resolve(Math.hypot(p.x-rim.x,p.z-rim.z)<.003&&Math.abs(p.y-rim.y-.04)<.004)
          }else if(performance.now()>deadline)resolve(false)
          else requestAnimationFrame(sample)
        }
        sample()
      }))
      await button('开始倒水')
      verify('从桌边点倒水，第一股水在杯沿到位后出现',await firstWater)
      await page.waitForFunction(()=>window.__coreInspect.world.previewMl>4)
      await page.keyboard.press('Control+z')
      const cancelled=await read()
      verify('倒水中撤销只取消这一段',cancelled.cupHeld&&cancelled.history.present.vaseMl===0&&cancelled.history.past.length===historyBefore)
      await click(pos('vase',[0,.09,0]))
      await wait(350)
      verify('点瓶只对准，等待明确开始',(await read()).history.present.vaseMl===0&&!await page.evaluate(()=>window.__coreInspect.world.pouring))
      await button('开始倒水')
      await page.waitForFunction(()=>window.__coreInspect.world.previewMl>10)
      await click(pos('vase',[0,.09,0]));await wait(200)
      const small=await read(),settled=small.history.present.vaseMl
      verify('点停后杯中有余水且可在近景重倒',small.cupHeld&&await pourButton('重新倒水').isVisible()&&settled>0&&settled<86.67)
      await wait(180)
      verify('停止后杯瓶水量不再变化',(await read()).history.present.vaseMl===settled&&!await page.evaluate(()=>window.__coreInspect.world.pouring))
      await button('重新倒水');await button('开始倒水')
      await page.waitForFunction(()=>window.__coreInspect.world.pouring&&window.__coreInspect.world.previewMl>2)
      verify('重新倒水从本次开始前水量出发',(await read()).history.present.vaseMl===0)
      await button('停止倒水')
      await page.keyboard.press('Control+z');await wait(220)
      verify('少量倒水一次撤销',(await read()).history.present.vaseMl===0)
      await click(pos('cup',[.022,.035,0]));await aimCup()
    }
    const measuredRate=page.evaluate(()=>new Promise(resolve=>{
      let first
      const sample=now=>{
        const ml=window.__coreInspect.world.previewMl
        if(ml>3&&!first)first={now,ml}
        if(first&&ml-first.ml>45){resolve((ml-first.ml)*1000/(now-first.now));return}
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    if(id==='creek')await click(pos('vase',[0,.089,0]));await button('开始倒水')
    await page.mouse.move(mouth.x+150,mouth.y+75,{steps:3})
    await page.waitForFunction(()=>window.__coreInspect.world.stream.visible&&window.__coreInspect.world.previewMl>20)
    verify('单击后水流持续，实际杯沿悬在瓶口上方',await page.evaluate(()=>{
      const a=window.__coreInspect,w=a.world,tip=w.cup.getObjectByName('glass_pour_lip').getWorldPosition(new a.Vector3())
      const rim=w.vase.localToWorld(new a.Vector3(0,.179,0))
      return w.pouring&&Math.hypot(tip.x-rim.x,tip.z-rim.z)<.003&&tip.y>rim.y
    }))
    if(id==='bamboo')await page.screenshot({path:resolve(dir,'cup-pouring.png')})
    await page.waitForFunction(()=>window.__coreInspect.world.previewMl>=88||window.__coreInspect.read().history.present.vaseMl===130)
    if(id==='creek'){
      await page.waitForFunction(()=>window.__coreInspect.read().history.present.vaseMl===130&&!window.__coreInspect.world.pouring)
      verify('花器装满自动停水并保留杯子',(await read()).cupHeld&&(await read()).history.present.spillMl>0&&await pourButton('重新倒水').isVisible())
    }else if(await pourButton('停止倒水').isVisible()){await button('停止倒水')}
    await wait(180)
    const mlPerSecond=await measuredRate
    verify('实测稳定水流约每秒12毫升',Math.abs(mlPerSecond-12)<1.2)
    const result=await read(),water=result.history.present.vaseMl
    verify('可越过三分之二且杯瓶总量守恒',result.cupHeld&&water>86.67&&water<=130&&Math.abs(water+result.history.present.cupMl+(result.history.present.spillMl??0)-180)<.001)
    await page.keyboard.press('Control+z');await wait(100)
    verify('一段连续倒水一次完整撤销',(await read()).history.present.vaseMl===0)
    await page.keyboard.press('Control+Shift+z');await wait(100)
    verify('重做恢复杯瓶水量',(await read()).history.present.vaseMl===water)
    // The pour camera eases back independently of the history update. Project
    // mouse coordinates only once the visible camera has settled, also on iGPUs.
    await page.evaluate(()=>{delete window.__deskCameraProbe})
    await page.waitForFunction(()=>{
      const camera=window.__coreInspect.camera,key=camera.matrixWorld.elements.map(v=>Math.round(v*1e6)).join(',')
      const previous=window.__deskCameraProbe
      window.__deskCameraProbe={key,frames:previous?.key===key?previous.frames+1:0}
      return window.__deskCameraProbe.frames>=3
    })
    const cupGrip=await pos('cup',[0,.035,0])
    await click(cupGrip);await wait(100)
    const [cupSite]=await deskMouseTargets(page,'cup',cupGrip,[[-.075,-.18]])
    await click(cupSite);await wait(100)
    verify('杯子放回所指盒内位置',!(await read()).cupHeld&&Math.abs((await read()).history.present.tools.cup[2]+.18)<.014)
    await button('完成备席');await wait(150);await checkRail()
    await click(pos('scissors',[0,-.0014,-.005]));await wait(100)
    verify('赏花时点击花剪保持赏花模式',!(await read()).tool)
    const f=(await read()).history.present.flowers[0]
    const dimensions=(flowerId=f.id)=>page.evaluate(id=>{
      const a=window.__coreInspect,plant=a.world.flowers.get(id).getObjectByName('botanical-'+id)
      plant.updateWorldMatrix(true,true)
      const point=new a.Vector3(),box={left:1,right:-1,top:-1,bottom:1}
      plant.traverse(o=>{
        if(!o.isMesh)return
        const vertices=o.geometry.getAttribute('position')
        for(let i=0;i<vertices.count;i++){
          point.fromBufferAttribute(vertices,i).applyMatrix4(o.matrixWorld).project(a.camera)
          box.left=Math.min(box.left,point.x);box.right=Math.max(box.right,point.x)
          box.top=Math.max(box.top,point.y);box.bottom=Math.min(box.bottom,point.y)
        }
      })
      return {cx:(box.left+box.right)/2,cy:(box.top+box.bottom)/2,height:(box.top-box.bottom)/2,...box}
    },flowerId)
    const actionBox=label=>page.getByRole('button',{name:label,exact:true}).boundingBox()
    const stays=(before,after)=>before&&after&&Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1
    if(id==='creek')await button('开始赏花');else await click(pos(f.id,[0,f.length,0]));await wait(700)
    verify('赏花拿近',(await read()).held===f.id)
    if(id==='bamboo')await page.screenshot({path:resolve(dir,'flower-close.png')})
    const close=await dimensions(),observeBar=await actionBox('放回')
    verify('整枝在画面中央放大且完整可见',Math.abs(close.cx)<.13&&Math.abs(close.cy)<.14&&close.height>.47&&close.height<.80)
    // Measure from a stable stem. The pick-up itself can still be bending it on a slow frame.
    await page.waitForFunction(id=>{
      const root=window.__coreInspect.world.flowers.get(id)
      const plant=root.getObjectByName('botanical-'+id)
      const bend=plant?.userData.stemBend
      return bend && bend.lengthSq()<1e-7
    },f.id,{timeout:10000})
    const head=await pos(f.id,[0,f.length,0])
    const motion=page.evaluate(id=>new Promise(resolve=>{
      const root=window.__coreInspect.world.flowers.get(id),crown=root.getObjectByName('flower-crown')
      const rest=crown.position.clone(),rotation=root.quaternion.clone(),start=performance.now()
      let peak=0,released=0
      const release=()=>{released=performance.now()}
      window.addEventListener('pointerup',release,{capture:true,once:true})
      const sample=now=>{
        const tip=crown.position.distanceTo(rest);peak=Math.max(peak,tip)
        if((released&&now-released>=1400)||now-start>12000){
          window.removeEventListener('pointerup',release,true)
          resolve({peak,tail:tip,turn:rotation.angleTo(root.quaternion),released:!!released})
        }else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }),f.id)
    const blank={x:Math.round(page.viewportSize().width*.40),y:head.y+40}
    await drag(blank,{x:blank.x+64,y:blank.y+25})
    const sway=await motion
    console.log(id,'实际松手后的花梢',sway)
    verify('转动时花梢有惯性并在停手后收稳',sway.released&&sway.turn>.02&&sway.peak>.00015&&sway.tail<.00055)
    const rotated=await dimensions(),advance=await actionBox('看好了，开始修剪')
    await button('再读一句')
    verify('引导词换行后继续按钮仍在原位',stays(advance,await actionBox('看好了，开始修剪')))
    const turnedHead=await pos(f.id,[0,f.length,0])
    await page.mouse.move(turnedHead.x,turnedHead.y);await page.mouse.wheel(0,-120);await wait(250)
    const zoomed=await dimensions(),afterZoomBar=await actionBox('放回')
    console.log(id,'观察缩放与按钮',rotated.height.toFixed(3),zoomed.height.toFixed(3),zoomed.cx.toFixed(3),observeBar,afterZoomBar)
    verify('滚轮放大仍居中且赏花按钮停在原位',zoomed.height>rotated.height*1.015&&Math.abs(zoomed.cx)<.14&&stays(observeBar,afterZoomBar))
    await button('看好了，开始修剪');await checkRail();await wait(750)
    verify('转入修剪时花枝放回原位',!(await read()).held)
    const cutSpot=(id,at=.035)=>page.evaluate(({id,at})=>{
      const a=window.__coreInspect,root=a.world.flowers.get(id),mesh=root.getObjectByName('part-stem').children[0]
      const p=mesh.geometry.getAttribute('position'),v=new a.Vector3()
      let nearest=0
      for(let i=1;i<p.count;i++)if(Math.abs(p.getY(i)-at)<Math.abs(p.getY(nearest)-at))nearest=i
      mesh.localToWorld(v.fromBufferAttribute(p,nearest)).project(a.camera)
      return {x:(1+v.x)*innerWidth/2,y:(1-v.y)*innerHeight/2}
    },{id,at})
    const aim=async location=>{const p=await location;await page.mouse.move(p.x,p.y,{steps:5});await wait(100);return p}
    let trimGrass
    if(id==='bamboo'){
      await page.setViewportSize({width:1182,height:676});await wait(600)
      const grass=(await read()).history.present.flowers.find(f=>f.kind==='grass')
      const grassSurface=await visibleDeskPoint(page,grass.id,'part-stem')
      assert.ok(grassSurface,'visible surface of the resting grass stem')
      await click(grassSurface)
      await page.waitForFunction(id=>window.__coreInspect.read().held===id,grass.id)
      await wait(700)
      const bounds=await dimensions(grass.id)
      trimGrass={left:(1+bounds.left)*591,right:(1+bounds.right)*591,top:(1-bounds.top)*338,bottom:(1-bounds.bottom)*338}
      console.log('截图尺寸下的狗尾巴草轮廓',trimGrass)
      // Keep the marked rectangle's 240 × 408 size around the common observation/cutting centre.
      const centerX=1182/2,centerY=676*.5125
      verify('修剪草穗的中心稳定且整枝进入中央工作区',(await read()).held===grass.id&&Math.abs(bounds.cx)<.03&&Math.abs(bounds.cy+.025)<.04&&trimGrass.left>=centerX-120&&trimGrass.right<=centerX+120&&trimGrass.top>=centerY-204&&trimGrass.bottom<=centerY+204&&bounds.height>.45)
      await page.screenshot({path:resolve(dir,'trim-grass-center.png')})
      const tip=await pos(grass.id,[0,grass.length,0])
      await drag(tip,{x:tip.x+35,y:tip.y+15})
      await aim(pos('scissors',[0,-.0014,-.005]))
      verify('悬停桌上花剪时桌边裁剪按钮有提示',await page.locator('.desk-trim-trigger').evaluate(n=>n.hasAttribute('data-near')))
      await button('裁剪');await wait(650)
      const turned=await dimensions(grass.id),shears=await pos('scissors',[0,-.0014,-.005])
      verify('草穗转向与拿剪后仍居中，剪在右侧',Math.abs(turned.cx)<.06&&Math.abs(turned.cy+.08)<.07&&shears.x>1182*.62)
      const at=await aim(cutSpot(grass.id)),standby=await pos('scissors',[0,0,0])
      verify('悬停实际茎段有剪口与整段预览且尚未剪下',await page.evaluate(()=>{const a=window.__coreInspect;return a.world.marker.visible&&a.world.ghost.visible&&!a.read().history.present.debris.length}))
      await page.screenshot({path:resolve(dir,'cut-preview.png')})
      await drag(at,{x:at.x+42,y:at.y+10})
      verify('裁剪中拖动只转花，剪刀固定待命',!(await read()).history.present.debris.length&&Math.abs((await pos('scissors',[0,0,0])).x-standby.x)<1)
      await aim(cutSpot(grass.id))
      const start=Date.now()
      const stroke=page.evaluate(()=>new Promise(resolve=>{
        const a=window.__coreInspect,home=a.world.scissors.position.clone(),begin=performance.now()
        let travelled=false,openBeforeCut=false,closedAtCut=false,falling=false
        const sample=()=>{
          const w=a.world,m=w.stroke,d=a.read().history.present.debris.at(-1)
          if(m&&!m.closed&&!d){openBeforeCut=true;travelled||=w.scissors.position.distanceTo(home)>.01}
          if(m?.closed&&d)closedAtCut=true
          if(d){const o=a.scene.getObjectByName('core-debris-'+d.id)
            if(o&&o.position.y>d.shape.landing[1]+.006&&o.position.y<d.shape.origin[1]-.002)falling=true
            if(!m&&o&&Math.abs(o.position.y-d.shape.landing[1])<.002){resolve({travelled,openBeforeCut,closedAtCut,falling});return}}
          if(performance.now()-begin>6000){resolve({travelled,openBeforeCut,closedAtCut,falling});return}
          requestAnimationFrame(sample)
        };sample()
      }))
      await click(cutSpot(grass.id))
      const phases=await stroke,cut=await read()
      console.log('点击修剪动作实测',Date.now()-start,phases)
      verify('单击后剪刀前往剪口，合刃时才断枝',phases.travelled&&phases.openBeforeCut&&phases.closedAtCut)
      verify('中央草穗点击剪下，真实枝段落桌',phases.falling&&cut.history.present.debris.length===1&&cut.history.present.flowers.find(f=>f.id===grass.id).length<grass.length)
      await page.screenshot({path:resolve(dir,'cut-on-desk.png')})
      await page.keyboard.press('Control+z');await wait(400)
      verify('撤销恢复中央草穗和桌面',!(await read()).history.present.debris.length&&(await read()).history.present.flowers.find(f=>f.id===grass.id).length===grass.length)
      if(await page.getByRole('button',{name:'放回',exact:true}).isVisible())await button('放回')
      await page.setViewportSize({width:1440,height:900});await wait(550)
    }
    if(id==='bamboo'){
      await click(pos(f.id,[0,f.length,0]));await wait(750)
      await click(pos('scissors',[0,-.0014,-.005]));await wait(650)
      const trimBar=await actionBox('收剪')
      await button('选剪口')
      verify('剪口展开时花剪按钮固定',stays(trimBar,await actionBox('收剪'))&&await page.getByRole('button',{name:'确认剪下'}).isVisible())
      if(id==='bamboo')await page.screenshot({path:resolve(dir,'trim-actions.png')})
      await button('取消')
      await aim(cutSpot(f.id));await click(cutSpot(f.id));await wait(1250)
      verify('点击剪口产生碎屑',(await read()).history.present.debris.length===1)
      await page.keyboard.press('Control+z');await wait(200)
      verify('撤销剪切恢复茎与碎屑',(await read()).history.present.debris.length===0&&(await read()).history.present.flowers[0].length===f.length)
      await page.keyboard.press('Control+Shift+z');await wait(220)
    }
    verify('修剪结束前仍在第三式且没有插花选项',(await read()).ritual.stage==='trim'&&await page.getByRole('button',{name:'插花',exact:true}).count()===0)
    const beforeArrange=(await read()).history
    await button('进入第四式');await checkRail()
    verify('换式不会自动插花或改动作品',(await read()).ritual.stage==='arrange'&&JSON.stringify((await read()).history)===JSON.stringify(beforeArrange))
    await button('插花');await wait(750)
    verify('空瓶时不显示完成插花',(await read()).ritual.stage==='arrange'&&await page.getByRole('button',{name:'插好了',exact:true}).count()===0)
    const after=(await read()).history.present.flowers[0]
    await click(pos(f.id,[0,after.length,0]));await wait(800)
    const arranging=await dimensions()
    verify('插瓶前拿近花枝仍在中央',Math.abs(arranging.cx)<.06&&Math.abs(arranging.cy+.08)<.07)
    await drag(pos(f.id,[0,.025,0]),pos('vase',[0,.179,0]))
    verify('抓茎到移动后的瓶口成功插入',(await read()).history.present.flowers[0].location==='vase')
    if(id==='bamboo'){
      await button('整理瓶中花枝');await wait(700)
      const flowerPoint=()=>page.evaluate(id=>{
        const a=window.__coreInspect,m=a.world.flowers.get(id).getObjectByName('flower-crown'),bounds=new a.Box3().setFromObject(m)
        const center=bounds.getCenter(new a.Vector3()).project(a.camera)
        return {x:(1+center.x)*innerWidth/2,y:(1-center.y)*innerHeight/2}
      },f.id)
      await click(flowerPoint());await wait(180)
      await button('向右转');const nudged=(await read()).history.present.flowers[0].pose
      verify('瓶中一点选枝，按钮微调',nudged.yaw!==after.pose.yaw)
      const h=await flowerPoint();await drag(h,{x:h.x+45,y:h.y+18})
      const relaxed=(await read()).history.present.flowers[0].pose
      verify('按钮之后可直接拖花头，松手保存',JSON.stringify(relaxed)!==JSON.stringify(nudged))
      await page.keyboard.press('Control+z');await wait(220)
      verify('一次撤销只还原这次拖动',JSON.stringify((await read()).history.present.flowers[0].pose)===JSON.stringify(nudged))
      const viewBefore=await page.evaluate(()=>window.__coreInspect.camera.position.toArray())
      await drag({x:280,y:235},{x:365,y:235})
      verify('拖空处环看花瓶',await page.evaluate(p=>window.__coreInspect.camera.position.distanceTo(new window.__coreInspect.Vector3(...p))>.01,viewBefore))
      verify('调花时隐藏整席收尾按钮',await page.getByRole('button',{name:'插好了',exact:true}).count()===0)
      await page.screenshot({path:resolve(dir,'vase-adjust.png')});await button('回到桌前')
    }
    await button('插好了')
    if(id==='bamboo'){
      const pieceId=(await read()).history.present.debris[0].id
      let piece=await visibleDeskPoint(page,pieceId)
      if(!piece){
        await button('残枝放到一边');await wait(180)
        piece=await visibleDeskPoint(page,pieceId)
      }
      verify('能在桌面找到未被器物遮挡的真实碎枝表面',!!piece)
      const beforePick=(await read()).history.present.debris[0]
      await click(piece);await wait(120)
      verify('可单独拿起碎枝且仍保留原件',await page.evaluate(()=>window.__coreInspect.world.active?.kind==='piece')&&(await read()).history.present.debris[0].id===beforePick.id)
      const spot=await page.evaluate(()=>{const a=window.__coreInspect,v=new a.Vector3(.43,.75,.21).project(a.camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2}})
      await click(spot);await wait(120)
      verify('点桌面放下同一碎枝',(await read()).history.present.debris[0].shape.landing[0]>.30)
      await page.keyboard.press('Control+z');await wait(120)
      verify('撤销拿放还原碎枝的原落点',JSON.stringify((await read()).history.present.debris[0])===JSON.stringify(beforePick))
    }
    const fragments=(await read()).history.present.debris
    await button('收好花席')
    const tidied=(await read()).history.present
    verify('整理保留原碎枝与插瓶作品',JSON.stringify(tidied.debris.map(d=>d.id))===JSON.stringify(fragments.map(d=>d.id))&&tidied.debris.every(d=>!d.shape||d.shape.landing[0]>.30)&&tidied.flowers[0].location==='vase')
    await button('开始祝愿');await checkRail()
    const performanceReport=await page.evaluate(()=>{
      const values=window.ritualPerf.intervals.sort((a,b)=>a-b)
      const gl=window.__coreInspect.renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info')
      return {renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),samples:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],peakMs:values.at(-1)}
    })
    const before=(await read()).history
    if(id==='bamboo'){
      const loose=before.present.flowers.find(f=>f.location==='table')
      for(const target of ['cup','scissors',loose.id]){
        const spot=await visibleDeskPoint(page,target)
        assert.ok(spot,'visible target '+target)
        await page.mouse.move(spot.x,spot.y)
        const hint=await page.evaluate(()=>document.querySelector('canvas').title)
        await page.mouse.click(spot.x,spot.y)
        verify('祝愿时 '+target+' 无奉花提示或动作',hint!=='送出祝愿'&&(await read()).ritual.line===0)
      }
    }
    const expectedWish=id==='bamboo'?'愿花开时，\n人常安。':''
    if(expectedWish){await button('留一句祝愿');await page.getByRole('textbox',{name:'我的祝愿'}).fill(expectedWish)}
    const placement=()=>page.evaluate(()=>{
      const w=window.__coreInspect.world
      return {vase:w.vase.position.z,flower:w.flowers.get('f-1').position.z}
    })
    await wait(750)
    const rest=await placement()
    if(id==='bamboo'){
      const bloom=await visibleDeskPoint(page,before.present.flowers.find(f=>f.location==='vase').id)
      assert.ok(bloom,'an exposed part of the inserted flower')
      await page.mouse.move(bloom.x,bloom.y)
      verify('指向已插花枝可奉花',await page.evaluate(()=>document.querySelector('canvas').title)==='送出祝愿')
      await click(bloom)
    }else await click(pos('vase',[0,.09,0]))
    await page.waitForFunction(z=>window.__coreInspect.world.vase.position.z<z-.025,rest.vase)
    const during=await placement()
    verify('奉花时花器与花枝一同送出',Math.abs((during.vase-rest.vase)-(during.flower-rest.flower))<.002)
    await page.waitForFunction(z=>Math.abs(window.__coreInspect.world.vase.position.z-z)<.0001,rest.vase)
    verify('奉花结束后回到原位',Math.abs((await placement()).flower-rest.flower)<.001)
    verify('送出祝愿后历史和作品摆位保留',(await read()).ritual.line===1&&JSON.stringify((await read()).history)===JSON.stringify(before))
    await button('回到当下');await button('下一段');await button('下一段')
    verify('原文收束',await page.getByText('一念花开，一念花落，一念放下，万般自在。',{exact:true}).isVisible())
    await button('看作品');await wait(450)
    await page.screenshot({path:resolve(dir,id+'-done.png')})
    let downloadCount=0
    page.on('download',()=>{downloadCount++})
    const download=page.waitForEvent('download')
    if(id==='creek'){
      const b=await page.getByRole('button',{name:'保存作品',exact:true}).boundingBox()
      await page.mouse.dblclick(b.x+b.width/2,b.y+b.height/2)
    }else await button('保存作品')
    const image=await download
    if(id==='creek'){await wait(350);verify('双击保存只下载一幅作品',downloadCount===1)}
    const png=await readFile(await image.path()),exportSize=await page.locator('canvas').evaluate(el=>{
      const rect=el.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,1.5)
      return [Math.floor(rect.width*ratio),Math.floor(rect.height*ratio)]
    })
    verify('下载真实 PNG',png.subarray(1,4).toString()==='PNG')
    verify('完整保留花器，祝愿排在画面外的留白',png.readUInt32BE(16)===exportSize[0]&&(expectedWish?png.readUInt32BE(20)>exportSize[1]:png.readUInt32BE(20)===exportSize[1]))
    await image.saveAs(resolve(dir,id+'-work.png'))
    await page.reload();await button('继续上次花席');await page.waitForFunction(()=>!!window.__coreInspect,null,{timeout:90000})
    verify('刷新恢复场景、作品、心愿和阶段',(await read()).ritual.stage==='done'&&(await read()).ritual.sceneId===id&&(await read()).ritual.wish===expectedWish)
    await button('继续调整');await button('插花');verify('继续同一作品',(await read()).history.present.flowers[0].location==='vase')
    verify('浏览器无运行错误',!errors.length)
    if(id==='bamboo'){
      for(const [flowerName,id] of [['白野花','f-2'],['野草穗','f-3']]){
        await button('操作帮助');await button('拿起'+flowerName);await wait(700)
        await button('放入花瓶')
        verify(flowerName+'插瓶预览保留原位置',(await read()).history.present.flowers.find(f=>f.id===id).location!=='vase')
        await button('确认插入');await wait(700)
        verify('同瓶加入'+flowerName,(await read()).history.present.flowers.find(f=>f.id===id).location==='vase')
        await button('深浅')
        for(let i=0;i<(id==='f-2'?4:5);i++)await button(id==='f-2'?'增大调整':'减小调整')
        await button('朝向')
        if(id==='f-3')for(let i=0;i<36;i++)await button('增大调整')
        await button('倾斜')
        for(let i=0;i<5;i++)await button('增大调整')
      }
      let bouquet=(await read()).history.present.flowers
      verify('三枝独立插点与深度',new Set(bouquet.map(f=>f.pose.x+','+f.pose.z)).size===3&&new Set(bouquet.map(f=>f.pose.depth)).size===3)
      await button('取出');await wait(720)
      verify('从同瓶取出草穗保留其余花材',(await read()).history.present.flowers.filter(f=>f.location==='vase').length===2)
      await button('放入花瓶');await button('确认插入');await wait(720)
      bouquet=(await read()).history.present.flowers
      verify('原草穗重新插入完整作品',bouquet.every(f=>f.location==='vase'))
      await button('插好了');await button('收好花席');await button('开始祝愿');await button('直接完成')
      await page.getByRole('checkbox').uncheck()
      const save=page.waitForEvent('download');await button('保存作品')
      await (await save).saveAs(resolve(dir,'bamboo-composition.png'))
    }
    if(id==='creek'){
      await button('插好了');await button('收好花席');await button('开始祝愿')
      const beforeEmpty=await read()
      await button('恢复本来空')
      const empty=await read()
      verify('第五式一键回到同景入席前，花材器物水量复位',empty.ritual.stage==='arrival'&&empty.ritual.sceneId===id&&empty.ritual.wish===''&&empty.history.present.vaseMl===0&&empty.history.present.cupMl===180&&empty.history.present.debris.length===0&&empty.history.present.flowers.every(f=>f.location==='cup'&&!f.removed.length)&&!empty.history.past.length)
      await button('取回刚才的作品')
      verify('即时取回可恢复完整作品和祝愿',JSON.stringify((await read()).history)===JSON.stringify(beforeEmpty.history)&&(await read()).ritual.wish===beforeEmpty.ritual.wish)
      await button('直接完成');await button('恢复本来空');await page.reload();await button('继续上次花席');await button('开始插花');await button('准备花材');await button('用这些花材开始备席')
      verify('恢复后刷新从空瓶开席',(await read()).history.present.vaseMl===0)
      await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
      await button('完成备席');await button('略过注水')
      verify('允许略过备席且不代做动作',(await read()).history.present.vaseMl===0)
      await button('操作帮助');await button('拿起黄野菊')
      const painted=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      await painted()
      const phone=await dimensions(),phoneBar=await actionBox('放回')
      verify('窄屏赏花居中放大并保留整枝',Math.abs(phone.cx)<.04&&Math.abs(phone.cy+.025)<.04&&phone.height>.40&&phone.left>-1&&phone.right<1&&phone.top<1&&phone.bottom>-1)
      const feedback=await page.locator('.ritual-feedback').boundingBox()
      verify('竖屏引导避开整枝并留出操作按钮',feedback.x>=110&&feedback.y+feedback.height<(1-phone.top)*844/2&&feedback.y+feedback.height<phoneBar.y)
      await page.screenshot({path:resolve(dir,'observe-phone.png')})
      await button('花枝右转')
      verify('减少动态效果时转花无余摆且按钮稳定',await page.evaluate(id=>{
        const a=window.__coreInspect,root=a.world.flowers.get(id),node=root.getObjectByName('flower-crown')
        return new Promise(resolve=>{const rest=node.position.clone();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(rest.distanceTo(node.position)<1e-8)))})
      },f.id)&&stays(phoneBar,await actionBox('放回')))
      await button('看好了，开始修剪');await button('操作帮助');await button('拿起黄野菊');await button('裁剪');await painted()
      const onCut=await dimensions()
      verify('竖屏同花赏花与开剪使用同一位置和尺寸',Math.abs(onCut.height-phone.height)<.015&&Math.abs(onCut.cx-phone.cx)<.015&&Math.abs(onCut.cy-phone.cy)<.015)
      await button('进入第四式');await button('插花')
      await button('操作帮助');await button('拿起黄野菊');await wait(320)
      const head=await pos('f-1',[0,.29,0])
      verify('窄屏拿近后花头在画面内',head.x>8&&head.x<382&&head.y>12&&head.y<832)
      await button('放入花瓶');await button('确认插入');await wait(250)
      const mouth=await pos('vase',[0,.179,0]),box=await page.locator('.core-context').boundingBox()
      verify('窄屏插花可见瓶口',!!box&&(mouth.x<box.x||mouth.x>box.x+box.width||mouth.y<box.y||mouth.y>box.y+box.height))
      await page.screenshot({path:resolve(dir,'narrow.png')})
    }
    const video=page.video()
    reports.push({scene:id,checks,errors,performance:performanceReport,observation:{bounds:close,sway,mlPerSecond,zoomed,action:afterZoomBar,trimGrass}});await context.close()
    if(!process.argv[2])await writeFile(resolve(dir,'review-'+id+'.json'),JSON.stringify({
      verifiedAt:new Date().toISOString(),browser:browser.version(),viewport:[1440,900],
      build:JSON.parse(await readFile(resolve(dir,'build.json'),'utf8')).sha256,reports:reports.slice(-1)
    },null,2))
    if(video){await video.saveAs(resolve(dir,'bamboo-journey.webm'));await video.delete()}
  }
  await writeFile(resolve(dir,process.argv[2]?'review-'+process.argv[2]+'.json':'verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),browser:browser.version(),viewport:[1440,900],build:JSON.parse(await readFile(resolve(dir,'build.json'),'utf8')).sha256,reports},null,2))
}catch(e){console.error('FAILED',current,e);if(page&&!page.isClosed()){console.log(await page.locator('body').innerText().catch(()=>''));await writeFile(resolve(dir,'diagnostic-state.json'),JSON.stringify(await page.evaluate(()=>window.__coreInspect?.read()).catch(()=>null),null,2));await page.screenshot({path:resolve(dir,'diagnostic.png')}).catch(()=>{})}process.exitCode=1}
finally{await browser.close()}

