import { AmbientLight, Box3, Color, DirectionalLight, Object3D, OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { CUP_FLOWERS, FLOWERS } from '../../content/catalog'
import { defaultPose } from '../../game/rules'
import type { FlowerKind, MaterialChoice } from '../../game/types'
import { createPlant, disposeGeometry } from './botanical-geometry'

export function flowerPortraits(renderer:WebGLRenderer,kit:Object3D,sample?:MaterialChoice) {
  const size=sample?256:144, target=new WebGLRenderTarget(size,size)
  target.texture.colorSpace=SRGBColorSpace
  const previous=renderer.getRenderTarget(), scene=new Scene(), camera=new OrthographicCamera(-1,1,1,-1,.01,3)
  scene.background=new Color('#f1eddc')
  const light=new DirectionalLight(0xfff8df,2.1)
  light.position.set(-1,2,1)
  scene.add(light,new AmbientLight(0xffffff,1.8))
  const canvas=document.createElement('canvas')
  canvas.width=canvas.height=size
  const ctx=canvas.getContext('2d')!, pixels=new Uint8Array(size*size*4),pic=ctx.createImageData(size,size)
  const result:Partial<Record<FlowerKind,string>>={}
  try {
    renderer.setRenderTarget(target)
    for(const kind of sample?[sample.kind]:Object.keys(CUP_FLOWERS) as FlowerKind[]) {
      const length=sample?.length??CUP_FLOWERS[kind].length
      const plant=createPlant(kit,{id:'sample',kind,length,stockLength:FLOWERS[kind].length*length/CUP_FLOWERS[kind].length,headScale:sample?.headScale,slot:0,location:'cup',pose:defaultPose(),removed:[]})
      scene.add(plant)
      try {
        const head=plant.getObjectByName('flower-crown')!
        const box=new Box3().setFromObject(head),center=box.getCenter(new Vector3())
        const extent=box.getSize(new Vector3())
        const half=sample ? .247 : Math.max(.033,extent.length()*.62)
        if(sample)center.set(0,.213,0)
        else center.y-=half*.22
        camera.left=camera.bottom=-half;camera.right=camera.top=half
        camera.position.copy(center).add(sample?new Vector3(.06,.05,.9):new Vector3(.12,.64,.74))
        camera.lookAt(center);camera.updateProjectionMatrix()
        renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,size,size,pixels)
        for(let y=0;y<size;y++)pic.data.set(pixels.subarray((size-y-1)*size*4,(size-y)*size*4),y*size*4)
        ctx.putImageData(pic,0,0)
        if(sample){
          ctx.fillStyle='#525e4e';ctx.strokeStyle='#909883';ctx.font='12px sans-serif'
          ctx.fillText('cm',8,16);ctx.beginPath()
          for(const cm of [0,10,20,30,40]){
            const y=(1-new Vector3(0,cm/100,0).project(camera).y)*size/2
            ctx.moveTo(27,y);ctx.lineTo(36,y);ctx.fillText(String(cm),8,y+4)
          }
          ctx.stroke()
        }
        result[kind]=canvas.toDataURL()
      } finally {scene.remove(plant);disposeGeometry(plant)}
    }
  } finally {renderer.setRenderTarget(previous);target.dispose()}
  return result
}
