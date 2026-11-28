import {isCreekBedMesh} from '../CreekOptics'
import {shadowPrograms} from './shadow-programs'
import {ResolutionChange} from './ResolutionChange'
import {calibrateScene} from './calibrate-scene'
import {lowWoodlandQuality,qualityChoice,startingPixelRatio} from '../render-quality'
import {readRenderBudget,saveRenderBudget} from '../../services/render-budget'
import {useContext,useLayoutEffect,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Group,Mesh,Plane,Texture,Vector3,WebGLRenderTarget} from 'three'

/** Submit visible programs together, then let the driver finish without a blocking first draw. */
export function SceneWarmup({identity,cacheKey,texturesReady,textureUploads,onReady}:{identity:object;cacheKey?:string;texturesReady?:Promise<void>;textureUploads?:Map<Texture,Promise<void>>;onReady:()=>void}){
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
      const textures=new Set<Texture>(),collect=(value:unknown)=>{
        if(value instanceof Texture&&!value.isRenderTargetTexture)textures.add(value)
        else if(Array.isArray(value))value.forEach(collect)
      }
      visible.traverse(object=>{
        if(!(object instanceof Mesh))return
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          Object.values(material).forEach(collect)
          if('uniforms' in material)for(const uniform of Object.values(material.uniforms as Record<string,{value:unknown}>))collect(uniform.value)
        }
      })
      const previous=gl.getRenderTarget(),clipping=gl.clippingPlanes,fog=scene.fog
      let linear:Promise<unknown>,depth:Promise<unknown>,riverbed:Promise<unknown>|undefined
      try{
        // The glass renders opaque objects into a linear target before the main
        // view. Submit that shader variant too; no offscreen image is drawn here.
        gl.setRenderTarget(linearTarget);linear=gl.compileAsync(visible,camera,scene)
        // Shadow draws have no scene fog; the real riverbed capture removes it too.
        // Warming fogged variants here otherwise repeats their compilation at first draw.
        scene.fog=null
        shadows=shadowPrograms(scene);depth=gl.compileAsync(shadows.group,camera,scene)
        if(mirror&&bed.children.length){gl.clippingPlanes=[new Plane(new Vector3(0,-1,0),0)];riverbed=gl.compileAsync(bed,camera,scene)}
      }finally{scene.fog=fog;gl.clippingPlanes=clipping;gl.setRenderTarget(previous)}
      // Authored shader patches can add textures outside the material's public
      // properties. Their compiled uniforms are available after submission.
      visible.traverse(object=>{
        if(!(object instanceof Mesh))return
        for(const material of Array.isArray(object.material)?object.material:[object.material]){
          const {uniforms}=gl.properties.get(material) as {uniforms?:Record<string,{value:unknown}>}
          if(uniforms)for(const uniform of Object.values(uniforms))collect(uniform.value)
        }
      })
      collect(scene.background)
      // Submit uploads while the parallel shader compiler works, instead of
      // alternating blocking texture/program queries in the first visible draw.
      const uploaded=Promise.all([...textures].map(texture=>Promise.resolve(textureUploads?.get(texture)??texturesReady).then(()=>{
        if(!cancelled)gl.initTexture(texture)
      }))).then(()=>{timing.uploaded=performance.now()-started})
      void uploaded.catch(()=>{})
      await Promise.all([linear,depth,riverbed,scene.userData.warmFrame?.(camera),...(scene.userData.frameTransmission?[]:[gl.compileAsync(visible,camera,scene)])])
      // compileAsync tracks each material's currentProgram. Bed preparation changes
      // that pointer, so explicitly wait for every submitted variant before use.
      const context=gl.getContext(),parallel=context.getExtension('KHR_parallel_shader_compile')
      const submitted=[...(gl.info.programs??[])]
      if(parallel)while(!cancelled&&submitted.some(program=>!context.getProgramParameter(program.program as WebGLProgram,parallel.COMPLETION_STATUS_KHR)))await new Promise(done=>setTimeout(done,10))
      if(cancelled)return
      // Success logs force three synchronous driver round trips per program on
      // ANGLE. Still validate every link and keep Three's full failure diagnostics.
      for(const program of submitted){
        if(!context.getProgramParameter(program.program as WebGLProgram,context.LINK_STATUS)){
          program.getUniforms();throw new Error('场景材质编译失败：'+program.name)
        }
        const diagnostics=gl.debug.checkShaderErrors
        try{gl.debug.checkShaderErrors=false;program.getUniforms();program.getAttributes()}
        finally{gl.debug.checkShaderErrors=diagnostics}
      }
      timing.shaders=performance.now()-started
      await uploaded
      await texturesReady
      timing.compiled=performance.now()-started
      if(cancelled)return
      const programs=()=>gl.info.programs?.map(program=>({name:program.name,key:(program as unknown as {cacheKey:string}).cacheKey}))
      const review=Boolean((globalThis as {flowerCoreReview?:boolean}).flowerCoreReview)
      if(review)scene.userData.runtimePrograms={warmed:programs()}
      if(lowWoodlandQuality){
        const size=get().size,deviceRatio=window.devicePixelRatio,ceiling=startingPixelRatio(size.width,size.height,deviceRatio),key=cacheKey?cacheKey+':'+(qualityChoice??'auto'):undefined
        const cached=readRenderBudget(key,size.width,size.height,deviceRatio,ceiling)
        const gpuMs=cached?.gpuMs??await calibrateScene(gl,scene,camera,()=>cancelled)
        timing.measured=performance.now()-started
        if(!cancelled){
          const initial=gl.getPixelRatio(),chosen=cached?.dpr??(gpuMs?Math.min(ceiling,Math.max(.58,initial*Math.sqrt(19/gpuMs))):ceiling)
          scene.userData.runtimeCalibration={gpuMs,cached:Boolean(cached),initialDpr:initial,maxDpr:ceiling,chosenDpr:chosen,pixels:size.width*size.height*chosen*chosen}
          if(gpuMs&&!cached)saveRenderBudget(key,{width:size.width,height:size.height,deviceRatio,dpr:chosen,gpuMs})
          setDpr(chosen);notifyResolution(chosen)
          await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))
          if(!cancelled)gl.render(scene,camera)
        }
      }else gl.render(scene,camera)
      if(review)scene.userData.runtimePrograms.drawn=programs()
    }).then(()=>{
      linearTarget.dispose();shadows?.dispose()
      if(cancelled)return
      timing.ready=performance.now()-started
      setFrameloop('demand');invalidate();onReady()
    }).catch(reason=>{linearTarget.dispose();shadows?.dispose();if(!cancelled)setError(reason instanceof Error?reason:new Error('材质准备失败'))})
    return()=>{cancelled=true;visible.children.length=0;bed.children.length=0;setFrameloop('demand')}
  },[identity,cacheKey,texturesReady,textureUploads,gl,scene,camera,setFrameloop,setDpr,get,invalidate,onReady,notifyResolution])
  if(error)throw error
  return null
}
