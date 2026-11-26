import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleHelp, Compass, Flower2, RotateCcw, Download, ArrowLeft, ArrowRight, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import TableActions from '../components/game/TableActions'
import ControlPanel from '../components/game/ControlPanel'
import RecoveryNotice from '../components/game/RecoveryNotice'
import SoundControls from '../components/game/SoundControls'
import { soundscape } from '../services/soundscape'
import { useGameStore } from '../state/game-store'
import { SCENES, assetUrl } from '../content/catalog'
import { CHAPTERS } from '../content/chapters'
import { loadSceneAssets, type SceneAssets } from '../services/scene-assets'
import type { SceneId } from '../game/types'
const GameCanvas=lazy(()=>import('../scene/GameCanvas'))
class SceneBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<div role="alert" className="scene-fallback"><h2>花席暂时无法显示</h2><p>已保存的进度会保留，请重新载入。</p><Button onClick={()=>location.reload()}>重新载入</Button></div>:this.props.children}
}
export default function App(){
  const g=useGameStore()
  const [choosing,setChoosing]=useState(!g.session),[choice,setChoice]=useState<SceneId>(g.session?.sceneId||'bamboo')
  const [assets,setAssets]=useState<SceneAssets>(),[busy,setBusy]=useState(false),[loadError,setLoadError]=useState('')
  const [help,setHelp]=useState(false),[restart,setRestart]=useState(false),[ready,setReady]=useState(false)
  const [panelCollapsed,setPanelCollapsed]=useState(false)
  const capture=useRef<()=>void>(()=>{})
  const onReady=useCallback(()=>setReady(true),[])
  const onCapture=useCallback((fn:()=>void)=>{capture.current=fn},[])
  const request=useRef(0)
  const enter=async(id:SceneId,newSession:boolean)=>{
    const seq=++request.current;setBusy(true);setLoadError('')
    try{
      const next=await loadSceneAssets(id);if(seq!==request.current)return
      setAssets(next);setReady(false)
      if(newSession)g.start(id)
      setChoosing(false)
    }catch{if(seq===request.current)setLoadError('场景未能载入，请重试。现有作品仍被保留。')}
    finally{if(seq===request.current)setBusy(false)}
  }
  useEffect(()=>{const s=useGameStore.getState().session;if(s)void enter(s.sceneId,false);return()=>{request.current++}},[])
  useEffect(()=>{
    const keyboard=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).matches('input,textarea,[contenteditable="true"]')||help||restart||choosing)return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)useGameStore.getState().redo();else useGameStore.getState().undo()}
      if(e.key==='Escape'){const state=useGameStore.getState();state.putDown();if(state.looking)state.returnToTable()}
    }
    const blur=()=>useGameStore.getState().putDown()
    window.addEventListener('keydown',keyboard);window.addEventListener('blur',blur)
    return()=>{window.removeEventListener('keydown',keyboard);window.removeEventListener('blur',blur)}
  },[help,restart,choosing])
  const index=CHAPTERS.findIndex(c=>c.id===g.session?.chapter),chapter=CHAPTERS[index]||CHAPTERS[0]
  const scene=SCENES.find(s=>s.id===g.session?.sceneId)
  const saveImage=()=>{g.returnToTable();g.putDown();g.select(null);requestAnimationFrame(()=>requestAnimationFrame(()=>capture.current()))}
  return <main className="studio">
    <header className="studio-header">
      <div className="brand"><span className="brand-symbol"><Flower2 strokeWidth={1.4} size={25}/></span><span>一席花</span><span className="brand-caption">静心插花</span></div>
      <span className="practice-label">{choosing?'择一处安静':scene?.name}</span>
      <div className="header-actions">{g.session&&<span className={'save-state '+(g.storageProblem?'has-problem':'')}><Check size={14}/>{g.storageProblem?'暂未保存':g.restored?'已恢复上次作品':'进度自动保存'}</span>}
        <SoundControls scene={!choosing&&!loadError&&ready?assets?.sceneId:undefined}/>
        <Button variant="ghost" size="icon" aria-label="操作帮助" onClick={()=>setHelp(true)}><CircleHelp size={20}/></Button>
        {g.session&&<Button variant="ghost" size="icon" aria-label="开启新一席" onClick={()=>setRestart(true)}><RotateCcw size={18}/></Button>}
      </div>
    </header>
    <RecoveryNotice onReset={()=>setRestart(true)}/>
    {choosing&&<section className="scene-picker">
      <p className="eyebrow">随景入席 · 随心安放</p><h1>今天，在哪里听花？</h1><p className="picker-intro">一张木台，一杯清水。让手边的花草，慢慢成为自己的样子。</p>
      <div className="scene-cards">{SCENES.map(s=><button className="scene-card" key={s.id} aria-pressed={choice===s.id} onClick={()=>setChoice(s.id)} disabled={busy} aria-label={'选择'+s.name}>
        <img src={assetUrl(s.preview)} alt={s.name+'花席预览'}/><span className="card-body"><strong>{s.name}</strong><span>{s.detail}</span><i>{choice===s.id?'已选':'选择这一席'}</i></span>
      </button>)}</div>
      <div className="entry-actions"><Button disabled={busy||g.recoveryBlocked} onClick={()=>{soundscape.prime();void enter(choice,true)}}>{busy?'正在备好花席…':'入席'}</Button>{g.session&&!g.recoveryBlocked&&<Button variant="outline" disabled={busy} onClick={()=>{soundscape.prime();setChoosing(false);setLoadError('');if(!assets)void enter(g.session!.sceneId,false)}}>回到原作品</Button>}</div>
      <p className="picker-note">选一处喜欢的风景，慢慢插好这一席花。入席后可环视四周，直接点选桌上器物。</p>
      {loadError&&<p role="alert" className="load-error">{loadError}</p>}
    </section>}
    {!choosing&&(!assets||loadError)&&<div className="scene-load-page" role={loadError?'alert':'status'}><p>{loadError||'正在恢复花席…'}</p>{loadError&&<Button onClick={()=>void enter(g.session!.sceneId,false)}>重试载入场景</Button>}</div>}
    {assets&&<div className={'studio-workspace'+(panelCollapsed?' panel-collapsed':'')} hidden={choosing||Boolean(loadError)}>
      <section className="scene-introduction" aria-label="当前引导">
        <div className="scene-heading"><span className="quiet-label">{scene?.name} · {g.looking?'环视四周':chapter.name}</span><h1>{g.looking?'四顾皆自在。':chapter.title}</h1><p>{g.looking?'拖动画面环视，回到花席后继续创作。':chapter.hint}</p>
          {g.session?.chapter==='arrange'&&safelyDry(g.history.present.vaseMl)&&<small className="gentle-reminder">花瓶还没有水，可以回到备席补上。</small>}
          {panelCollapsed && !g.looking && !g.recoveryBlocked && <TableActions/>}
        </div>
        <div className="chapter-actions">
          <Button variant="outline" className="panel-toggle" aria-expanded={!panelCollapsed} aria-controls="flower-controls" disabled={g.dragging} onClick={()=>setPanelCollapsed(value=>!value)}>
            {panelCollapsed?<PanelRightOpen size={16}/>:<PanelRightClose size={16}/>}<span>{panelCollapsed?'展开工具栏':'收起工具栏'}</span>
          </Button>
          {index>0&&<Button variant="ghost" onClick={()=>g.goChapter(CHAPTERS[index-1].id)}><ArrowLeft size={15}/>上一步</Button>}
          {index<CHAPTERS.length-1?<Button onClick={()=>g.goChapter(CHAPTERS[index+1].id)}>{index===6?'完成作品':index===3?'继续插花':'继续'}<ArrowRight size={15}/></Button>:<><Button variant="outline" onClick={()=>g.goChapter('arrange')}>继续调整</Button><Button disabled={!ready} onClick={saveImage}><Download size={16}/>保存作品图片</Button></>}
        </div>
      </section>
      <section className="scene-area" aria-label="三维插花桌面">
        <div className="canvas-host" data-testid="scene" data-ready={ready} data-scene={assets.sceneId} data-looking={g.looking}>
          <SceneBoundary><Suspense fallback={<div className="scene-loading-overlay">正在进入花席…</div>}><GameCanvas assets={assets} onReady={onReady} onCapture={onCapture}/></Suspense></SceneBoundary>
        </div>
        <div className="look-controls">
          {g.looking?<><Button variant="outline" aria-label="环视左转90度" onClick={()=>g.viewTo(g.view.yaw+90,g.view.pitch)}>←</Button><span>{Math.round(g.view.yaw)}°</span><Button variant="outline" aria-label="环视右转90度" onClick={()=>g.viewTo(g.view.yaw-90,g.view.pitch)}>→</Button><Button variant="outline" aria-label="抬头看" onClick={()=>g.viewTo(g.view.yaw,60)}>↑</Button><Button variant="outline" aria-label="低头看" onClick={()=>g.viewTo(g.view.yaw,-65)}>↓</Button></>:<Button variant="outline" onClick={g.look}><Compass size={16}/>看看四周</Button>}
          <Button variant="outline" onClick={g.returnToTable}>回到花席</Button>
        </div>
        <div className="scene-bottom"><span>{g.looking?'拖动画面环视 · 位置固定 · Esc 回到花席':g.tool==='scissors'?'点选叶片预览剪切，再确认':g.tool==='cup'?'先取花，再拖杯至瓶口或点花瓶注水':'点选花枝，拖向瓶口安放'}</span></div>
      </section>
      <ControlPanel hidden={panelCollapsed}/>
      <section className="chapter-panel" aria-label="五式流程">
        <nav aria-label="插花章节">{CHAPTERS.map(c=><button key={c.id} aria-current={g.session?.chapter===c.id?'step':undefined} onClick={()=>g.goChapter(c.id)} disabled={g.recoveryBlocked}><small>{c.number}</small>{c.name}</button>)}</nav>
        {(g.session?.chapter==='bless'||g.session?.chapter==='done')&&<div className="chapter-content"><div>
          {g.session?.chapter==='bless'&&<label className="wish-label">留一句祝愿，也可以只在心中默念<textarea aria-label="祝愿" placeholder="愿这一刻的安静，慢慢延续。" maxLength={200} value={g.session.wish} onChange={e=>g.setWish(e.target.value)}/></label>}
          {g.session?.chapter==='done'&&<p className="soft-copy">{g.session.wish||'愿这一席花，陪你留住片刻安静。'}</p>}
        </div>
        </div>}
      </section>
    </div>}
    <footer className="studio-footer"><span>以视觉感受舒服为宜，没有固化的标准。</span><span>一花一世界</span></footer>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="studio-dialog"><DialogHeader><DialogTitle>顺着花的方向，慢慢来</DialogTitle><DialogDescription>五式是引导，可以跳过讲解、返回修改；修剪不是必做题。</DialogDescription></DialogHeader>
      <ol className="help-list"><li><strong>备席</strong><span>取出杯中花草，拿起玻璃杯，向花瓶注水后放回。</span></li><li><strong>观察、修剪、安放</strong><span>点选花枝后可拿近、转动，或拖向瓶口。拿起花剪可选择叶、侧枝或保留长度，确认后剪下；插入后先取出才能剪。</span></li><li><strong>环视与回退</strong><span>放回手中物品后环视。Esc 取消临时操作。Ctrl / ⌘ + Z 撤销，加入 Shift 重做。刷新恢复同一场景、作品和记录。</span></li></ol>
      <p className="help-note">暂存于当前浏览器。需要长期保留时可在完成后下载作品图片。换景需开启新一席。</p><DialogFooter><Button onClick={()=>setHelp(false)}>明白了</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={restart} onOpenChange={setRestart}><DialogContent className="studio-dialog"><DialogHeader><DialogTitle>开启新的一席？</DialogTitle><DialogDescription>选择场景并成功入席后，会替换当前作品、祝愿和操作记录。可以先下载原进度或保存作品图片。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setRestart(false)}>保留当前作品</Button><Button onClick={()=>{setRestart(false);setChoosing(true);if(g.recoveryBlocked){useGameStore.setState({recoveryBlocked:false})}}}>前往选择场景</Button></DialogFooter></DialogContent></Dialog>
  </main>
}
function safelyDry(ml:number){return ml===0}

