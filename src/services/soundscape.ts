import { assetUrl } from '../content/catalog'
import type { SceneId } from '../game/types'

export type AudioChannel='nature'|'music'
type Preferences={enabled:boolean;nature:number;music:number;natureOn:boolean;musicOn:boolean}
type Snapshot=Preferences&{status:'ready'|'loading'|'playing'|'paused'|'off'|'error';scene?:SceneId;message:string}
const KEY='yixihua:audio:v1'
const defaults:Preferences={enabled:true,nature:.6,music:.2,natureOn:true,musicOn:true}
function preferences():Preferences{
  try{
    const p=JSON.parse(localStorage.getItem(KEY)||'null')
    if(p?.version!==1)return defaults
    return {enabled:typeof p.enabled==='boolean'?p.enabled:true,nature:volume(p.nature,.6),music:volume(p.music,.2),natureOn:typeof p.natureOn==='boolean'?p.natureOn:true,musicOn:typeof p.musicOn==='boolean'?p.musicOn:true}
  }catch{return defaults}
}
const volume=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(1,Math.max(0,value)):fallback

/** Audio owns playback/preferences only. It never reads or writes arrangement history. */
export class Soundscape {
  private state:Snapshot={...preferences(),status:'ready',message:''}
  private listeners=new Set<()=>void>()
  private context?:AudioContext
  private channels:{source:AudioBufferSourceNode;gain:GainNode;channel:AudioChannel}[]=[]
  private controller?:AbortController
  private generation=0
  private granted=false
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  private update(patch:Partial<Snapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn())}
  private save(){try{const {enabled,nature,music,natureOn,musicOn}=this.state;localStorage.setItem(KEY,JSON.stringify({version:1,enabled,nature,music,natureOn,musicOn}))}catch{/* Sound remains usable when preference storage is unavailable. */}}
  private mix={music:1,nature:1}
  setMix(music:number,nature:number){
    this.mix={music,nature}
    if(this.context)for(const t of this.channels){
      const param=t.gain.gain,now=this.context.currentTime
      if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now)
      else{const current=param.value;param.cancelScheduledValues(now);param.setValueAtTime(current,now)}
      param.setTargetAtTime(this.level(t.channel),now,.8)
    }
  }
  private level(channel:AudioChannel){return this.state[channel+'On' as 'natureOn'|'musicOn']?Math.min(1,this.state[channel]*this.mix[channel]):0}
  setVolume(channel:AudioChannel,value:number){this.update({[channel]:volume(value,this.state[channel])});this.applyLevels();this.save()}
  toggleChannel(channel:AudioChannel){const key=channel+'On' as 'natureOn'|'musicOn';this.update({[key]:!this.state[key]});this.applyLevels();this.save()}
  private applyLevels(){if(this.context)for(const track of this.channels)track.gain.gain.setTargetAtTime(this.level(track.channel),this.context.currentTime,.08)}
  private stopTracks(){
    this.generation++;this.controller?.abort();this.controller=undefined
    const now=this.context?.currentTime||0
    for(const {source,gain} of this.channels){gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,.035);source.onended=()=>{source.disconnect();gain.disconnect()};try{source.stop(now+.18)}catch{source.disconnect();gain.disconnect()}}
    this.channels=[]
  }
  setScene(scene:SceneId|undefined){
    if(this.state.scene===scene)return
    this.stopTracks();this.update({scene,status:this.state.enabled?'ready':'off',message:''})
    if(scene&&this.granted&&this.state.enabled&&document.visibilityState!=='hidden')void this.ensurePlaying()
  }
  /** Call synchronously from the entry gesture, before waiting for scene assets. */
  prime=()=>{
    if(!this.state.enabled||this.state.status==='playing'||this.state.status==='loading')return
    try{
      this.context??=new AudioContext();this.granted=true
      void this.context.resume().then(()=>{if(this.granted&&document.visibilityState!=='hidden')return this.ensurePlaying()}).catch(()=>{this.granted=false;this.update({status:'paused',message:'点击开启声音后继续，插花操作不受影响。'})})
    }catch{this.granted=false;this.update({status:'error',message:'当前浏览器暂时无法播放声音。'})}
  }
  play=()=>{this.update({enabled:true,message:''});this.save();this.prime()}
  pause=()=>{this.granted=false;this.stopTracks();this.update({enabled:false,status:'off',message:''});this.save()}
  pauseForBackground=()=>{this.granted=false;this.stopTracks();this.update({status:this.state.enabled?'paused':'off',message:this.state.enabled?'声音已暂停，返回后可继续播放。':''})}
  private async ensurePlaying(){
    const {scene,enabled,status}=this.state,context=this.context
    if(!scene||!enabled||!context||!this.granted||document.visibilityState==='hidden'||status==='loading'||status==='playing')return
    const generation=++this.generation,controller=new AbortController();this.controller=controller
    this.update({status:'loading',message:'正在准备声音…'})
    try{
      const buffers=await Promise.all((['nature','music'] as const).filter(channel=>__FLOWER_ASSETS__.assets.some(asset=>asset.id==='audio-'+channel+'-'+scene)).map(async channel=>{
        const response=await fetch(assetUrl('audio-'+channel+'-'+scene),{signal:controller.signal})
        if(!response.ok)throw Error('Audio unavailable')
        return {channel,buffer:await context.decodeAudioData(await response.arrayBuffer())}
      }))
      if(generation!==this.generation||!this.granted||document.hidden)return
      if(context.state!=='running'){this.update({status:'paused',message:'点击继续声音，浏览器会恢复播放。'});return}
      const start=context.currentTime+.2
      for(const {channel,buffer} of buffers){
        const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.loop=true
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(this.level(channel),start+1.2)
        source.connect(gain);gain.connect(context.destination);source.start(start);this.channels.push({source,gain,channel})
      }
      this.update({status:'playing',message:''})
    }catch{
      if(generation===this.generation&&!controller.signal.aborted){this.stopTracks();this.update({status:'error',message:'声音暂时未能载入，可以重试；作品已保留。'})}
    }
  }
  dispose=()=>{this.granted=false;this.stopTracks();void this.context?.close();this.context=undefined;this.update({scene:undefined,status:'ready',message:''})}
}
export const soundscape=new Soundscape()
