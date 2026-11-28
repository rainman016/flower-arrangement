import {describe,it,expect} from 'vitest'
import {preparedImagesReady} from '../../src/services/prepared-images'
class Image extends EventTarget{complete=false;naturalWidth=0}
describe('prepared image completion',()=>{
 it('waits on a shared in-flight image without relying on loader accounting',async()=>{
  const image=new Image();let ready=false
  const pending=preparedImagesReady({first:{data:image},duplicate:{data:image}}).then(()=>{ready=true})
  await Promise.resolve();expect(ready).toBe(false)
  image.naturalWidth=64;image.complete=true;image.dispatchEvent(new Event('load'))
  await pending;expect(ready).toBe(true)
 })
 it('accepts a complete cached image and synchronous data textures',async()=>{
  const image=new Image();image.complete=true;image.naturalWidth=64
  await expect(preparedImagesReady({image:{data:image},data:{data:{data:new Uint8Array(4),width:1,height:1}}})).resolves.toBeUndefined()
 })
 it('rejects image errors so the source scene can take over',async()=>{
  const image=new Image(),pending=preparedImagesReady({image:{data:image}})
  image.complete=true;image.dispatchEvent(new Event('error'))
  await expect(pending).rejects.toThrow('环境纹理读取失败')
 })
})
