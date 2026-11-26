import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CircleHelp, Droplet, Pause, Sprout, Download, RotateCcw, Scissors, Undo2, Redo2, X } from 'lucide-react'
import { heldInsertionPose } from '../scene/core/core-transforms'
import { propRotation } from '../scene/core/desk-space'
import { Quaternion, Vector3 } from 'three'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { PoseControl } from '../components/game/PoseControl'
import source from '../content/ritual-source.json'
import FlowerLibrary from '../components/game/FlowerLibrary'
import RitualGuide,{RitualSoundButton} from '../components/game/RitualGuide'
import { FLOWERS, flowerDetails, sectionableDetail } from '../content/catalog'
import { availablePose, visibleCutTargets } from '../game/rules'
import { MIN_STEM, sectionEnd } from '../game/free-cut'
import type { Quat } from '../game/types'
import { useCoreStore } from '../state/core-store'
import { canArrange } from '../services/ritual-progress'
import { loadSceneAssets, type SceneAssets } from '../services/scene-assets'
import type { CoreWorld } from '../scene/core/CoreCanvas'
import '../styles/core.css'
import '../styles/ritual.css'
const CoreCanvas=lazy(()=>import('../scene/core/CoreCanvas'))
class SceneBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<div className="core-loading" role="alert"><p>花席暂时无法显示，作品进度仍会保留。</p><Button onClick={()=>location.reload()}>重新载入</Button></div>:this.props.children}
}
export default function CorePrototype({initialAssets}:{initialAssets?:SceneAssets}={}){
  const g=useCoreStore(),[assets,setAssets]=useState<SceneAssets | undefined>(initialAssets),[error,setError]=useState(''),[ready,setReady]=useState(false)
  const [help,setHelp]=useState(false),[restart,setRestart]=useState(false),[cut,setCut]=useState(false),[target,setTarget]=useState('stem'),[at,setAt]=useState(.025)
  const world=useRef<CoreWorld|null>(null),capture=useRef<(wish?:string)=>void>(()=>{}),context=useRef<HTMLDivElement>(null)
  const selected=g.history.present.flowers.find(f=>f.id===g.selectedId&&(f.location!=='vase'||canArrange(g.ritual))),inserted=selected?.location==='vase'
  const [review,setReview]=useState(-1)
  const ritual=g.ritual, sceneId=ritual?.sceneId??'bamboo'
  useEffect(()=>{
    setCut(false);setTarget('stem');setAt(.025)
  },[g.heldId,ritual?.stage,g.scissors])
  const flowersInCup=g.history.present.flowers.some(f=>f.location==='cup')
  const vaseFull=g.history.present.vaseMl>=130||g.history.present.cupMl<=0
  const interactive=!ritual||['prepare','observe','trim','arrange','tidy'].includes(ritual.stage)
  const [switching,setSwitching]=useState(false)
  const loadId=useRef(0)
  const chooseScene=async(id:SceneAssets['sceneId'])=>{
    if(id===sceneId||switching)return
    const request=++loadId.current
    setSwitching(true)
    try{
      const next=await loadSceneAssets(id)
      if(request===loadId.current){setAssets(next);g.updateRitual({sceneId:id});setError('')}
    }catch{g.tell('这个场景暂时未能载入。可以重选，或在当前场景开始。')}
    finally{if(request===loadId.current)setSwitching(false)}
  }
  const load=useCallback(()=>{const id=++loadId.current;setError('');void loadSceneAssets(sceneId).then(next=>{if(id===loadId.current)setAssets(next)}).catch(()=>{if(id===loadId.current)setError('场景未能载入，作品仍被保留。')})},[sceneId])
  useEffect(()=>{if(assets?.sceneId!==sceneId)load()},[assets?.sceneId,sceneId,load])
  const onReady=useCallback(()=>setReady(true),[]),onWorld=useCallback((value:CoreWorld)=>{world.current=value},[]),onExport=useCallback((fn:(wish?:string)=>void)=>{capture.current=fn},[])
  const cancel=()=>{g.previewInsert(null);if(useCoreStore.getState().pourPhase==='flow')world.current?.pourAction?.('stop');world.current?.abortRitual?.();world.current?.cancel();setCut(false)}
  const travel=(direction:'undo'|'redo')=>{
    const s=useCoreStore.getState()
    if(s.insertPreview){s.previewInsert(null);return}
    if(s.pourPhase==='paused'){world.current?.pourAction?.('finish');s[direction]();return}
    if(s.pourPhase!=='carry'){world.current?.pourAction?.('cancel');return}
    if(!world.current?.cancel())s[direction]()
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.defaultPrevented||document.querySelector('[role=dialog][data-state=open]')||(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]'))return
      if(useCoreStore.getState().ritual&&!['prepare','observe','trim','arrange','tidy'].includes(useCoreStore.getState().ritual!.stage))return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();travel(e.shiftKey?'redo':'undo')}
      if(e.key==='Escape'){
        if(useCoreStore.getState().vaseFocus){world.current?.cancel();useCoreStore.getState().focusVase(false);return}
        if(useCoreStore.getState().insertPreview){useCoreStore.getState().previewInsert(null);return}
        const phase=useCoreStore.getState().pourPhase
        if(phase!=='carry'){world.current?.pourAction?.(phase==='flow'?'stop':'cancel');return}
        if(!world.current?.cancel()){const state=useCoreStore.getState();if(state.ritual?.stage==='trim'&&state.scissors)state.parkScissors();else state.putDown()}setCut(false)}
    }
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
  },[])
  const insert=()=>{
    const s=useCoreStore.getState(),f=s.history.present.flowers.find(f=>f.id===s.selectedId)
    if(!f)return
    if(s.insertPreview){s.dispatch({type:'insert',id:f.id,pose:s.insertPreview});return}
    const turned=s.heldId===f.id&&s.turn.some((v,i)=>Math.abs(v-[0,0,0,1][i])>.0001)
    const orientation=heldInsertionPose(f,propRotation(s.history.present,'vase'),turned?new Quaternion(...s.turn):undefined)
    const pose=availablePose(s.history.present,f,orientation)
    if(!pose){s.tell('当前角度没有可用插点，请转动花枝或调整瓶内花枝。');return}
    s.parkScissors()
    if(!s.ritual){s.dispatch({type:'insert',id:f.id,pose});return}
    s.previewInsert(pose);s.tell('看看花枝的位置，合意就确认插入。')
  }
  const rotate=(direction:number)=>{
    cancel();if(!selected)return
    if(inserted)g.dispatch({type:'rotate',id:selected.id,degrees:direction*10})
    else{
      const turn:Quat=g.heldId===selected.id?g.turn:[0,0,0,1]
      if(g.heldId!==selected.id)g.select(selected.id)
      g.setTurn(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),direction*.2).multiply(new Quaternion(...turn)).toArray() as Quat)
    }
  }
  const adjust=(direction:number,axis:'x'|'z'='x')=>{
    cancel();if(!selected)return
    const p=selected.pose
    const pose=g.mode==='yaw'?{yaw:p.yaw+direction*5}:g.mode==='tilt'?{tilt:p.tilt+direction}:g.mode==='depth'?{depth:p.depth+direction*.005}:{[axis]:p[axis]+direction*.001}
    g.dispatch({type:'adjust',id:selected.id,pose})
  }
  const preview=(value:number,newTarget=target)=>{setAt(value);world.current?.cut(newTarget,value,false)}
  const downloadBackup=()=>{
    if(!g.blocked)return
    const url=URL.createObjectURL(new Blob([g.blocked],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='花席原进度备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const cuttings=ritual&&['trim','arrange','tidy'].includes(ritual.stage)?g.history.present.debris:[]
  const loose=cuttings.some(piece=>!piece.gathered)
  const gathered=cuttings.some(piece=>piece.gathered)
  const clearGathered=()=>{world.current?.cancelPiece?.();g.dispatch({type:'clear-gathered'})}
  const clearAction=<Button size="sm" variant="ghost" onClick={clearGathered}>清理已归拢</Button>
  const cuttingActions=interactive&&!g.vaseFocus&&(loose||gathered)&&!g.blocked&&<div className="desk-cuttings-actions" role="group" aria-label="桌边残枝">
          {loose&&<Button size="sm" variant="ghost" onClick={()=>world.current?.gatherPieces?.()}>残枝放到一边</Button>}
          {gathered&&(ritual?.stage==='tidy'?clearAction:
            <details className="desk-cuttings-menu" onKeyDown={event=>{
              if(event.key==='Escape'&&event.currentTarget.open){
                event.stopPropagation();event.preventDefault();event.currentTarget.open=false
                event.currentTarget.querySelector('summary')?.focus()
              }
            }} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false}}>
              <summary aria-label="桌边残枝选项">桌边</summary>{clearAction}
            </details>)}
      </div>
  return <main className={"core-studio"+(ritual?" ritual-studio":"")} data-vase-focus={g.vaseFocus} data-pour={g.pourPhase} data-stage={ritual?.stage} data-core-ready={ready} data-held={g.heldId??''} data-selected={g.selectedId??''} data-tool={g.scissors?'scissors':''} data-debris={g.history.present.debris.length} data-history={g.history.past.length}>
    <div className="core-canvas" aria-label="三维插花桌面">
      {assets&&<SceneBoundary><Suspense fallback={<div className="core-loading">正在备好花席…</div>}><CoreCanvas assets={assets} onReady={onReady} onWorld={onWorld} onExport={onExport} contextRef={context}/></Suspense></SceneBoundary>}
    </div>
    {ritual?.stage==='prepare'&&g.cupHeld&&!g.blocked&&<div className="cup-pour-actions" data-flow={g.pourPhase==='flow'} role="group" aria-label="杯子倒水">
      <Button size="sm" disabled={!flowersInCup&&vaseFull&&g.pourPhase!=='flow'}
        onClick={()=>{
          if(flowersInCup){g.dispatch({type:'empty-cup'});return}
          world.current?.pourAction?.(g.pourPhase==='flow'?'stop':'start')
        }}>
        {flowersInCup?<Sprout aria-hidden="true"/>:g.pourPhase==='flow'?<Pause aria-hidden="true"/>:<Droplet aria-hidden="true"/>}
        {flowersInCup?'先放下花枝':g.pourPhase==='flow'?'停止倒水':vaseFull?(g.history.present.vaseMl>=130?'花瓶已满':'杯中无水'):g.pourPhase==='paused'?'继续添水':'开始倒水'}
      </Button>
      {g.pourPhase==='paused'&&<><Button size="sm" variant="secondary" onClick={()=>world.current?.pourAction?.('retry')}>重新倒水</Button><Button size="sm" variant="secondary" onClick={()=>world.current?.pourAction?.('finish')}>完成倒水</Button></>}
    </div>}
    {ritual&&<RitualGuide trimTools={ritual.stage==='trim'&&!g.blocked&&
      <div className="trim-tools" role="group" aria-label="修剪工具">
        <Button className="desk-trim-trigger" disabled={!g.heldId||!ready} aria-pressed={g.scissors}
          onClick={()=>{if(g.scissors){cancel();g.parkScissors()}else g.takeScissors()}}>
          <Scissors aria-hidden="true"/>{g.scissors?'收剪':'裁剪'}
        </Button>
        {cuttingActions}
      </div>} onTidy={()=>{world.current?.gatherPieces?.(true);g.updateRitual({line:1})}} library={ready&&!g.blocked&&['prepare','arrange'].includes(ritual.stage)&&
      <FlowerLibrary key={ritual.stage} destination={ritual.stage==='prepare'?'cup':'table'} disabled={g.pourPhase==='flow'}
        onOpen={()=>{cancel();return world.current?.portraits?.()??{}}}
        preview={choice=>world.current?.sampleFlower?.(choice)}/>} ready={ready&&!switching&&assets?.sceneId===sceneId&&!error} onScene={chooseScene} onExport={wish=>capture.current(wish)}/>}
    {!ritual&&<header className="core-heading"><span className="core-brand">一席花</span><h1>{g.scissors?'有所取舍，也可以保留原样。':g.heldId?'拿近一点，看见花的姿态。':inserted?'顺着花的方向，慢慢安放。':'拿起一枝，慢慢看。'}</h1><p role="status" aria-live="polite">{g.message}</p>{g.storageError&&<small>进度暂未保存，请保持页面打开。</small>}</header>}
    {(interactive||ritual?.stage==='bless')&&<nav className="core-utilities" aria-label="便捷操作">
      {ritual&&<RitualSoundButton/>}
      {interactive&&<><Button variant="ghost" size="icon" aria-label="撤销" title="撤销" onClick={()=>travel('undo')} disabled={!g.history.past.length}><Undo2/></Button>
      <Button variant="ghost" size="icon" aria-label="重做" title="重做" onClick={()=>travel('redo')} disabled={!g.history.future.length}><Redo2/></Button>
      <Button variant="ghost" size="icon" aria-label="操作帮助" title="操作帮助" onClick={()=>{cancel();setHelp(true)}}><CircleHelp/></Button></>}
    </nav>}
    {g.vaseFocus&&<aside className="vase-guide" aria-label="整理瓶中花枝"><strong>{inserted?'调整这一枝':'点一枝花，调整朝向'}</strong>
      {inserted&&<div className="vase-adjust">{([['yaw','朝向'],['tilt','倾斜'],['depth','深浅'],['point','插点']] as const).map(([mode,label])=><Button key={mode} size="sm" variant={g.mode===mode?'secondary':'ghost'} aria-pressed={g.mode===mode} onClick={()=>g.setMode(mode)}>{label}</Button>)}
        {g.mode!=='free'&&<><Button aria-label="减小调整" size="sm" onClick={()=>adjust(-1)}>−</Button><Button aria-label="增大调整" size="sm" onClick={()=>adjust(1)}>＋</Button></>}
        {g.mode==='point'&&<><Button size="sm" onClick={()=>adjust(1,'z')}>向前</Button><Button size="sm" onClick={()=>adjust(-1,'z')}>向后</Button></>}</div>}
      <Button onClick={()=>g.focusVase(false)}>整理好了</Button></aside>}
    <div className="desk-action-layout">
      {interactive&&!g.vaseFocus&&selected&&(!ritual||g.heldId||inserted)&&!g.blocked&&<div className="core-context" data-desk-card={Boolean(ritual&&(g.insertPreview||inserted))} data-held-card={!!(ritual&&g.heldId&&!g.insertPreview)} ref={context} aria-label="当前花枝操作">
        {selected&&<>
        {!inserted&&!g.insertPreview&&<><Button variant="ghost" size="icon" aria-label="花枝左转" onClick={()=>rotate(-1)}>{ritual?'左转':<ArrowLeft/>}</Button><Button variant="ghost" size="icon" aria-label="花枝右转" onClick={()=>rotate(1)}>{ritual?'右转':<ArrowRight/>}</Button></>}
        {(g.heldId||g.scissors)&&!g.insertPreview&&<Button variant="ghost" onClick={()=>{cancel();g.putDown()}}>放回</Button>}
        {inserted?<Button variant="ghost" onClick={()=>{cancel();g.dispatch({type:'to-table',id:selected.id});g.select(selected.id)}}>取出</Button>:<>
          {canArrange(ritual)&&<Button variant="ghost" onClick={insert}>{g.insertPreview?'确认插入':'放入花瓶'}</Button>}
          {g.insertPreview&&<Button variant="ghost" onClick={()=>g.previewInsert(null)}>取消插入</Button>}
          {!ritual&&<Button variant="ghost" aria-label="拿起花剪" onClick={()=>{cancel();g.takeScissors()}}><Scissors/>花剪</Button>}
        </>}
        {g.heldId&&ritual?.stage==='trim'&&<div className="desk-trim-actions">
          {g.scissors&&<Button variant="ghost" onClick={()=>{setCut(!cut);if(cut)cancel()}}>选剪口</Button>}
          <Button variant="ghost" aria-label="整枝放到桌边" onClick={()=>world.current?.sideFlower?.()}>放到桌边</Button>
        </div>}
        {!ritual&&g.scissors&&g.heldId&&<Button variant="ghost" onClick={()=>{setCut(!cut);if(cut)cancel()}}>选剪口</Button>}
        {inserted&&<div className="core-pose-options">
          <div className="core-pose-modes">
            {ritual&&<Button variant={g.mode==='free'?'secondary':'ghost'} size="sm" aria-pressed={g.mode==='free'} onClick={()=>g.setMode('free')}>自由调姿</Button>}
            {([['yaw','朝向'],['tilt','倾斜'],['depth','深浅'],['point','插点']] as const).map(([mode,label])=><Button key={mode} variant={g.mode===mode?'secondary':'ghost'} size="sm" aria-pressed={g.mode===mode} onClick={()=>{cancel();g.setMode(mode)}}>{label}</Button>)}
          </div>
          {g.mode!=='free'&&<div className="core-pose-steps"><Button variant="ghost" size="icon-sm" aria-label="减小调整" onClick={()=>adjust(-1)}>−</Button><Button variant="ghost" size="icon-sm" aria-label="增大调整" onClick={()=>adjust(1)}>＋</Button>
          {g.mode==='point'&&<><Button variant="ghost" onClick={()=>adjust(1,'z')}>向前</Button><Button variant="ghost" onClick={()=>adjust(-1,'z')}>向后</Button></>}
          </div>}
        </div>}
        {cut&&g.scissors&&g.heldId&&<div className="core-cut-options">
          <label>剪哪里<select aria-label="修剪部位" value={target} onChange={e=>{const t=e.target.value;setTarget(t);preview(t==='stem'?.02:flowerDetails(selected).some(d=>d.id===t)&&!sectionableDetail(selected.kind,t)?0:.5,t)}}><option value="stem">花茎</option>{visibleCutTargets(selected).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {(!flowerDetails(selected).some(d=>d.id===target)||sectionableDetail(selected.kind,target))&&<PoseControl disabled={false} label={target==='stem'?'剪下长度':'部位保留'} value={target==='stem'?Math.round(at*1000):Math.round(at*100)} min={target==='stem'?1:0} max={target==='stem'?Math.max(1,Math.round((selected.length-MIN_STEM)*1000)):Math.max(0,Math.ceil(sectionEnd(selected,target)*100)-1)} step={1} unit={target==='stem'?'mm':'%'} onCommit={n=>preview(n/(target==='stem'?1000:100))}/>}
          <Button size="sm" onClick={()=>{if(world.current?.cut(target,at,true))setCut(false)}}>确认剪下</Button><Button size="sm" variant="ghost" onClick={cancel}>取消</Button>
        </div>}
        </>}
      </div>}
      {ritual?.stage!=='trim'&&cuttingActions}
    </div>
    {(!assets||error)&&<div className="core-loading" role={error?'alert':'status'}><p>{error||'正在备好花席…'}</p>{error&&<Button onClick={load}>重新载入</Button>}</div>}
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="core-dialog"><DialogHeader><DialogTitle>随手而动，慢慢来</DialogTitle><DialogDescription>备席时点一下，物件自动抬起并保持高度。移动鼠标控制桌上的左右和前后，再点一下放下。滚轮可微调远近。右键或 Shift 拖动旋转，旋转时滚轮可沿视线翻转。拿起水杯，点一下花瓶或瓶旁「倒水」便可倾杯。点「停止倒水」看水量，可以继续添水或重新倒水，点「完成倒水」回到桌面。第二式点花拿近欣赏，拖动画面转动花枝。第三式点一下花就会自动拿到中央，再点左侧「裁剪」。指向枝叶看金色预览，轻点剪下。拖动花枝可转动，触屏先点预览、再点确认。第四式可拖整枝到瓶口，松手插入。也可先拿花，再点花瓶预览和确认。按住 Shift 拖动可转花。Esc 取消，Ctrl / ⌘ + Z 撤销。</DialogDescription></DialogHeader>
      {ritual?.stage==='prepare'&&<Button variant="outline" onClick={()=>{setHelp(false);g.updateRitual({stage:'opening',line:0})}}>重看调心</Button>}
      {ritual&&<details className="ritual-review"><summary>回读五式引导</summary>
        <label>选择一式 <select value={review} onChange={e=>setReview(Number(e.target.value))}><option value={-1}>请选择</option>{source.chapters.map((chapter,i)=><option key={chapter.name} value={i}>{chapter.name}</option>)}</select></label>
        {review>=0&&<p>{source.chapters[review]?.text}</p>}
      </details>}
      <div className="core-help-actions">{ritual?.stage==='prepare'&&<>
        <Button onClick={()=>{g.dispatch({type:'set-prop',prop:'vase',position:[0,.759,.26]});setHelp(false)}}>将花器摆到身前</Button>
        <Button onClick={()=>{g.dispatch({type:'set-prop',prop:'scissors',position:[.37,.768,.12]});setHelp(false)}}>将花剪摆到右侧</Button>
        <Button onClick={()=>{g.dispatch({type:'empty-cup'});setHelp(false)}}>取出杯中花草</Button>
        <Button onClick={()=>{setHelp(false);world.current?.takeCup?.()}}>拿起水杯</Button></>}{ritual?.stage!=='tidy'&&g.history.present.flowers.map(f=><Button key={f.id} variant="outline" onClick={()=>{g.select(f.id);setHelp(false)}}>拿起{FLOWERS[f.kind].name}</Button>)}</div>
      <div className="core-help-actions"><Button variant="outline" onClick={()=>{setHelp(false);capture.current()}}><Download/>保存作品图片</Button><Button variant="outline" onClick={()=>{if(ritual)world.current?.gatherPieces?.(true);else g.dispatch({type:'tidy'});setHelp(false)}} disabled={!!ritual&&ritual.stage!=='tidy'}>收好花席</Button><Button variant="ghost" onClick={()=>{setHelp(false);setRestart(true)}}><RotateCcw/>重新开始</Button></div>
    </DialogContent></Dialog>
    <Dialog open={restart||!!g.blocked} onOpenChange={setRestart}><DialogContent className="core-dialog"><DialogHeader><DialogTitle>{g.blocked?'原进度需要保留':'重新开始这一席？'}</DialogTitle><DialogDescription>{g.blocked?'保存的数据暂时无法读取。可以先下载备份，再明确开始新的一席。':'开始新的一席会替换当前作品，可以先保存作品图片。'}</DialogDescription></DialogHeader>
      {g.blocked&&<Button variant="outline" onClick={downloadBackup}>下载原进度备份</Button>}<Button disabled={!ready||switching||!!error} onClick={()=>{cancel();g.restart();setRestart(false)}}>开始新的一席</Button>{!g.blocked&&<Button variant="ghost" onClick={()=>setRestart(false)}><X/>保留当前作品</Button>}
    </DialogContent></Dialog>
  </main>
}
