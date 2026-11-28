import {Box3,Color,DepthTexture,HalfFloatType,LinearFilter,Mesh,NoToneMapping,OrthographicCamera,Plane,ShaderMaterial,UnsignedIntType,Vector2,Vector3,Vector4,WebGLRenderTarget,type Object3D,type Scene,type WebGLRenderer} from 'three'
import {lowWoodlandQuality} from './render-quality.ts'

// Captured depth was originally projected with only the Z row of a symmetric
// perspective matrix. Reflector adds X/Y terms to that row for its oblique clip
// plane; omitting them creates rectangular, above/below-water depth boundaries.
export function correctCreekMirrorDepth(root:Object3D){
  let changed=0
  root.getObjectByName('woodland_distance_surfaces')?.traverse(node=>{
    if(!(node instanceof Mesh)||!(node.material instanceof ShaderMaterial))return
    const m=node.material
    if(!m.defines.CAPTURE_DEPTH||m.userData.creekMirrorDepth||!m.fragmentShader.includes('float eyeZ='))return
    m.vertexShader=m.vertexShader.replace('varying vec4 depthProjection;','varying vec4 creekDepthOrigin;varying vec4 creekDepthRay;')
      .replace(/float originZ=[\s\S]*?depthProjection=[^;]+;/,`vec4 captureEye=modelViewMatrix*vec4(captureOrigin,1.);
          creekDepthOrigin=projectionMatrix*captureEye;
          creekDepthRay=projectionMatrix*vec4(viewPoint.xyz-captureEye.xyz,0.);`)
    m.fragmentShader=m.fragmentShader.replace('varying vec4 depthProjection;','varying vec4 creekDepthOrigin;varying vec4 creekDepthRay;')
      .replace(/float eyeZ=[\s\S]*?gl_FragDepth=[^;]+;/,`vec4 exactClip=creekDepthOrigin+creekDepthRay*(metres/fromCapture.z);
          if(metres<.01||exactClip.w<=0.||exactClip.z< -exactClip.w||exactClip.z>exactClip.w)discard;
          gl_FragDepth=.5+.5*exactClip.z/exactClip.w;`)
    m.userData.creekMirrorDepth=true;m.needsUpdate=true;changed++
  })
  return changed
}

export const isCreekBedMesh=(name:string)=>
  /^(terrain|root_bank_soil|submerged_stream_pebbles|creek_shallow_mineral_bar|creek_margin_cobbles|creek_margin_chips|creek_far_shore_stones)$/.test(name)
  ||/^creek_contact_(rootwood|rootlets|wet_stones)$|^creek_bank_shingle_|^mossy_bank_stone_|^forest_(rock|ledge)_/.test(name)

export function creekBedCapture(level:number,source:Mesh){
  source.updateWorldMatrix(true,false)
  const bounds=new Box3().setFromObject(source).expandByScalar(1.4),span=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3())
  let floor=level-.5
  for(const name of ['root_bank_soil','terrain']){
    const mesh=source.parent?.getObjectByName(name)
    if(mesh instanceof Mesh)floor=Math.min(floor,new Box3().setFromObject(mesh).min.y-.08)
  }
  const camera=new OrthographicCamera(-span.x/2,span.x/2,span.z/2,-span.z/2,.1,level+2-floor)
  camera.position.set(center.x,level+2,center.z);camera.up.set(0,0,-1);camera.lookAt(center.x,level,center.z);camera.updateMatrixWorld()
  // UV X follows world X; UV Y follows -Z. Depth is linear with world height
  // under this orthographic camera, including the real stone and pebble surfaces.
  const worldToUv=new Vector4(bounds.min.x,bounds.max.z,1/span.x,-1/span.z)
  const heightRange=new Vector2(camera.position.y-camera.near,camera.position.y-camera.far)
  const density=lowWoodlandQuality?96:128,limit=lowWoodlandQuality?2048:2560
  const width=Math.min(limit,Math.ceil(span.x*density)),height=Math.min(limit,Math.ceil(span.z*density))
  const target=new WebGLRenderTarget(width,height,{type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,generateMipmaps:false})
  target.depthTexture=new DepthTexture(width,height,UnsignedIntType)
  target.depthTexture.minFilter=target.depthTexture.magFilter=LinearFilter
  const plane=new Plane(new Vector3(0,-1,0),level+.002)
  const clearColour=new Color()
  let cachedScene:Scene|null=null
  const stats={renders:0,reused:0}
  function capture(renderer:WebGLRenderer,scene:Scene){
    // The world-space bed atlas is independent of player pose and canvas size.
    // Reuse it while the static environment lives; every fragment still traces
    // its current refracted ray into these real, unoccluded bed heights.
    if(cachedScene===scene){
      stats.reused++;return false
    }
    const hidden:Mesh[]=[],previous=renderer.getRenderTarget(),xr=renderer.xr.enabled
    const shadows=renderer.shadowMap.autoUpdate,clipping=renderer.clippingPlanes,tone=renderer.toneMapping
    const background=scene.background,fog=scene.fog,clearAlpha=renderer.getClearAlpha()
    renderer.getClearColor(clearColour)
    const cube=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel()
    // Keep the actual bank/bed/stone meshes and their lighting. In particular,
    // above-water foliage, depth shells, the desk and glass cannot enter this map.
    scene.traverse(node=>{
      if(!(node instanceof Mesh)||!node.visible)return
      const bed=isCreekBedMesh(node.name)
      if(!bed){node.visible=false;hidden.push(node)}
    })
    try{
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false
      renderer.clippingPlanes=[plane];renderer.toneMapping=NoToneMapping
      // No ray hit is water volume, not a view of the background sky through a
      // clipped-out bank. Alpha carries that validity into the refraction shader.
      scene.background=null;scene.fog=null;renderer.setClearColor(0x000000,0)
      renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera)
      cachedScene=scene;stats.renders++
    }finally{
      for(const mesh of hidden)mesh.visible=true
      renderer.clippingPlanes=clipping;renderer.toneMapping=tone
      scene.background=background;scene.fog=fog;renderer.setClearColor(clearColour,clearAlpha)
      renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadows
      renderer.setRenderTarget(previous,cube,mip)
    }
    return true
  }
  return {target,camera,worldToUv,heightRange,capture,stats,dispose:()=>target.dispose()}
}
