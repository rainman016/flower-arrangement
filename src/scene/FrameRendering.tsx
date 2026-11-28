import {creekDepthPass} from './CreekDepthPass'
import {displayLightTexture} from './display-light'
import {createContext,useEffect,useLayoutEffect,useMemo,type ReactNode} from 'react'
import {useThree} from '@react-three/fiber'
import {UnsignedInt101111Type,RGBFormat,LinearMipmapLinearFilter,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector2,WebGLRenderTarget,type Texture,type Material,type Object3D} from 'three'
import {lowWoodlandQuality} from './render-quality'

export const FrameTransmission=createContext<{texture:Texture;size:Vector2}|null>(null)

/** Reuse the current opaque HDR frame for glass instead of drawing the forest twice. */
export function FrameRendering({children}:{children:ReactNode}){
 const {gl,scene}=useThree()
 const frame=useMemo(()=>{
  if(!lowWoodlandQuality||new URLSearchParams(location.search).has('native-render')||!gl.extensions.has('EXT_color_buffer_float'))return null
  const colour=new WebGLRenderTarget(1,1,{type:UnsignedInt101111Type,format:RGBFormat,samples:2,depthBuffer:true})
  const transmitted=new WebGLRenderTarget(1,1,{type:UnsignedInt101111Type,format:RGBFormat,depthBuffer:false,generateMipmaps:true,minFilter:LinearMipmapLinearFilter})
  const output=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2)
  const material=new ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{image:{value:colour.texture}},
   vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'})
  output.add(new Mesh(geometry,material))
  return {displayLight:displayLightTexture(),colour,transmitted,output,camera,geometry,material,transmission:{texture:transmitted.texture,size:new Vector2(1,1)}}
 },[gl,scene])
 useLayoutEffect(()=>{
  if(!frame)return
  const render=gl.render,draw=gl.renderBufferDirect,size=new Vector2(),rootScene=scene
  let water:Mesh|undefined,creekDepth:ReturnType<typeof creekDepthPass>|undefined
  let phase:'idle'|'opaque'|'overlay'='idle',view:Parameters<typeof gl.render>[1]|undefined
  const workbench=new WeakMap<Object3D,boolean>()
  const outdoors=new WeakMap<Object3D,boolean>()
  const onWorkbench=(object:Object3D)=>{
   const cached=workbench.get(object);if(cached!==undefined)return cached
   let found=false;for(let parent:Object3D|null=object;parent;parent=parent.parent)if(parent.name==='workbench_and_tools'||parent.name==='tool_contact_shadows'){found=true;break}
   workbench.set(object,found);return found
  }
  const inNature=(object:Object3D)=>{
   const cached=outdoors.get(object);if(cached!==undefined)return cached
   let found=false;for(let parent:Object3D|null=object;parent;parent=parent.parent)if(parent.name==='three_dimensional_nature'||parent.name==='nature_environment'){found=true;break}
   outdoors.set(object,found);return found
  }
  // Opaque desk surfaces cover much of the forest in the seated view. Write
  // their depth first, retaining explicit draw order and transparent sorting.
  gl.setOpaqueSort((a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||Number(onWorkbench(b.object))-Number(onWorkbench(a.object))||a.material.id-b.material.id||a.z-b.z||a.id-b.id)
  scene.userData.frameTransmission=true
  const displays=new Map<Material,{before:Material['onBeforeCompile'];key:Material['customProgramCacheKey'];linear:{value:number};exposure:{value:number}}>()
  const prepareDisplay=(material:Material)=>{
   if(displays.has(material)||material.toneMapped&&(!(material instanceof ShaderMaterial)||material.fragmentShader.includes('<tonemapping_fragment>')))return
   const before=material.onBeforeCompile,key=material.customProgramCacheKey,baseKey=key.call(material),linear={value:0},exposure={value:1}
   displays.set(material,{before,key,linear,exposure});material.customProgramCacheKey=()=>baseKey+'-frame-display-v1'
   material.onBeforeCompile=(shader,renderer)=>{
    before.call(material,shader,renderer)
    shader.uniforms.flowerInverseDisplay={value:frame.displayLight};shader.uniforms.flowerLinearDisplay=linear;shader.uniforms.flowerDisplayExposure=exposure
    shader.fragmentShader='uniform highp sampler3D flowerInverseDisplay;uniform float flowerLinearDisplay,flowerDisplayExposure;\n'+shader.fragmentShader.replace('#include <colorspace_fragment>',`
     if(flowerLinearDisplay>.5){vec3 lookup=sqrt(clamp(gl_FragColor.rgb,0.,1.))*(32./33.)+(.5/33.);gl_FragColor.rgb=texture(flowerInverseDisplay,lookup).rgb/max(.0001,flowerDisplayExposure);}
     #include <colorspace_fragment>
    `)
   };material.needsUpdate=true
  }
  scene.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])prepareDisplay(m)})
  gl.renderBufferDirect=function(camera,scene,geometry,material,object,group){
   // Keep the workbench present for real shadow maps, but omit its colour from
   // the cached outdoor pass. It is drawn live in front of that pass every frame.
   if(rootScene.userData.frameLinearTarget&&gl.getRenderTarget()===rootScene.userData.frameLinearTarget&&onWorkbench(object))return
   if(phase!=='idle'&&camera===view&&gl.getRenderTarget()===frame.colour){
    if(rootScene.userData.frameNatureCached&&inNature(object))return
    const overlay=object!==water&&(material.transparent||material.userData.frameTransmission===true)
    if((phase==='opaque'&&overlay)||(phase==='overlay'&&!overlay))return
   }
   const linear=gl.getRenderTarget()===frame.colour||Boolean(rootScene.userData.frameLinearTarget&&gl.getRenderTarget()===rootScene.userData.frameLinearTarget)
   if(linear)prepareDisplay(material)
   const display=displays.get(material)
   if(display){display.linear.value=linear?1:0;display.exposure.value=gl.toneMappingExposure;if(material instanceof ShaderMaterial)material.uniformsNeedUpdate=true}
   return draw.call(this,camera,scene,geometry,material,object,group)
  }
  gl.render=function(object,camera){
   if(object!==scene||gl.getRenderTarget()||!gl.autoClear||phase!=='idle')return render.call(this,object,camera)
   gl.getDrawingBufferSize(size)
   if(frame.colour.width!==size.x||frame.colour.height!==size.y){
    frame.colour.setSize(size.x,size.y);frame.transmitted.setSize(size.x,size.y)
    frame.transmission.size.copy(size);gl.initRenderTarget(frame.transmitted)
   }
   const clear=gl.autoClear,shadow=gl.shadowMap.autoUpdate,reset=gl.info.autoReset
   if(reset)gl.info.reset();gl.info.autoReset=false
   view=camera
   try{
    phase='opaque';gl.setRenderTarget(frame.colour);gl.autoClear=true
    if(!water){const found=scene.getObjectByName('creek_surface');if(found instanceof Mesh){water=found;creekDepth=creekDepthPass(water)}}
    if(creekDepth&&water?.visible){
     creekDepth.sync();gl.shadowMap.autoUpdate=false;render.call(this,creekDepth.scene,camera)
     gl.shadowMap.autoUpdate=shadow;gl.autoClear=false
    }
    render.call(this,scene,camera)
    // The resolved HDR colour is copied on the GPU; no CPU readback or stale view.
    gl.copyTextureToTexture(frame.colour.texture,frame.transmitted.texture)
    phase='overlay';gl.setRenderTarget(frame.colour);gl.autoClear=false;gl.shadowMap.autoUpdate=false
    render.call(this,scene,camera)
    phase='idle';gl.setRenderTarget(null);gl.autoClear=true
    render.call(this,frame.output,frame.camera)
   }finally{phase='idle';view=undefined;gl.autoClear=clear;gl.shadowMap.autoUpdate=shadow;gl.info.autoReset=reset;gl.setRenderTarget(null)}
  }
  return()=>{creekDepth?.dispose();gl.setOpaqueSort(null);gl.render=render;gl.renderBufferDirect=draw;delete scene.userData.frameTransmission;for(const [material,old]of displays){material.onBeforeCompile=old.before;material.customProgramCacheKey=old.key;material.needsUpdate=true}}
 },[gl,scene,frame])
 useEffect(()=>()=>{frame?.displayLight.dispose();frame?.colour.dispose();frame?.transmitted.dispose();frame?.material.dispose();frame?.geometry.dispose()},[frame])
 return <FrameTransmission.Provider value={frame?.transmission??null}>{children}</FrameTransmission.Provider>
}
