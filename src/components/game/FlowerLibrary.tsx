import pictures from '../../content/flower-thumbnails.json'
import { specimen } from '../../content/specimens'
import {useEffect,useRef,useState} from 'react'
import {Flower2,Plus,X} from 'lucide-react'
import {Button} from '../ui/button'
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '../ui/dialog'
import {CUP_FLOWERS,MATERIAL_LIMITS,MAX_FLOWERS} from '../../content/catalog'
import type {FlowerKind,MaterialChoice} from '../../game/types'
import {useCoreStore} from '../../state/core-store'

type Stem=MaterialChoice&{key:string}
type Props={
  destination:'cup'|'table'
  disabled:boolean
  onOpen:()=>void
  preview:(choice:MaterialChoice)=>string|undefined
}
const kinds=Object.keys(CUP_FLOWERS) as FlowerKind[]
type MeasureProps={label:string;unit:string;value:number;min:number;max:number;step:number;onChange:(n:number)=>void}
function Measure({label,unit,value,min,max,step,onChange}:MeasureProps){
  const [draft,setDraft]=useState<string|null>(null)
  function commit(){
    if(draft!==null&&draft.trim()&&Number.isFinite(Number(draft))){
      const n=Math.min(max,Math.max(min,Number(draft)))
      onChange(Number((Math.round(n/step)*step).toFixed(1)))
    }
    setDraft(null)
  }
  return <div className="stem-measure"><div><span>{label}</span><label>
    <input type="number" aria-label={label+'数值'} min={min} max={max} step={step} value={draft??value}
      onFocus={()=>setDraft(String(value))} onChange={e=>setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}/>{unit}
  </label></div><input aria-label={unit==='厘米'?'茎长（厘米）':'花序大小（百分比）'} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></div>
}
export default function FlowerLibrary({destination,disabled,onOpen,preview}:Props){
  const [open,setOpen]=useState(false),[picked,setPicked]=useState<Stem[]>([])
  const [selected,setSelected]=useState(''),[picture,setPicture]=useState<string>()
  const [category,setCategory]=useState('常用花材')
  const serial=useRef(0),renderer=useRef(preview)
  renderer.current=preview
  const work=useCoreStore(s=>s.history.present)
  const outside=destination==='cup'?work.flowers.filter(f=>f.location!=='cup').length:work.flowers.length
  const total=picked.length+outside,active=picked.find(f=>f.key===selected)??picked[0]
  useEffect(()=>{
    if(!open||!active){setPicture(undefined);return}
    const timer=window.setTimeout(()=>setPicture(renderer.current(active)),65)
    return ()=>clearTimeout(timer)
  },[active,open])
  function change(next:boolean){
    if(next){
      onOpen();setCategory('常用花材')
      const stems=destination==='cup'?work.flowers.filter(f=>f.location==='cup').map(f=>({key:f.id,id:f.id,kind:f.kind,length:f.length,headScale:f.headScale??1})):[]
      setPicked(stems);setSelected(stems[0]?.key??'')
    }
    setOpen(next)
  }
  function add(kind:FlowerKind){
    const key='draft-'+ ++serial.current
    setPicked([...picked,{key,kind,length:CUP_FLOWERS[kind].length,headScale:1}]);setSelected(key)
  }
  function resize(patch:Partial<Pick<Stem,'length'|'headScale'>>){
    setPicked(picked.map(f=>f.key===active.key?{...f,...patch}:f))
  }
  return <Dialog open={open} onOpenChange={change}>
    <DialogTrigger asChild><Button disabled={disabled} className="material-library-trigger" size="sm"><Flower2 aria-hidden="true"/>花材库</Button></DialogTrigger>
    <DialogContent className="core-dialog flower-sheet"><DialogTitle>花材库</DialogTitle>
      <DialogDescription>{destination==='cup'?'可搭配 3–6 种花、叶或草。选好的枝条放入杯中。':'新选的花枝会放在桌上，可以拿起插入花器。'}</DialogDescription>
      <div className="specimen-groups" role="group" aria-label="花材分类">{['常用花材','花材','线条花材','叶材','山野花材'].map(group=><button type="button" key={group} aria-pressed={group===category} onClick={()=>setCategory(group)}>{group}</button>)}</div>
      <div className="flower-choices">{kinds.filter(kind=>(specimen(kind)?.category??'常用花材')===category).map(kind=><button key={kind} type="button" className="material-card" aria-label={'添加'+CUP_FLOWERS[kind].label} disabled={total>=MAX_FLOWERS} onClick={()=>add(kind)}>
        <img src={pictures[kind]} alt=""/><span>{CUP_FLOWERS[kind].label}<Plus size={14} aria-hidden="true"/></span></button>)}</div>
      {picked.length>0&&<><div className="stem-list" aria-label="已选花枝">{picked.map((f,i)=><button key={f.key} aria-pressed={f===active} onClick={()=>setSelected(f.key)}>
        {i+1} · {CUP_FLOWERS[f.kind].label}</button>)}</div>
      <div className="stem-editor">
        <div className="stem-preview">{picture&&<img src={picture} alt={'整枝预览：'+CUP_FLOWERS[active.kind].label}/>}</div>
        <div className="stem-settings"><div><strong>{CUP_FLOWERS[active.kind].label}</strong><button aria-label={'移除当前这枝'+CUP_FLOWERS[active.kind].label} onClick={()=>setPicked(picked.filter(f=>f!==active))}><X size={16}/>移除</button></div>
          <Measure key={active.key+'-length'} label="茎长" unit="厘米" min={Math.round(MATERIAL_LIMITS.minLength*100)} max={Math.round(MATERIAL_LIMITS.maxLength*100)} step={.1}
            value={Number((active.length*100).toFixed(1))} onChange={cm=>resize({length:cm/100})}/>
          <Measure key={active.key+'-head'} label={active.kind==='grass'?'草穗大小':'花头大小'} unit="%" min={70} max={140} step={5}
            value={Math.round(active.headScale*100)} onChange={percent=>resize({headScale:percent/100})}/>
        </div>
      </div></>}
      <div className="flower-sheet-actions"><small>{total>=MAX_FLOWERS?'本席已满 12 枝':picked.length?'已选 '+picked.length+' 枝':'点一种花材添一枝'}{outside>0?' · 已在席上 '+outside+' 枝':''}</small>
      <Button disabled={total<1||total>MAX_FLOWERS||(destination==='table'&&!picked.length)} onClick={()=>{
        useCoreStore.getState().dispatch({type:'set-materials',destination,choices:picked.map(({id,kind,length,headScale})=>({id,kind,length,headScale}))})
        setOpen(false)
      }}>选好了</Button></div>
    </DialogContent>
  </Dialog>
}
