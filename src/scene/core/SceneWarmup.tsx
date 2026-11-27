import {useLayoutEffect,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Group,Mesh,WebGLRenderTarget} from 'three'

/** Submit visible programs together, then let the driver finish without a blocking first draw. */
export function SceneWarmup({identity,onReady}:{identity:object;onReady:()=>void}){
  const {gl,scene,camera,setFrameloop,invalidate}=useThree()
  const [error,setError]=useState<Error>()
  useLayoutEffect(()=>{
    let cancelled=false
    setFrameloop('never')
    const visible=new Group(),linearTarget=new WebGLRenderTarget(1,1)
    // Run after all sibling layout effects have installed their lights and maps.
    void Promise.resolve().then(async()=>{
      if(cancelled)return
      // compileAsync traverses invisible descendants too. Borrow only visible mesh
      // references without reparenting them or copying their geometry/materials.
      scene.traverseVisible(object=>{if(object instanceof Mesh)visible.children.push(object)})
      const previous=gl.getRenderTarget()
      let linear:Promise<unknown>
      try{
        // The glass renders opaque objects into a linear target before the main
        // view. Submit that shader variant too; no offscreen image is drawn here.
        gl.setRenderTarget(linearTarget);linear=gl.compileAsync(visible,camera,scene)
      }finally{gl.setRenderTarget(previous)}
      await Promise.all([linear,gl.compileAsync(visible,camera,scene)])
    }).then(()=>{
      linearTarget.dispose()
      if(cancelled)return
      setFrameloop('demand');invalidate();onReady()
    }).catch(reason=>{linearTarget.dispose();if(!cancelled)setError(reason instanceof Error?reason:new Error('材质准备失败'))})
    return()=>{cancelled=true;visible.children.length=0;setFrameloop('demand')}
  },[identity,gl,scene,camera,setFrameloop,invalidate,onReady])
  if(error)throw error
  return null
}
