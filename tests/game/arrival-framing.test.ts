import {expect,it} from 'vitest'
import {PerspectiveCamera,Vector3} from 'three'
import {DESK} from '../../src/game/desk-layout'
import {deskView} from '../../src/scene/core/desk-space'
import {arrivalFraming} from '../../src/scene/arrival-framing'

it.each([[1440,900],[1000,590],[2560,1080],[390,844]])('keeps the tabletop in view while opening the skyline at %s×%s',(width,height)=>{
  const desk=deskView(width,height),opening=arrivalFraming(width,height,desk)
  const camera=new PerspectiveCamera(opening.fov,width/height,.015,60)
  expect(opening.pitch*180/Math.PI+opening.fov/2).toBeGreaterThan(14)
  for(const approach of [0,.5,1]){
    camera.position.copy(desk.eye);camera.position.z+=approach*.34;camera.position.y+=approach*.045
    camera.rotation.x=opening.pitch;camera.updateMatrixWorld()
    for(const x of [DESK.left,DESK.right])for(const z of [DESK.front,DESK.back]){
      const p=new Vector3(x,DESK.top,z).project(camera)
      expect(Math.abs(p.x)).toBeLessThan(.94)
      expect(Math.abs(p.y)).toBeLessThan(.91)
    }
  }
})
