import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '../../src/state/game-store'

const game=()=>useGameStore.getState()
beforeEach(()=>game().start('creek'))
describe('animation cues follow committed actions without owning game outcomes',()=>{
 it('failed pouring produces no visual cue or history entry',()=>{
  game().setTool('cup');const history=game().history
  game().dispatch({type:'pour',ml:130})
  expect(game().history).toBe(history);expect(game().visualAction).toBeNull()
 })
 it('interruption finishes presentation without committing the same pour twice',()=>{
  game().dispatch({type:'empty-cup'});game().setTool('cup');game().dispatch({type:'pour',ml:130})
  const history=game().history,cue=game().visualAction!
  expect(cue.before.cupMl).toBe(180);expect(cue.after.cupMl).toBe(50)
  game().settleMotion();game().settleMotion()
  expect(game().history).toBe(history);expect(game().history.present.vaseMl).toBe(130);expect(game().visualAction).toBeNull()
 })
 it('undo and redo clear stale cut effects while restoring both leaf and debris',()=>{
  game().dispatch({type:'empty-cup'});game().select('f-1');game().setTool('scissors')
  game().previewCut({kind:'part',id:'f-1',part:'leaf-0'});game().confirmCut()
  expect(game().visualAction?.heldId).toBe('f-1');expect(game().history.present.debris).toHaveLength(1)
  const epoch=game().motionEpoch;game().undo()
  expect(game().motionEpoch).toBeGreaterThan(epoch);expect(game().visualAction).toBeNull();expect(game().history.present.debris).toHaveLength(0)
  expect(game().history.present.flowers[0].removed).toEqual([])
  game().redo();expect(game().visualAction).toBeNull();expect(game().history.present.debris).toHaveLength(1)
 })
 it('previewing the next part does not replay the previous committed cut',()=>{
  game().dispatch({type:'empty-cup'});game().select('f-1');game().setTool('scissors')
  game().previewCut({kind:'part',id:'f-1',part:'leaf-0'});game().confirmCut()
  const history=game().history
  game().previewCut({kind:'part',id:'f-1',part:'leaf-1'})
  expect(game().visualAction).toBeNull();expect(game().cutPreview).toEqual({kind:'part',id:'f-1',part:'leaf-1'})
  expect(game().history).toBe(history)
 })
})
