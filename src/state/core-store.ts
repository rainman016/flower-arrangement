import { hasCuts } from '../content/catalog'
import { create } from 'zustand'
import { commit, redo, undo, HISTORY_LIMIT } from '../game/history'
import { CORE_KEY, coreInitial, decodeCore, encodeCore } from '../services/core-progress'
import type { Command, History, Pose, Quat } from '../game/types'
import { canArrange, decodeRitual, encodeRitual, freshRitual, RITUAL_KEY, ritualHistory, type Ritual } from '../services/ritual-progress'
import type { SceneId } from '../game/types'
type Mode='free'|'yaw'|'tilt'|'depth'|'point'
export type PourPhase='carry'|'ready'|'flow'|'paused'
type CoreStore={
  previousSeat:{history:History;ritual:Ritual}|null; returnToEmpty:()=>void; recoverSeat:()=>void
  carriedProp:'vase'|'scissors'|null; restartPreparation:()=>void
  vaseFocus:boolean; focusVase:(on:boolean)=>void
  saving:boolean; saveNotice:string
  insertPreview:Pose|null; previewInsert:(pose:Pose|null)=>void
  ritual:Ritual|null; cupHeld:boolean; pourPhase:PourPhase; offering:number
  openJourney:()=>boolean; newJourney:(scene:SceneId)=>void; updateRitual:(patch:Partial<Ritual>)=>void; holdCup:(value:boolean)=>void
  history:History; selectedId:string|null; heldId:string|null; scissors:boolean; turn:Quat; mode:Mode
  message:string; blocked:string|null; storageError:boolean; epoch:number; serial:number; lastCommand:Command|null
  select:(id:string)=>void; takeScissors:()=>void; parkScissors:()=>void; putDown:()=>void
  setTurn:(turn:Quat)=>void; setMode:(mode:Mode)=>void; tell:(text:string)=>void
  dispatch:(command:Command)=>boolean; undo:()=>void; redo:()=>void; restart:()=>void
}
let raw:string|null=null,loaded:History|undefined,storageError=false
try{raw=localStorage.getItem(CORE_KEY);if(raw)loaded=decodeCore(raw)}catch{storageError=true}
export const useCoreStore=create<CoreStore>((set,get)=>{
  const save=(history:History)=>{let failed=false;try{const ritual=get().ritual;localStorage.setItem(ritual?RITUAL_KEY:CORE_KEY,ritual?encodeRitual(history,ritual):encodeCore(history))}catch{failed=true}set({history,storageError:failed})}
  const travel=(direction:'undo'|'redo')=>{
    const s=get();if(s.blocked)return
    const h=direction==='undo'?undo(s.history):redo(s.history);if(h===s.history)return
    const selected=h.present.flowers.find(f=>f.id===s.selectedId)
    set({carriedProp:null,pourPhase:'carry',vaseFocus:s.vaseFocus&&h.present.flowers.some(f=>f.location==='vase'),insertPreview:null,cupHeld:false,epoch:s.epoch+1,lastCommand:null,heldId:selected&&selected.location!=='vase'&&s.heldId?selected.id:null,selectedId:selected?.id??null,message:direction==='undo'?'已撤销上一步。':'已重做这一步。'})
    save(h)
  }
  return {
    previousSeat:null,
    returnToEmpty:()=>{
      const s=get()
      if(!s.ritual||!['bless','done'].includes(s.ritual.stage)||s.saving||s.blocked)return
      const previousSeat={ritual:s.ritual,history:s.history}
      s.newJourney(s.ritual.sceneId)
      set({previousSeat})
    },
    recoverSeat:()=>{
      const s=get(),seat=s.previousSeat
      if(!seat||s.ritual?.stage!=='arrival'||s.ritual.sceneId!==seat.ritual.sceneId)return
      set({ritual:seat.ritual,previousSeat:null,epoch:s.epoch+1,message:''})
      save(seat.history)
    },
    carriedProp:null,restartPreparation:()=>{
      const s=get()
      if(s.ritual?.stage!=='prepare'||s.blocked)return
      save({present:ritualHistory().present,past:[...s.history.past,{state:s.history.present,label:'重新备席'}].slice(-HISTORY_LIMIT),future:[]})
      set({epoch:s.epoch+1,carriedProp:null,heldId:null,selectedId:null,cupHeld:false,pourPhase:'carry',scissors:false,lastCommand:null,message:'重新备席，可以重新摆放器物。'})
    },
    vaseFocus:false,focusVase:on=>{
      const s=get()
      if(on&&(s.heldId||s.cupHeld||s.insertPreview||!s.ritual||(!canArrange(s.ritual)&&s.ritual.stage!=='tidy')||!s.history.present.flowers.some(f=>f.location==='vase')))return
      // Editing a finished arrangement resumes the whole insertion flow. Focus
      // is only a camera state; losing it after extraction must not lock the stem.
      if(on&&s.ritual?.stage==='tidy')s.updateRitual({stage:'arrange',arranging:true,line:0})
      set({vaseFocus:on,selectedId:null,mode:'free',message:''})
    },
    saving:false,saveNotice:'',insertPreview:null,previewInsert:insertPreview=>set({insertPreview}),
    ritual:null,cupHeld:false,pourPhase:'carry',offering:0,
    openJourney:()=>{
      let original:string|null=null
      try{original=localStorage.getItem(RITUAL_KEY)}catch{/* in-memory play */}
      const saved=original?decodeRitual(original):undefined
      set({history:saved?.history??ritualHistory(),ritual:saved?.ritual??freshRitual(),blocked:original&&!saved?original:null,message:''})
      return original!==null
    },
    updateRitual:patch=>{
      const s=get();if(!s.ritual||s.blocked)return
      if(patch.stage&&['tidy','bless','return','done'].includes(patch.stage)&&!s.history.present.flowers.some(f=>f.location==='vase')){
        set({ritual:{...s.ritual,stage:'arrange',line:0},message:'先安放一枝花，再进入祝愿。',heldId:null,scissors:false,cupHeld:false,epoch:s.epoch+1})
        save(s.history);return
      }
      set({...(patch.stage||patch.sceneId?{previousSeat:null}:{}),ritual:{...s.ritual,...(patch.stage?{arranging:undefined}:{}),...patch},...(patch.stage?{carriedProp:null,pourPhase:'carry',vaseFocus:false,saveNotice:'',insertPreview:null,cupHeld:false,heldId:null,selectedId:null,scissors:false,epoch:s.epoch+1,message:''}:{})})
      save(s.history)
    },
    newJourney:scene=>{
      set({previousSeat:null,offering:0,saveNotice:'',turn:[0,0,0,1],mode:'yaw',carriedProp:null,pourPhase:'carry',vaseFocus:false,insertPreview:null,ritual:freshRitual(scene),blocked:null,selectedId:null,heldId:null,cupHeld:false,scissors:false,lastCommand:null,message:'',epoch:get().epoch+1})
      save(ritualHistory())
    },
    holdCup:cupHeld=>set({carriedProp:null,cupHeld,pourPhase:'carry',scissors:false,...(cupHeld?{heldId:null,selectedId:null}:{})}),
    history:loaded??coreInitial(),selectedId:null,heldId:null,scissors:false,turn:[0,0,0,1],mode:'yaw',
    message:loaded?'花席已恢复。点一枝花，拿近看看。':'点一枝花，拿近看看。',blocked:raw&&!loaded?raw:null,storageError,epoch:0,serial:0,lastCommand:null,
    select:id=>{
      const f=get().history.present.flowers.find(f=>f.id===id);if(!f||get().blocked)return
      const ritual=get().ritual
      if(!get().vaseFocus&&ritual&&['tidy','bless','return','done'].includes(ritual.stage))return
      if(f.location==='vase'&&!canArrange(ritual)){get().tell('这枝已插好。可在第四式点「插花」后取出。');return}
      if(ritual?.stage==='arrange'&&!canArrange(ritual)){get().tell('点「插花」，再选一枝花。');return}
      if(ritual?.stage==='observe'&&!ritual.observed)get().updateRitual({observed:true})
      set({vaseFocus:get().vaseFocus&&f.location==='vase',insertPreview:null,...(ritual&&f.location==='vase'&&get().selectedId!==id?{mode:'free' as const}:{}),selectedId:id,heldId:f.location==='vase'?null:id,turn:[0,0,0,1],message:get().ritual?.stage==='trim'&&f.location!=='vase'?(hasCuts(f)?'这枝已修剪。':'这枝保留原样。'):f.location==='vase'?'拖动调整；抓住茎部可取出重插。':get().ritual?.stage==='arrange'?(hasCuts(f)?'这枝已修剪。':'这枝保留原样。')+'拖到瓶口松手，或点花瓶预览。':'拖动花枝可转动。'})
    },
    takeScissors:()=>{
      const s=get(),trim=s.ritual?.stage==='trim'
      if(s.blocked||(s.ritual&&!trim))return
      if(trim&&!s.heldId){s.tell('先点一枝花，拿到中央。');return}
      set({scissors:true,message:trim?'点要剪的位置，拖动可转花。':'抓住剪刀，移到剪口预览，松开剪下。'})
    },
    parkScissors:()=>set({scissors:false}),
    putDown:()=>set({insertPreview:null,cupHeld:false,heldId:null,scissors:false,epoch:get().epoch+1,message:'已放回拿起前的位置。'}),
    setTurn:turn=>set({turn}),setMode:mode=>set({mode}),tell:message=>set({message}),
    dispatch:command=>{
      const s=get();if(s.blocked)return false
      if(s.ritual){
        if((command.type==='restore-water'||command.type==='pour')&&s.ritual.stage!=='prepare')return false
        if(['insert','adjust','to-table','rotate'].includes(command.type)&&!canArrange(s.ritual))return false
        if(command.type==='place-flower'&&!canArrange(s.ritual)&&s.history.present.flowers.some(f=>f.id===command.id&&f.location==='vase'))return false
        if(['free-cut','cut-part','cut-length'].includes(command.type)&&s.ritual.stage!=='trim')return false
      }
      const result=commit(s.history,command,{tool:s.cupHeld?'cup':s.scissors?'scissors':null})
      if(!result.changed){set({message:result.label});return false}
      set({vaseFocus:s.vaseFocus&&command.type!=='to-table'&&command.type!=='place-flower',insertPreview:null,lastCommand:command,serial:s.serial+1,message:result.label,
        ...(['insert','place-flower','to-table'].includes(command.type)?{heldId:null}:{}),
        ...(s.ritual&&command.type==='place-flower'?{selectedId:null}:{}),
        ...(command.type==='insert'?{selectedId:command.id,...(s.ritual?{mode:'free' as const}:{})}:{}),
        ...(command.type==='add'?{selectedId:result.history.present.flowers.at(-1)!.id}:{}),
      })
      save(result.history);return true
    },
    undo:()=>travel('undo'),redo:()=>travel('redo'),
    restart:()=>{if(get().ritual){get().newJourney(get().ritual!.sceneId);return}set({blocked:null,selectedId:null,heldId:null,scissors:false,epoch:get().epoch+1,lastCommand:null,message:'新的一席，慢慢开始。'});save(coreInitial())},
  }
})
