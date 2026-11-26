import { useEffect, useState, useSyncExternalStore } from 'react'
import { AudioLines, Volume2, VolumeX } from 'lucide-react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { soundscape, type AudioChannel } from '../../services/soundscape'
import type { SceneId } from '../../game/types'

export default function SoundControls({scene}:{scene?:SceneId}){
  const s=useSyncExternalStore(soundscape.subscribe,soundscape.getSnapshot,soundscape.getSnapshot),[open,setOpen]=useState(false)
  useEffect(()=>soundscape.setScene(scene),[scene])
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')soundscape.pauseForBackground()}
    document.addEventListener('visibilitychange',hidden)
    return()=>{document.removeEventListener('visibilitychange',hidden);soundscape.dispose()}
  },[])
  const playing=s.status==='playing'||s.status==='loading'
  const label=playing?'暂停声音':s.status==='paused'?'继续声音':'开启声音'
  return <>
    <Button variant="ghost" size="icon" aria-label={label} disabled={!scene} onClick={playing?soundscape.pause:soundscape.play}>{playing?<Volume2 size={19}/>:<VolumeX size={19}/>}</Button>
    <Button variant="ghost" size="icon" aria-label="声音设置" onClick={()=>setOpen(true)}><AudioLines size={19}/></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="studio-dialog sound-dialog"><DialogHeader><DialogTitle>听见这一席</DialogTitle><DialogDescription>自然声随风景变化，可在这里调整音量。</DialogDescription></DialogHeader>
      <div className="sound-channels">{(['nature','music'] as AudioChannel[]).filter(channel=>__FLOWER_ASSETS__.assets.some(asset=>asset.id.startsWith('audio-'+channel+'-'))).map(channel=>{
        const on=s[channel+'On' as 'natureOn'|'musicOn'],name=channel==='nature'?'自然声':'轻音乐'
        return <div className="sound-channel" key={channel}><div><span>{name}</span><Button size="sm" variant={on?'outline':'ghost'} aria-label={name+'开关'} aria-pressed={on} onClick={()=>soundscape.toggleChannel(channel)}>{on?'已开启':'已关闭'}</Button></div>
          <label><span className="sr-only">{name}音量</span><input type="range" aria-label={name+'音量'} min="0" max="100" step="5" value={Math.round(s[channel]*100)} onChange={e=>soundscape.setVolume(channel,Number(e.target.value)/100)}/><output>{Math.round(s[channel]*100)}%</output></label>
        </div>
      })}</div>
      <p className="soft-copy" role="status" data-testid="audio-status" data-scene={s.scene||''} data-state={s.status}>{!scene?'入席后，声音会陪着风景慢慢展开。':s.message|| (playing?'正在播放当前场景的声音。':'声音已关闭，随时可以开启。')}</p>
      <Button disabled={!scene} onClick={playing?soundscape.pause:soundscape.play}>{s.status==='error'?'重试声音':label}</Button>
      <details className="audio-credits"><summary>声音来源</summary><p>风声：<a href="https://freesound.org/people/teadrinker/sounds/403051/" target="_blank" rel="noreferrer">teadrinker</a>（CC0）。溪流：<a href="https://freesound.org/people/InspectorJ/sounds/325324/" target="_blank" rel="noreferrer">“Stream, Water, A.wav” · InspectorJ</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>）。录音经截取、音量整理与循环处理。</p></details>
    </DialogContent></Dialog>
  </>
}
