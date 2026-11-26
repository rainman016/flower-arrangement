import { useGameStore } from '../../state/game-store'
import { Button } from '../ui/button'

/** Compact actions for the currently selected object when the full panel is closed. */
export default function TableActions() {
  const game = useGameStore()
  const work = game.history.present
  const flower = work.flowers.find(stem => stem.id === game.selectedId)
  const inCup = work.flowers.some(stem => stem.location === 'cup')
  const canObserve = flower && flower.location !== 'vase' && !game.tool
  return <div className="table-actions" aria-label="桌面快捷操作">
    <div className="button-row">
      {game.tool === 'cup' && inCup &&
        <Button variant="outline" onClick={() => game.dispatch({type:'empty-cup'})}>取出杯中花草</Button>}
      {game.tool === 'cup' && !inCup &&
        <Button variant="outline" onClick={() => game.dispatch({type:'pour', ml:130})}>向花瓶注水</Button>}
      {game.cutPreview && <>
        <Button onClick={game.confirmCut}>确认剪切</Button>
        <Button variant="outline" onClick={() => game.previewCut(null)}>取消剪切</Button>
      </>}
      {canObserve && !game.held && <Button variant="outline" onClick={game.observe}>拿近观察</Button>}
      {flower && !game.tool &&
        <Button variant="outline" onClick={() => game.dispatch({type:'rotate',id:flower.id,degrees:15})}>花枝右转</Button>}
      {canObserve && <Button variant="outline" onClick={() => game.dispatch({type:'insert',id:flower.id})}>放入花瓶</Button>}
      {(game.tool || game.held) && <Button variant="outline" onClick={game.putDown}>放回</Button>}
      {game.session?.chapter === 'tidy' &&
        <Button variant="outline" onClick={() => game.dispatch({type:'tidy'})}>收好花席</Button>}
      {game.history.past.length > 0 && <Button variant="ghost" onClick={game.undo}>撤销</Button>}
    </div>
    <small role="status" aria-live="polite">{game.message}</small>
  </div>
}
