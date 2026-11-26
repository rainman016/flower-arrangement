import {insertionDepth} from '../../game/rules'
import { ArrowDownToLine, RotateCcw, RotateCw, Scissors, Undo2, Redo2, GlassWater, Hand } from 'lucide-react'
import { Button } from '../ui/button'
import { PoseControl } from './PoseControl'
import { FLOWERS, MAX_FLOWERS } from '../../content/catalog'
import { visibleParts } from '../../game/rules'
import type { FlowerKind } from '../../game/types'
import { useGameStore } from '../../state/game-store'

export default function ControlPanel({hidden=false}:{hidden?:boolean}){
  const g=useGameStore(),s=g.history.present,f=s.flowers.find(f=>f.id===g.selectedId),inserted=f?.location==='vase'
  const labels={cup:'杯中',table:'手边',vase:'瓶中'}
  const disabled=g.looking||g.recoveryBlocked
  return <aside id="flower-controls" className="control-panel" aria-label="花席操作" hidden={hidden}>
    <div className="panel-title"><span>手边的一席</span><span className="material-count">{s.flowers.filter(f=>f.location==='vase').length} 枝已安放</span></div>
    <fieldset disabled={disabled} className="action-fieldset">
      <section className="tool-section">
        <div className="section-label">备席与工具</div>
        <div className="button-row">
          <Button variant={g.tool==='cup'?'default':'outline'} aria-pressed={g.tool==='cup'} onClick={()=>g.setTool(g.tool==='cup'?null:'cup')}><GlassWater size={16}/>玻璃杯</Button>
          <Button variant={g.tool==='scissors'?'default':'outline'} aria-pressed={g.tool==='scissors'} onClick={()=>g.setTool(g.tool==='scissors'?null:'scissors')}><Scissors size={16}/>花剪</Button>
          <Button variant="ghost" onClick={g.putDown} disabled={!g.tool&&!g.held}>放回</Button>
        </div>
        <p className="water-status" data-testid="water">杯中 {s.cupMl} ml · 瓶中 {s.vaseMl} ml</p>
        <div className="button-row">
          <Button variant="secondary" onClick={()=>g.dispatch({type:'empty-cup'})} disabled={!s.flowers.some(f=>f.location==='cup')}>取出杯中花草</Button>
          <Button variant="outline" onClick={()=>g.dispatch({type:'pour',ml:130})}>向花瓶注水</Button>
        </div>
      </section>
      <section className="flower-section">
        <div className="section-label">花材 <span>{s.flowers.length} / {MAX_FLOWERS}</span></div>
        <div className="flower-library">{(Object.keys(FLOWERS) as FlowerKind[]).map(kind=><Button key={kind} variant="ghost" onClick={()=>g.dispatch({type:'add',kind})} disabled={s.flowers.length>=MAX_FLOWERS} aria-label={'添加'+FLOWERS[kind].name}><span className={'flower-swatch '+kind}/>＋{FLOWERS[kind].name}</Button>)}</div>
        <div className="flower-list">{s.flowers.map(flower=><button key={flower.id} className="flower-item" aria-label={FLOWERS[flower.kind].name+' '+flower.id} aria-pressed={g.selectedId===flower.id} onClick={()=>g.select(flower.id)}>
          <span className={'flower-swatch '+flower.kind}/><span>{FLOWERS[flower.kind].name}<small>第 {flower.id.slice(2)} 枝</small></span><span className="location-tag">{labels[flower.location]}</span>
        </button>)}</div>
        {!s.flowers.length&&<p className="soft-copy">从花材库补充一枝，随时重新开始。</p>}
      </section>
      {f&&<section className="selected-controls" aria-label="选中花枝">
        <div className="section-label">{FLOWERS[f.kind].name}<span data-testid="flower-status">{labels[f.location]} · {Math.round(f.length*100)} cm · {Math.round(f.pose.yaw)}°</span></div>
        <div className="button-row">
          <Button variant="outline" aria-label="花枝左转" onClick={()=>g.dispatch({type:'rotate',id:f.id,degrees:-15})}><RotateCcw size={16}/></Button>
          <Button variant="outline" aria-label="花枝右转" onClick={()=>g.dispatch({type:'rotate',id:f.id,degrees:15})}><RotateCw size={16}/></Button>
          <Button variant="outline" onClick={g.observe} disabled={inserted}><Hand size={15}/>拿近观察</Button>
        </div>
        <div className="button-row">
          <Button onClick={()=>g.dispatch({type:'insert',id:f.id})} disabled={inserted}><ArrowDownToLine size={16}/>放入花瓶</Button>
          <Button variant="outline" onClick={()=>g.dispatch({type:'to-table',id:f.id})}>{inserted?'取出花枝':'放到左侧'}</Button>
          <Button variant="ghost" onClick={()=>g.dispatch({type:'remove',id:f.id})}>移出</Button>
        </div>
        {inserted&&<div className="pose-stack">
          <PoseControl label="花枝倾斜" value={f.pose.tilt} min={0} max={12} step={1} unit="°" disabled={disabled} onCommit={tilt=>g.dispatch({type:'adjust',id:f.id,pose:{tilt}})}/>
          <PoseControl label="插入深度" value={Math.round(f.pose.depth*1000)/10} min={insertionDepth(f.length).min*100} max={insertionDepth(f.length).max*100} step={.5} unit="cm" disabled={disabled} onCommit={n=>g.dispatch({type:'adjust',id:f.id,pose:{depth:n/100}})}/>
          <div className="button-row insert-point"><span>插点</span><Button variant="outline" aria-label="插点向左" onClick={()=>g.dispatch({type:'adjust',id:f.id,pose:{x:f.pose.x-.002}})}>←</Button><Button variant="outline" aria-label="插点向右" onClick={()=>g.dispatch({type:'adjust',id:f.id,pose:{x:f.pose.x+.002}})}>→</Button><Button variant="outline" aria-label="插点向里" onClick={()=>g.dispatch({type:'adjust',id:f.id,pose:{z:f.pose.z-.002}})}>↑</Button><Button variant="outline" aria-label="插点向外" onClick={()=>g.dispatch({type:'adjust',id:f.id,pose:{z:f.pose.z+.002}})}>↓</Button></div>
        </div>}
        {g.tool==='scissors'&&<div className="trim-controls">
          {inserted?<p className="soft-copy">先取出花枝，再进行修剪。</p>:<>
            <p className="soft-copy">修剪可跳过。点选叶片或下方部位，确认后剪下。</p>
            <div className="button-row">{visibleParts(f).map(p=><Button key={p.id} variant="outline" onClick={()=>g.previewCut({kind:'part',id:f.id,part:p.id})}>{p.name}</Button>)}</div>
            <PoseControl label="保留长度" value={g.cutPreview?.kind==='length'&&g.cutPreview.id===f.id?Math.round(g.cutPreview.length*100):Math.round(f.length*100)} min={.1} max={Math.round(f.length*1000)/10} step={1} unit="cm" disabled={disabled} onCommit={length=>g.previewCut({kind:'length',id:f.id,length:length/100})}/>
          </>}
          {g.cutPreview&&<div className="cut-confirm"><span>待剪预览</span><Button onClick={g.confirmCut}>确认剪切</Button><Button variant="ghost" onClick={()=>g.previewCut(null)}>取消剪切</Button></div>}
        </div>}
      </section>}
      <details className="whole-work"><summary>调整整件作品</summary><div className="button-row">
        <Button variant="outline" onClick={()=>g.dispatch({type:'move-vase',pose:{yaw:s.vase.yaw-15}})}>整瓶左转</Button>
        <Button variant="outline" onClick={()=>g.dispatch({type:'move-vase',pose:{yaw:s.vase.yaw+15}})}>整瓶右转</Button>
        <Button variant="outline" onClick={()=>g.dispatch({type:'move-vase',pose:{x:Math.max(-.04,s.vase.x-.01)}})}>向左挪</Button>
        <Button variant="outline" onClick={()=>g.dispatch({type:'move-vase',pose:{x:Math.min(.04,s.vase.x+.01)}})}>向右挪</Button>
      </div></details>
      <div className="tidy-row"><span data-testid="debris">碎屑 {s.debris.length} 处</span><Button variant="outline" onClick={()=>g.dispatch({type:'tidy'})}>整理桌面</Button></div>
    </fieldset>
    <div className="history-row"><Button variant="outline" disabled={!g.history.past.length||disabled} onClick={g.undo}><Undo2 size={16}/>撤销</Button><Button variant="ghost" disabled={!g.history.future.length||disabled} onClick={g.redo}><Redo2 size={16}/>重做</Button></div>
    <p className="operation-message" role="status" aria-live="polite">{g.message}</p>
  </aside>
}

