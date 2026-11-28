import { useRef, useState } from 'react'
import { assetUrl, SCENES } from '../content/catalog'
import type { SceneId } from '../game/types'
import type { SceneAssets } from '../services/scene-assets'
import { useCoreStore } from '../state/core-store'
import '../styles/scene-entry.css'

type Session = { Game: typeof import('./CorePrototype').default; assets: SceneAssets }

export default function SceneEntry({ hasSave }: { hasSave: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState<SceneId | null>(null)
  const [confirm, setConfirm] = useState<SceneId | null>(null)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const { ritual, blocked } = useCoreStore.getState()
  const sceneName = (id: SceneId) => SCENES.find(scene => scene.id === id)?.name

  async function enter(id: SceneId, resume: boolean) {
    if (busy.current) return
    busy.current = true
    setLoading(id)
    setConfirm(null)
    setError('')
    try {
      const [game, assets] = await Promise.all([
        import('./CorePrototype'),
        import('../services/scene-assets').then(module => module.loadSceneAssets(id,true)),
        import('../scene/core/CoreCanvas'),
      ])
      if (!resume) useCoreStore.getState().newJourney(id)
      if(assets.prepared){
        // Compile while image requests are in flight. If one fails, swap to the
        // source loader before the loading screen is dismissed.
        const recovered=assets.prepared.ready.catch(async()=>{
          try{
            const fallback=await import('../services/scene-assets').then(module=>module.loadSceneAssets(id))
            setSession({Game:game.default,assets:fallback})
          }catch{
            setSession(null);busy.current=false;setLoading(null)
            setError('花席未能载入。请检查网络，再点一次场景重试。')
          }
          // This failed generation must never resume uploading/drawing. Its
          // replacement owns a fresh readiness promise; unmount releases this one.
          return new Promise<void>(()=>{})
        })
        assets.prepared.ready=recovered
        // Per-texture upload jobs must wait for the same fallback. Otherwise a
        // missing optional image throws into Canvas before its replacement mounts.
        assets.prepared.uploads=new Map([...assets.prepared.uploads].map(([texture,ready])=>[texture,ready.catch(()=>recovered)]))
      }
      setSession({ Game: game.default, assets })
    } catch {
      busy.current = false
      setLoading(null)
      setError('花席未能载入。请检查网络，再点一次场景重试。')
    }
  }

  if (session) return <session.Game key={session.assets.environment.scene.uuid} initialAssets={session.assets} />

  return <main className="scene-entry" aria-labelledby="scene-entry-title">
    <div className="scene-entry-inner">
      <header><h1 id="scene-entry-title">一席花</h1><p>选择一处花席</p></header>
      <div className="scene-entry-grid" role="group" aria-label="选择场景">
        {SCENES.map(scene => <button key={scene.id} type="button" className="scene-entry-card"
          aria-label={scene.name} disabled={!!loading} data-loading={loading === scene.id}
          onClick={() => hasSave ? setConfirm(scene.id) : void enter(scene.id, false)}>
          <img src={assetUrl(scene.preview)} alt="" width="640" height="426" />
          <span>{scene.name}</span><i aria-hidden="true">→</i>
        </button>)}
      </div>
      <div className="scene-entry-actions">
        {loading ? <p role="status">正在载入{sceneName(loading)}…</p> : confirm ? <>
          <p role="status">{blocked ? '原进度无法读取，可先返回并下载备份。' : '开启新的一席会替换已保存的花席。'}</p>
          <button className="scene-entry-primary" onClick={() => void enter(confirm, false)}>开启新花席</button>
          <button onClick={() => setConfirm(null)}>返回</button>
        </> : hasSave && ritual ? <button aria-label={blocked ? '查看原进度' : '继续上次花席'}
          onClick={() => void enter(ritual.sceneId, true)}>{blocked ? '查看原进度' : '继续上次花席'} · {sceneName(ritual.sceneId)}</button> : null}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </main>
}
