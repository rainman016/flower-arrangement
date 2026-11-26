import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Soundscape } from '../../src/services/soundscape'

let memory:Map<string,string>,tracks:any[],engine:Soundscape
class FakeContext{
 currentTime=0;state='running';destination={}
 resume=vi.fn(async()=>{});close=vi.fn(async()=>{})
 decodeAudioData=vi.fn(async(bytes:ArrayBuffer)=>({tag:new TextDecoder().decode(bytes)}))
 createGain(){return {gain:{setValueAtTime:vi.fn(),setTargetAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn()},connect:vi.fn(),disconnect:vi.fn()}}
 createBufferSource(){const track={buffer:null,loop:false,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};tracks.push(track);return track}
}
const response=(url:string)=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode(url).buffer})
beforeEach(()=>{
 memory=new Map();tracks=[]
 vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v)})
 vi.stubGlobal('document',{visibilityState:'visible',hidden:false})
 vi.stubGlobal('AudioContext',FakeContext)
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>response(url)))
 engine=new Soundscape()
})
afterEach(()=>{engine.dispose();vi.unstubAllGlobals()})

describe('sound playback lifecycle remains independent of the arrangement',()=>{
 it('does not autoplay restored scenery, and bounds stored preferences',()=>{
  memory.set('yixihua:audio:v1',JSON.stringify({version:1,nature:99,music:-2,enabled:false}))
  engine=new Soundscape();engine.setScene('bamboo')
  expect(fetch).not.toHaveBeenCalled();expect(engine.getSnapshot()).toMatchObject({nature:1,music:0,enabled:false})
 })
 it('stops the previous nature loop when changing scenery and stores only audio preferences',async()=>{
  engine.setScene('bamboo');engine.play();await vi.waitFor(()=>expect(engine.getSnapshot().status).toBe('playing'))
  expect(tracks).toHaveLength(1)
  expect(tracks[0].buffer.tag).toContain('nature-bamboo.ogg')
  expect(fetch).toHaveBeenCalledTimes(1)
  engine.setScene('creek');await vi.waitFor(()=>expect(tracks).toHaveLength(2))
  expect(tracks.slice(0,1).every(t=>t.stop.mock.calls.length===1)).toBe(true)
  expect(tracks.slice(1).every(t=>t.buffer.tag.includes('creek'))).toBe(true)
  engine.setVolume('music',.35);engine.toggleChannel('nature')
  expect([...memory.keys()]).toEqual(['yixihua:audio:v1'])
 })
 it('ignores a late response from a scene that was left while loading',async()=>{
  const pending:{url:string;resolve:(r:any)=>void}[]=[]
  vi.stubGlobal('fetch',vi.fn((url:string)=>new Promise(resolve=>pending.push({url,resolve}))))
  engine.setScene('bamboo');engine.play();await vi.waitFor(()=>expect(pending).toHaveLength(1))
  engine.setScene('creek');await vi.waitFor(()=>expect(pending).toHaveLength(2))
  pending.forEach(p=>p.resolve(response(p.url)))
  await vi.waitFor(()=>expect(engine.getSnapshot().status).toBe('playing'))
  expect(tracks).toHaveLength(1);expect(tracks.every(t=>t.buffer.tag.includes('creek'))).toBe(true)
 })
 it('does not resume a pending load after the tab was hidden; a failure can be retried',async()=>{
  const pending:((r:any)=>void)[]=[]
  vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>pending.push(resolve))))
  engine.setScene('creek');engine.play();await vi.waitFor(()=>expect(pending).toHaveLength(1))
  engine.pauseForBackground();pending.forEach(resolve=>resolve(response('old')))
  await new Promise(resolve=>setTimeout(resolve,0))
  expect(tracks).toHaveLength(0);expect(engine.getSnapshot().status).toBe('paused')
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})))
  engine.play();await vi.waitFor(()=>expect(engine.getSnapshot().status).toBe('error'))
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>response(url)))
  engine.play();await vi.waitFor(()=>expect(engine.getSnapshot().status).toBe('playing'))
  expect(tracks).toHaveLength(1)
 })
})
