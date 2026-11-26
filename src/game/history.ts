import { initialArrangement } from './rules'
import { reduceCommand } from './reducer'
import type { Command, Context, History } from './types'
export const HISTORY_LIMIT=40
export const initialHistory=():History=>({present:initialArrangement(),past:[],future:[]})
export function commit(history:History,command:Command,context:Context={tool:null}){
  const result=reduceCommand(history.present,command,context)
  if(result.state===history.present)return {history,label:result.error||result.label,changed:false}
  return {history:{present:result.state,past:[...history.past,{state:history.present,label:result.label}].slice(-HISTORY_LIMIT),future:[]} as History,label:result.label,changed:true}
}
export function undo(history:History):History{
  const entry=history.past.at(-1);if(!entry)return history
  return {present:entry.state,past:history.past.slice(0,-1),future:[...history.future,{state:history.present,label:entry.label}].slice(-HISTORY_LIMIT)}
}
export function redo(history:History):History{
  const entry=history.future.at(-1);if(!entry)return history
  return {present:entry.state,future:history.future.slice(0,-1),past:[...history.past,{state:history.present,label:entry.label}].slice(-HISTORY_LIMIT)}
}
