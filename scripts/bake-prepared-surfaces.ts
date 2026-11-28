import {Box3,CanvasTexture,Color,Mesh,OrthographicCamera,Scene,SRGBColorSpace,Vector3,Vector4,WebGLRenderTarget} from 'three'
import type {NatureCapture} from '../src/scene/prepared-nature-capture'

/** Bake static surface response in world XZ. Lighting/shadows remain live. */
export async function prepareGroundSurface(capture:NatureCapture){
 const inspect=(globalThis as any).__coreInspect
 const sceneId=inspect.read().ritual.sceneId
 if(sceneId!=='bamboo'&&sceneId!=='creek')return
 const mesh=capture.root.getObjectByName('root_bank_soil') as Mesh
 if(!mesh?.isMesh||Array.isArray(mesh.material))return
 const source=capture.shaders.get(mesh.material)
 if(!source)throw Error('Missing ground shader for preparation')
 const renderer=inspect.renderer,box=new Box3().setFromObject(mesh),span=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
 const camera=new OrthographicCamera(-span.x/2,span.x/2,span.z/2,-span.z/2,.01,span.y+12)
 camera.position.set(center.x,box.max.y+5,center.z);camera.up.set(0,0,-1);camera.lookAt(center);camera.updateMatrixWorld()
 const worldRect=new Vector4(box.min.x,box.max.z,span.x,span.z)
 const previousTarget=renderer.getRenderTarget(),shadow=renderer.shadowMap.autoUpdate,clearColour=renderer.getClearColor(new Color()),clearAlpha=renderer.getClearAlpha()
 const textures=[]
 try{
  renderer.shadowMap.autoUpdate=false
  for(const mode of ['colour','normal','fields'] as const){
   const normal=mode==='normal',fields=mode==='fields'
   const width=normal||fields?1024:sceneId==='creek'?2048:1536,height=Math.max(512,Math.round(width*span.z/span.x)),target=new WebGLRenderTarget(width,height)
   const material=mesh.material.clone(),stage=new Scene(),proxy=new Mesh(mesh.geometry,material)
   proxy.matrixAutoUpdate=false;proxy.matrix.copy(mesh.matrixWorld);stage.add(proxy)
   material.customProgramCacheKey=()=>'prepared-ground-'+mode
   material.onBeforeCompile=shader=>{
    shader.vertexShader=source.vertex
    const output=normal?'vec4(inverseTransformDirection(normal,viewMatrix)*.5+.5,1.)':fields?(sceneId==='bamboo'?'vec4(roughnessFactor,poreFilm,0.,1.)':'vec4(roughnessFactor,0.,0.,1.)'):'sRGBTransferOETF(vec4(diffuseColor.rgb,1.))'
    shader.fragmentShader=source.fragment.slice(0,source.fragment.lastIndexOf('#include <opaque_fragment>'))+'gl_FragColor='+output+';\n}'
    // The detail fade is authored at the seated eye; the material normal itself
    // is transformed into the live camera basis when used by the game.
    shader.fragmentShader=shader.fragmentShader.replaceAll('length(vViewPosition)','length(woodlandSurface-vec3(0.,1.4721202,1.1414795))')
    Object.assign(shader.uniforms,source.uniforms);for(const name of source.clocks)shader.uniforms[name]=capture.clock
   }
   try{
    renderer.setRenderTarget(target);renderer.setClearColor(normal?new Color(.5,1,.5):fields?new Color(.91,0,0):new Color(.2,.17,.12),1);renderer.render(stage,camera)
    const pixels=new Uint8Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels)
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer),width,height),0,0)
    ;(canvas as any).preparedImageType=fields?'image/png':'image/webp'
    const texture=new CanvasTexture(canvas);texture.flipY=false;texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy())
    if(mode==='colour')texture.colorSpace=SRGBColorSpace
    textures.push(texture)
   }finally{target.dispose();material.dispose()}
  }
 }finally{renderer.setRenderTarget(previousTarget);renderer.setClearColor(clearColour,clearAlpha);renderer.shadowMap.autoUpdate=shadow}
 let fragment=source.fragment
 fragment='uniform sampler2D preparedSoilColour;uniform sampler2D preparedSoilNormal;uniform sampler2D preparedSoilFields;uniform vec4 preparedSoilRect;\n'+fragment
 const replaceRange=(from:string,to:string,body:string)=>{
  const start=fragment.indexOf(from),end=fragment.indexOf(to,start+from.length)
  if(start<0||end<0)throw Error('Ground material preparation markers changed')
  fragment=fragment.slice(0,start)+body+'\n'+fragment.slice(end)
 }
 replaceRange('#include <map_fragment>','#include <color_fragment>',`
   vec2 g=groundSample.xy;
   vec2 preparedUV=vec2(g.x-preparedSoilRect.x,preparedSoilRect.y-g.y)/preparedSoilRect.zw;
   vec4 soilColour=texture2D(preparedSoilColour,preparedUV);
   diffuseColor.rgb=soilColour.rgb;
   vec2 soilFields=texture2D(preparedSoilFields,preparedUV).rg;
   float poreFilm=soilFields.g;
   float islands=.50+.22*sin(g.x*2.2+.84*sin(g.y*1.63))+.19*cos(g.y*3.72+g.x)+.09*sin(dot(g,vec2(9.5,5.2)));`)
 fragment=fragment.replace('#include <color_fragment>','')
 replaceRange('#include <roughnessmap_fragment>','#include <metalnessmap_fragment>',
  'float roughnessFactor=soilFields.r;')
 replaceRange('#include <normal_fragment_maps>','#include <clearcoat_normal_fragment_begin>',
  'normal=normalize(mat3(viewMatrix)*(texture2D(preparedSoilNormal,preparedUV).rgb*2.-1.));')
 capture.shaders.set(mesh.material,{...source,fragment,uniforms:{...source.uniforms,
  preparedSoilColour:{value:textures[0]},preparedSoilNormal:{value:textures[1]},preparedSoilFields:{value:textures[2]},preparedSoilRect:{value:worldRect}}})
 capture.root.userData.preparedGround={name:mesh.name,bounds:[worldRect.x,worldRect.y,worldRect.z,worldRect.w],images:textures.map(t=>[t.image.width,t.image.height]),lighting:'live'}
}
