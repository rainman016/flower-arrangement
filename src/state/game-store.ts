import { create } from 'zustand'
import { commit, initialHistory, redo, undo } from '../game/history'
import type { Arrangement, Chapter, Command, CutPreview, History, SceneId, Session, Tool } from '../game/types'
import { browserStorage, loadProgress, saveProgress } from '../services/progress-storage'
import { TABLE_VIEW } from '../content/scene-view'

const storage = browserStorage()
const loaded = loadProgress(storage)
export type VisualAction = {serial:number;command:Command;before:Arrangement;after:Arrangement;heldId:string|null}
type GameStore = {
  visualAction:VisualAction|null; motionEpoch:number; settleMotion:()=>void
  history: History; session?: Session; selectedId: string | null; held: boolean; tool: Tool
  cutPreview: CutPreview | null; dragging: boolean; looking: boolean; view: {yaw:number; pitch:number}
  restored: boolean; message: string; storageProblem?: string; originalRaw?: string; recoveryBlocked: boolean
  start: (scene:SceneId)=>void; select:(id:string|null)=>void; observe:()=>void; setTool:(tool:Tool)=>void
  previewCut:(preview:CutPreview|null)=>void; confirmCut:()=>void; putDown:()=>void
  setDragging:(value:boolean)=>void; look:()=>void; viewTo:(yaw:number,pitch:number)=>void; returnToTable:()=>void
  dispatch:(command:Command)=>void; undo:()=>void; redo:()=>void
  goChapter:(chapter:Chapter)=>void; setWish:(wish:string)=>void; retrySave:()=>void; tell:(message:string)=>void
}
const neutral = {held:false,tool:null,cutPreview:null,dragging:false} as const
const forward = {yaw:TABLE_VIEW.yaw,pitch:TABLE_VIEW.pitch}
export const useGameStore = create<GameStore>((set,get)=>{
  const persist=(history:History,session:Session,message:string)=>{
    set({history,session,message,restored:false,storageProblem:saveProgress(storage,history,session)})
  }
  const travel=(direction:'undo'|'redo')=>{
    const s=get();if(s.recoveryBlocked||!s.session||s.looking)return
    const next=direction==='undo'?undo(s.history):redo(s.history)
    if(next===s.history)return
    set({...neutral,visualAction:null,motionEpoch:s.motionEpoch+1,selectedId:next.present.flowers.some(f=>f.id===s.selectedId)?s.selectedId:null})
    persist(next,{...s.session,chapter:s.session.chapter==='done'?'arrange':s.session.chapter},direction==='undo'?'已撤销上一步':'已重做上一步')
  }
  return {
    visualAction:null,motionEpoch:0,
    settleMotion:()=>set({visualAction:null,motionEpoch:get().motionEpoch+1}),
    history:loaded.history||initialHistory(),session:loaded.session,selectedId:null,...neutral,looking:false,view:forward,
    restored:Boolean(loaded.history),message:loaded.history?'已恢复上次的花席与操作记录':'挑选一个地方，坐下来。',
    storageProblem:loaded.problem,originalRaw:loaded.raw,recoveryBlocked:Boolean(loaded.raw),
    start:(sceneId)=>{
      set({...neutral,visualAction:null,motionEpoch:get().motionEpoch+1,selectedId:null,looking:false,view:forward,originalRaw:undefined,recoveryBlocked:false})
      persist(initialHistory(),{sceneId,chapter:'opening',wish:''},'花席已备好，慢慢开始。')
    },
    tell:(message)=>set({message}),
    select:(selectedId)=>{if(get().looking||get().recoveryBlocked)return;const s=get(),f=s.history.present.flowers.find(f=>f.id===selectedId);set({visualAction:null,selectedId,cutPreview:null,held:Boolean(f&&f.location!=='vase'&&(s.tool==='scissors'||selectedId===s.selectedId&&s.held))})},
    observe:()=>{const f=get().history.present.flowers.find(f=>f.id===get().selectedId);if(!f)return
      if(f.location==='vase'){set({message:'可以转动花枝；想拿近观察，请先取出。'});return}
      set({visualAction:null,held:true,tool:null,cutPreview:null,message:'拿近看一看，转动花枝观察。'})},
    setTool:(tool)=>{if(get().looking||get().recoveryBlocked)return;const f=get().history.present.flowers.find(f=>f.id===get().selectedId);set({visualAction:null,tool,held:Boolean(tool==='scissors'&&f&&f.location!=='vase'),cutPreview:null,message:tool==='cup'?'杯中花草取出后，即可向花瓶注水。':tool==='scissors'?'选择一枝花，再点选可剪的叶或侧枝。':'工具已放回'})},
    previewCut:(cutPreview)=>{
      if(get().tool!=='scissors'){set({message:'先拿起花剪'});return}
      set({visualAction:null,cutPreview,message:cutPreview?'已标出待剪部位，确认后才会剪下。':'已取消剪切预览'})
    },
    confirmCut:()=>{const p=get().cutPreview;if(!p)return
      get().dispatch(p.kind==='part'?{type:'cut-part',id:p.id,part:p.part}:{type:'cut-length',id:p.id,length:p.length})
      set({cutPreview:null})
    },
    putDown:()=>set({...neutral,visualAction:null,message:'手中物品已放回'}),
    setDragging:(dragging)=>set({dragging}),
    look:()=>{
      if(get().held||get().tool||get().dragging){set({message:'先放回手中物品，再看看四周。'});return}
      set({looking:true,visualAction:null,motionEpoch:get().motionEpoch+1,cutPreview:null,message:'拖动画面环视，或使用左右转向按钮。'})
    },
    viewTo:(yaw,pitch)=>set({view:{yaw:((yaw%360)+360)%360,pitch:Math.max(-65,Math.min(60,pitch))}}),
    returnToTable:()=>set({looking:false,view:forward,message:'回到花席，作品还在原处。'}),
    dispatch:(command)=>{
      const s=get();if(s.recoveryBlocked||!s.session||s.looking)return
      const result=commit(s.history,command,{tool:s.tool})
      if(!result.changed){set({message:result.label});return}
      const selectedId=command.type==='add'?result.history.present.flowers.at(-1)!.id:result.history.present.flowers.some(f=>f.id===s.selectedId)?s.selectedId:null
      set({visualAction:{serial:(s.visualAction?.serial||0)+1,command,before:s.history.present,after:result.history.present,heldId:s.held?s.selectedId:null},selectedId,cutPreview:null,...(['insert','to-table','empty-cup','remove','tidy'].includes(command.type)?{held:false}:{}),...(command.type==='tidy'?{tool:null}:{})})
      persist(result.history,{...s.session,chapter:s.session.chapter==='done'?'arrange':s.session.chapter},result.label)
    },
    undo:()=>travel('undo'),redo:()=>travel('redo'),
    goChapter:(chapter)=>{
      const s=get();if(s.recoveryBlocked||!s.session)return
      if(chapter==='done'&&!s.history.present.flowers.some(f=>f.location==='vase')){set({message:'先在花瓶中安放至少一枝花，再完成作品。'});return}
      set({...neutral,visualAction:null,motionEpoch:s.motionEpoch+1,looking:false,view:forward})
      persist(s.history,{...s.session,chapter},chapter==='done'?'这一席花，已完成。':'按自己的节奏继续。')
    },
    setWish:(wish)=>{const s=get();if(s.session&&!s.recoveryBlocked)persist(s.history,{...s.session,wish:wish.slice(0,200)},s.message)},
    retrySave:()=>{const s=get();if(s.session&&!s.recoveryBlocked)set({storageProblem:saveProgress(storage,s.history,s.session)})},
  }
})

