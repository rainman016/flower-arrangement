import {isCreekBedMesh} from '../CreekOptics'
import {shadowPrograms} from './shadow-programs'
import {ResolutionChange} from './ResolutionChange'
import {calibrateScene} from './calibrate-scene'
import {lowWoodlandQuality} from '../render-quality'
import {useContext,useLayoutEffect,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Group,Mesh,Plane,Vector3,WebGLRenderTarget} from 'three'

/** Submit visible programs together, then let the driver finish without a blocking first draw. */
export function SceneWarmup({identity,texturesReady,onReady}:{identity:object;texturesReady?:Promise<void>;onReady:()=>void}){
  const {gl,scene,camera,setFrameloop,setDpr,get,invalidate}=useThree()
  const [error,setError]=useState<Error>(),notifyResolution=useContext(ResolutionChange)
  useLayoutEffect(()=>{
    let cancelled=false
    const started=performance.now(),timing:Record<string,number>={start:started};scene.userData.runtimeTimings=timing
    setFrameloop('never')
    const visible=new Group(),bed=new Group(),linearTarget=new WebGLRenderTarget(1,1)
    let shadows:ReturnType<typeof shadowPrograms>|undefined
    // Run after all sibling layout effects have installed their lights and maps.
    void Promise.resolve().then(async()=>{
      if(cancelled)return
      // compileAsync traverses invisible descendants too. Borrow only visible mesh
      // references without reparenting them or copying their geometry/materials.
      scene.traverseVisible(object=>{if(object instanceof Mesh){visible.children.push(object);if(isCreekBedMesh(object.name))bed.children.push(object)}})
      const mirror=scene.getObjectByName('creek_mirror_grove')
      mirror?.traverse(object=>{if(object instanceof Mesh&&!visible.children.includes(object))visible.children.push(object)})
      const previous=gl.getRenderTarget(),clipping=gl.clippingPlanes
      let linear:Promise<unknown>,depth:Promise<unknown>,riverbed:Promise<unknown>|undefined
      try{
        // The glass renders opaque objects into a linear target before the main
        // view. Submit that shader variant too; no offscreen image is drawn here.
        gl.setRenderTarget(linearTarget);linear=gl.compileAsync(visible,camera,scene)
        shadows=shadowPrograms(scene);depth=gl.compileAsync(shadows.group,camera,scene)
        if(mirror&&bed.children.length){gl.clippingPlanes=[new Plane(new Vector3(0,-1,0),0)];riverbed=gl.compileAsync(bed,camera,scene)}
      }finally{gl.clippingPlanes=clipping;gl.setRenderTarget(previous)}
      await Promise.all([linear,depth,riverbed,...(scene.userData.frameTransmission?[]:[gl.compileAsync(visible,camera,scene)])])
      timing.shaders=performance.now()-started
      await texturesReady
      timing.compiled=performance.now()-started
      if(cancelled)return
      if(lowWoodlandQuality){
        const gpuMs=await calibrateScene(gl,scene,camera,()=>cancelled)
        timing.measured=performance.now()-started
        if(gpuMs&&!cancelled){
          const size=get().size,initial=gl.getPixelRatio(),chosen=Math.min(initial,Math.max(.58,initial*Math.sqrt(19/gpuMs)))
          scene.userData.runtimeCalibration={gpuMs,initialDpr:initial,chosenDpr:chosen,pixels:size.width*size.height*chosen*chosen}
          setDpr(chosen);notifyResolution(chosen)
          await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))
        }
      }else gl.render(scene,camera)
    }).then(()=>{
      linearTarget.dispose();shadows?.dispose()
      if(cancelled)return
      timing.ready=performance.now()-started
      setFrameloop('demand');invalidate();onReady()
    }).catch(reason=>{linearTarget.dispose();shadows?.dispose();if(!cancelled)setError(reason instanceof Error?reason:new Error('材质准备失败'))})
    return()=>{cancelled=true;visible.children.length=0;bed.children.length=0;setFrameloop('demand')}
  },[identity,texturesReady,gl,scene,camera,setFrameloop,setDpr,get,invalidate,onReady,notifyResolution])
  if(error)throw error
  return null
}
