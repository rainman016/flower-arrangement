type Budget={width:number;height:number;deviceRatio:number;dpr:number;gpuMs:number;time:number}
const prefix='flower-render-budget-v1:'
/** A short-lived measurement, scoped to this tab, prepared scene and quality mode. */
export function readRenderBudget(key:string|undefined,width:number,height:number,deviceRatio:number,ceiling:number,now=Date.now()):Budget|undefined{
 if(!key)return
 try{
  const row=JSON.parse(sessionStorage.getItem(prefix+key)??'null') as Budget|null
  if(row&&row.width===width&&row.height===height&&row.deviceRatio===deviceRatio&&Number.isFinite(row.dpr)&&row.dpr>=.5&&row.dpr<=ceiling&&Number.isFinite(row.gpuMs)&&row.gpuMs>0&&Number.isFinite(row.time)&&now>=row.time&&now-row.time<300000)return row
 }catch{/* Storage can be disabled without affecting the game. */}
}
export function saveRenderBudget(key:string|undefined,row:Omit<Budget,'time'>,now=Date.now()){
 if(key)try{sessionStorage.setItem(prefix+key,JSON.stringify({...row,time:now}))}catch{/* Optional performance cache. */}
}
