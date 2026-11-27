import { useEffect,useState,useSyncExternalStore } from 'react'
import { Button } from '../ui/button'
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '../ui/dialog'
import { CHAPTERS } from '../../content/chapters'
import { VASE_START, SHEARS_START } from '../../game/desk-layout'
import { SCENES, hasCuts } from '../../content/catalog'
import source from '../../content/ritual-source.json'
import { useCoreStore } from '../../state/core-store'
import { soundscape } from '../../services/soundscape'
import type { Stage } from '../../services/ritual-progress'
import type { SceneId } from '../../game/types'

const opening=source.opening
const closing=source.closing
export default function RitualGuide({ready,onScene,onExport,library,onTidy,trimTools}:{trimTools?:import('react').ReactNode;onTidy:()=>void;library?:import('react').ReactNode;ready:boolean;onScene:(id:SceneId)=>void;onExport:(wish?:string)=>void}){
  const g=useCoreStore(),ritual=g.ritual!,{stage,line,wish,sceneId}=ritual,work=g.history.present
  const [reset,setReset]=useState(false),[include,setInclude]=useState(true),[confirmSkip,setConfirmSkip]=useState(false)
  const [writing,setWriting]=useState(false),audio=useSyncExternalStore(soundscape.subscribe,soundscape.getSnapshot)
  const chapter=CHAPTERS.find(c=>c.id===(stage==='tidy'?'arrange':stage==='done'?'bless':stage)), text=stage==='opening'?opening:closing
  const go=(stage:Stage)=>{g.updateRitual({stage,line:0});setWriting(false);setConfirmSkip(false)}
  useEffect(()=>{
    soundscape.setScene(sceneId)
    soundscape.setMix(stage==='arrival'?0:['return','done'].includes(stage)?.48:1.9,stage==='arrival'||stage==='done'||stage==='return'?1:.67)
  },[sceneId,stage])
  useEffect(()=>{
    const unlock=()=>{if(soundscape.getSnapshot().enabled)soundscape.prime()}
    const hidden=()=>{if(document.hidden)soundscape.pauseForBackground()}
    if(soundscape.getSnapshot().enabled)soundscape.prime()
    window.addEventListener('pointerdown',unlock,true);window.addEventListener('keydown',unlock,true);document.addEventListener('visibilitychange',hidden)
    return()=>{window.removeEventListener('pointerdown',unlock,true);window.removeEventListener('keydown',unlock,true);document.removeEventListener('visibilitychange',hidden);soundscape.dispose()}
  },[])
  useEffect(()=>{
    if(!ready||!['opening','return'].includes(stage))return
    const duration=Math.max(5200,(text[line]?.length??0)*275)
    const timer=setTimeout(()=>line+1<text.length?g.updateRitual({line:line+1}):go(stage==='opening'?'materials':'done'),duration)
    return()=>clearTimeout(timer)
  },[stage,line,ready])
  const advance=()=>line+1<text.length?g.updateRitual({line:line+1}):go(stage==='opening'?'materials':'done')
  if(stage==='materials')return <section className="seat-selection"><div><small>备席之前</small><h1>选这一席花材</h1>
    <p>可用杯中的花，也可从花材库搭配花、叶与草。</p>{library}
    <Button disabled={!ready} onClick={()=>go('prepare')}>用这些花材开始备席</Button></div></section>
  if(stage==='arrival')return <section className="ritual-intro"><p>静心插花</p><h1>一席花</h1><div className="ritual-scenes">{SCENES.map(s=><button disabled={!ready} key={s.id} aria-pressed={s.id===sceneId} onClick={()=>onScene(s.id)}>{s.name}</button>)}</div><Button disabled={!ready} onClick={()=>{soundscape.prime();go('opening')}}>开始插花</Button>{g.previousSeat&&<button className="sound-link" disabled={!ready} onClick={g.recoverSeat}>取回刚才的作品</button>}<small>{ready?(g.message||'拖动环顾四周'):'正在准备场景光影…'}</small>{audio.status!=='playing'&&<button className="sound-link" onClick={soundscape.play}>开启自然声</button>}</section>
  if(stage==='opening'||stage==='return')return <section className="ritual-reading"><div><div className="ritual-lines"><small>{stage==='opening'?'调 心':'回 到 当 下'}</small><p key={stage+line} style={{animationDuration:Math.max(5200,(text[line]?.length??0)*275)+'ms'}}>{text[line]}</p></div>
    <div className="reading-controls"><Button className="reading-enter" onClick={()=>go(stage==='opening'?'materials':'done')}>{stage==='opening'?'准备花材':'看作品'}</Button><div className="ritual-links"><button onClick={advance}>下一段</button><button onClick={()=>g.updateRitual({line:0})}>重读</button></div></div></div></section>
  const bottled=work.flowers.some(f=>f.location==='vase'),pouring=g.pourPhase==='flow',paused=g.pourPhase==='paused'
  const observe=()=>{
    const f=work.flowers.find(f=>f.id===g.selectedId&&f.location!=='vase')??work.flowers.find(f=>f.location!=='vase')
    if(f)g.select(f.id)
  }
  function cue():string{
    const flowersInCup=work.flowers.some(f=>f.location==='cup')
    switch(stage){
      case 'prepare':{
        if(pouring)return '留意水线，合意时点「停止倒水」。'
        if(paused)return '水流已停。点「完成倒水」收杯，或继续添水。'
        if(g.cupHeld){
          if(flowersInCup)return '点杯旁的「先放下花枝」，把杯口空出来。'
          if(g.pourPhase==='ready')return '杯沿已对准，点花瓶或「开始倒水」。'
          if(work.vaseMl>=130||work.cupMl===0)return '把水杯放回木盒，准备好后点「完成备席」。'
          if(work.vaseMl>0)return '把水杯放回木盒，也可以再点花瓶添水。'
          return '轻点花瓶或「开始倒水」，让水缓缓注入花器。'
        }
        if(g.carriedProp==='vase')return '把花器移到身前，轻点桌面放下。'
        if(g.carriedProp==='scissors')return '把花剪移到花器右侧，轻点桌面放下。'
        if(g.heldId)return '把花枝移到花器左侧，轻点桌面放下。'
        if(work.vaseMl>0)return '备席已妥，点「完成备席」开始赏花。'
        const tools=work.tools
        const vasePlaced=tools?.placed?.vase||Math.hypot(work.vase.x-VASE_START[0],work.vase.z-VASE_START[2]-.025)>.003
        const shearsPlaced=tools?.placed?.scissors||(tools&&Math.hypot(tools.scissors[0]-SHEARS_START[0],tools.scissors[2]-SHEARS_START[2])>.003)
        if(!vasePlaced)return '轻点花器，把它放到身前。'
        if(!shearsPlaced)return '轻点花剪，把它放在花器右侧。'
        if(flowersInCup)return '从杯中取出花枝，轻放在花器左侧。'
        return '轻点玻璃杯拿起，对准花瓶后点「开始倒水」。'
      }
      case 'observe':
        if(g.heldId)return '轻拖转动花枝，看一看花、叶和茎，赏完点「放回」。'
        return ritual!.observed?'可以再赏一枝，或点「看好了，开始修剪」。':'轻点一枝花，拿到眼前慢慢看。'
      case 'trim':
        if(!g.heldId)return work.flowers.some(hasCuts)?'这枝已修好。可以再选一枝，或进入第四式。':'轻点想修的花枝，拿到中央，也可以保留原样。'
        if(!g.scissors)return '轻拖花枝转动角度，想修剪时点左侧「裁剪」。'
        if(g.message.includes('再点一次'))return '再点一次预览位置，剪下这一节。'
        if(g.message.includes('点击剪下')||g.message.includes('点这一节'))return '看清金色预览，轻点剪下这一节。'
        if(g.lastCommand?.type==='free-cut'&&g.lastCommand.id===g.heldId)return '还可以指向下一处剪口，或把整枝放到桌边。'
        return '指向想剪的枝、叶或花头，看清预览再轻点。'
      case 'arrange':
        if(g.vaseFocus)return g.selectedId?'在瓶旁调整这枝的朝向、倾斜或深浅。':'点选瓶中的一枝，近看并调整它的位置。'
        if(!ritual!.arranging)return '点「插花」，开始安放这一席花。'
        if(g.insertPreview)return '看好插点和方向，点「确认插入」安放。'
        if(g.heldId)return '把花枝拖到瓶口松手，或轻点花瓶预览。'
        return bottled?'轻点花瓶调整，或继续添一枝，合意时点「插好了」。':'轻点桌面或杯中的一枝花，准备插入。'
      case 'tidy':
        if(g.vaseFocus)return '选好瓶中花枝调整，完成后点「整理好了」。'
        return line?'花席已收好，点「开始祝愿」。':'点「收好花席」，归好花剪和残枝。'
      case 'bless':
        if(writing)return '写下想说的话，准备好后点「送出祝愿」。'
        return line?'祝愿已送出。静看片刻，也可以点「恢复本来空」收席。':'想起一位想感谢的人，轻点作品或「送出祝愿」。'
      default:return '可先保存作品，点「恢复本来空」让器物归位。'
    }
  }
  const detail=cue()
  const emptySeat=()=>{setWriting(false);setInclude(true);g.returnToEmpty()}
  const reading=stage==='observe'?source.observe:stage==='trim'?source.trim:source.arrange
  return <><header data-audio={audio.status} className="core-heading ritual-heading">
    <div className="step-card"><small>第{chapter?.number}式</small><h1>{chapter?.name}</h1>
</div>
    <div className="ritual-step-notes" role="status">
      {line>0&&['observe','trim','arrange'].includes(stage)&&<small>{reading[line%3]}</small>}
      {stage==='done'&&g.saveNotice&&<small>{g.saveNotice}</small>}
      {g.storageError&&<small>当前浏览器无法保存进度，请先保存作品图片。</small>}
    </div>
    {!g.vaseFocus&&!pouring&&!paused&&<div className="ritual-actions">
    {stage==='prepare'&&<><Button onClick={()=>work.vaseMl?go('observe'):setConfirmSkip(true)}>完成备席</Button>{library}<button onClick={()=>setReset(true)}>重新备席</button></>}
    {stage==='observe'&&<><Button disabled={!work.flowers.some(f=>f.location!=='vase')} onClick={observe}>{ritual.observed?'重新赏花':'开始赏花'}</Button><button onClick={()=>go('trim')}>看好了，开始修剪</button></>}
    {stage==='trim'&&<Button onClick={()=>go('arrange')}>进入第四式</Button>}
    {stage==='arrange'&&<>{!ritual.arranging&&<Button onClick={()=>g.updateRitual({arranging:true})}>插花</Button>}{bottled&&!g.heldId&&!g.carriedProp&&!g.insertPreview&&<button className="finish-arrangement" onClick={()=>go('tidy')}>插好了</button>}{library}<button onClick={()=>go('trim')}>返回第三式</button></>}
    {stage==='tidy'&&(line?<Button onClick={()=>go('bless')}>开始祝愿</Button>:<Button onClick={onTidy}>收好花席</Button>)}
    {stage==='tidy'&&<button onClick={()=>{g.updateRitual({stage:'arrange',arranging:true,line:0});if(bottled)g.focusVase(true)}}>继续调整</button>}
    {bottled&&!g.heldId&&!g.insertPreview&&stage==='arrange'&&ritual.arranging&&<button onClick={()=>g.focusVase(true)}>整理瓶中花枝</button>}
    {['observe','trim','arrange'].includes(stage)&&<button onClick={()=>g.updateRitual({line:line%2+1})}>再读一句</button>}
    {stage==='bless'&&<><Button onClick={()=>{useCoreStore.setState({offering:performance.now()});setWriting(false);g.updateRitual({line:1})}}>送出祝愿</Button><button onClick={()=>setWriting(v=>!v)}>留一句祝愿</button><button onClick={()=>go('return')}>回到当下</button><button onClick={()=>go('done')}>直接完成</button><button disabled={g.saving} onClick={emptySeat}>恢复本来空</button></>}
    {stage==='done'&&<><Button disabled={g.saving} onClick={event=>{if(event.detail<2)onExport(include?wish:'')}}>{g.saving?'正在保存…':'保存作品'}</Button><button onClick={()=>go('arrange')}>继续调整</button><button disabled={g.saving} onClick={emptySeat}>恢复本来空</button></>}
    </div>}
    {stage==='trim'&&trimTools}
    {stage==='bless'&&writing&&<textarea aria-label="我的祝愿" placeholder="愿……" maxLength={200} value={wish} onChange={e=>g.updateRitual({wish:e.target.value})}/>}
    {stage==='done'&&wish&&<label><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)}/> 图片附上我的祝愿</label>}


    </header>
    {!(stage==='prepare'&&g.cupHeld)&&!g.vaseFocus&&<div className="ritual-step-cue ritual-feedback" role="status" aria-label="当前步骤"><p key={pouring?'pour':'guide'} data-water-note={pouring?'':undefined}>{detail}</p></div>}
    <Dialog open={reset} onOpenChange={setReset}><DialogContent><DialogTitle>重新备席？</DialogTitle><DialogDescription>本式的水量、花材和器物会回到入席时的摆放。仍在当前场景，可以撤销。</DialogDescription><Button onClick={()=>{setReset(false);g.restartPreparation()}}>确认重新备席</Button><button onClick={()=>setReset(false)}>继续当前花席</button></DialogContent></Dialog>
    <Dialog open={confirmSkip} onOpenChange={setConfirmSkip}><DialogContent><DialogTitle>还未给花器注水</DialogTitle><DialogDescription>可以继续备席，也可以先去赏花。</DialogDescription><Button onClick={()=>setConfirmSkip(false)}>继续备席</Button><button onClick={()=>go('observe')}>略过注水</button></DialogContent></Dialog></>
}


export function RitualSoundButton(){
  const audio=useSyncExternalStore(soundscape.subscribe,soundscape.getSnapshot)
  const playing=audio.status==='playing'
  return <Button variant="ghost" className="ritual-sound" aria-pressed={playing} onClick={()=>playing?soundscape.pause():soundscape.play()}>{playing?'静音':'开启声音'}</Button>
}
