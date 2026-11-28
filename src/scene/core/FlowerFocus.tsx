import {useEffect,useMemo} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {
  Camera, DirectionalLight, DoubleSide, Group, HalfFloatType, Light, LinearMipmapLinearFilter, Matrix4, Mesh, MeshDepthMaterial, Object3D, OrthographicCamera,
  PlaneGeometry, RGBFormat, Scene, ShaderMaterial, UnsignedByteType, UnsignedInt101111Type, Vector2, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import {useCoreStore} from '../../state/core-store'
import type {CoreWorld} from './CoreCanvas'
import {creekDepthPass} from '../CreekDepthPass'

const focusLayer=11

// The table exposure is cached in linear light. Cutting and falling leaves stay live.
function createFocusView(gl:WebGLRenderer){
  const target=new WebGLRenderTarget(1,1,{type:gl.extensions.has('EXT_color_buffer_float')?HalfFloatType:UnsignedByteType})
  target.texture.generateMipmaps=true;target.texture.minFilter=LinearMipmapLinearFilter
  // Outdoors is behind the entire desk. Reuse just that colour pass during an insertion
  // gesture; the desk, glass, vase and every stem still share the live depth buffer.
  let garden=new WebGLRenderTarget(1,1,{type:UnsignedInt101111Type,format:RGBFormat,samples:2}),nextGarden=garden.clone()
  let gardenPart=0,gardenTime=0,gardenRest=false
  const gardenCamera=new Matrix4(),gardenProjection=new Matrix4()
  let bench:Object3D|undefined,nature:Object3D|undefined,lastGarden=-Infinity
  let creekDepth:ReturnType<typeof creekDepthPass>|undefined
  let creekWater:Mesh|undefined
  const gardenStats={renders:0,reused:0,viewUpdates:0,batches:0}
  const deskDepth=new Scene(),deskDepthMaterial=new MeshDepthMaterial({colorWrite:false,side:DoubleSide}),deskDepthMeshes=new Map<Mesh,Mesh>()
  // Leave the visible antialiased silhouette uncovered. Resolving a partially
  // covered depth edge twice would otherwise darken a thin outer border.
  deskDepth.scale.set(.994,1,.994)
  function syncDeskDepth(scene:Scene){
    for(const proxy of deskDepthMeshes.values())proxy.visible=false
    scene.getObjectByName('wood_table_root')?.traverseVisible(source=>{
      if(!(source instanceof Mesh))return
      let proxy=deskDepthMeshes.get(source)
      if(!proxy){proxy=new Mesh(source.geometry,deskDepthMaterial);proxy.matrixAutoUpdate=false;deskDepth.add(proxy);deskDepthMeshes.set(source,proxy)}
      source.updateWorldMatrix(true,false);proxy.geometry=source.geometry;proxy.matrix.copy(source.matrixWorld);proxy.matrixWorldNeedsUpdate=true;proxy.visible=true
    })
  }
  const quad=new Scene(),camera2d=new OrthographicCamera(-1,1,1,-1,0,1)
  const material=new ShaderMaterial({
    depthWrite:false,depthTest:false,
    uniforms:{photo:{value:target.texture},stepUV:{value:new Vector2()}},
    vertexShader:'varying vec2 coord;void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`varying vec2 coord;uniform sampler2D photo;uniform vec2 stepUV;
      void main(){
        float blur=mix(.35,1.,smoothstep(.23,.60,coord.y));
        vec3 color=vec3(0.);float total=0.;
        for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
          vec2 p=vec2(float(x),float(y));float w=exp(-.44*dot(p,p));
          color+=w*texture2D(photo,coord+stepUV*p*blur,3.0*blur).rgb;total+=w;
        }
        color/=total;
        color=mix(vec3(dot(color,vec3(.2126,.7152,.0722))),color,.88);
        gl_FragColor=vec4(color*.91,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`})
  const plane=new PlaneGeometry(2,2);quad.add(new Mesh(plane,material))
  // The glass samples opaque objects in its own transmission pass. Include the
  // blurred desk in that pass as well as the final image.
  const pourBackdrop=new Mesh(plane,material)
  pourBackdrop.frustumCulled=false;pourBackdrop.layers.set(focusLayer);pourBackdrop.renderOrder=-100000
  const savedLayers=new Map<Object3D,number>(),cameraMatrix=new Matrix4()
  let key='',subjectKey='',lastShot=-Infinity,active=false
  function enable(object:Object3D){
    if(!savedLayers.has(object))savedLayers.set(object,object.layers.mask)
    object.layers.enable(focusLayer)
  }
  function restore(){
    for(const [object,mask] of savedLayers)object.layers.mask=mask
    savedLayers.clear();key='';subjectKey='';active=false
  }
  function draw(scene:Scene,camera:Camera,world:CoreWorld,width:number,height:number){
    const state=useCoreStore.getState(),id=state.heldId,stage=state.ritual?.stage
    const pour=stage==='prepare'&&state.pourPhase!=='carry'
    const subject=(state.vaseFocus||pour)?world.vase:id?world.flowers.get(id):undefined
    if(scene.userData.frameTransmission&&!state.vaseFocus&&!pour&&(stage==='prepare'||stage==='arrange'&&state.ritual?.arranging)&&world.active&&['carry','prop','move','pose','rotate'].includes(world.active.kind)){
      if(active)restore()
      if(!bench?.parent)bench=scene.getObjectByName('workbench_and_tools')
      if(!nature?.parent)nature=scene.getObjectByName('three_dimensional_nature')??scene.getObjectByName('nature_environment')
      if(bench&&nature){
        const w=Math.max(1,Math.floor(width*gl.getPixelRatio())),h=Math.max(1,Math.floor(height*gl.getPixelRatio()))
        const now=performance.now(),oldTarget=gl.getRenderTarget(),background=scene.background
        const update=gl.shadowMap.autoUpdate,needsUpdate=gl.shadowMap.needsUpdate,clear=gl.autoClear,linearTarget=scene.userData.frameLinearTarget,cachedNature=scene.userData.frameNatureCached,slice=scene.userData.frameEnvironmentSlice
        const clock=scene.getObjectByName('nature_environment')?.userData.natureClock as {value:number}|undefined,liveTime=clock?.value
        const showBench=bench.visible,showNature=nature.visible
        if(!creekWater){const water=scene.getObjectByName('creek_surface');if(water instanceof Mesh){creekWater=water;creekDepth=creekDepthPass(water)}}
        const showWater=creekWater?.visible
        try{
          const viewChanged=garden.width!==w||garden.height!==h||!gardenCamera.equals(camera.matrixWorld)||!gardenProjection.equals(camera.projectionMatrix)
          const refresh=viewChanged||gardenPart!==0||now-lastGarden>=50&&!gardenRest
          if(refresh){
            // A changed viewpoint is drawn completely now. At a fixed eye,
            // alternate opaque ground and foliage/water work across two frames.
            // Only swap a finished image into the foreground's background.
            const immediate=viewChanged||lastGarden===-Infinity,part=immediate?0:gardenPart===0?1:2
            const destination=immediate?garden:nextGarden
            if(part!==2){destination.setSize(w,h);gardenTime=liveTime??0;lastGarden=now}
            if(clock)clock.value=gardenTime
            gl.setRenderTarget(destination);scene.userData.frameLinearTarget=destination
            gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false
            // The static table is redrawn live over these same pixels. Its real
            // depth can reject hidden ground/foliage in the outdoor pass too.
            if(part!==2){
              scene.userData.frameEnvironmentSlice=undefined
              syncDeskDepth(scene);gl.autoClear=true;gl.render(deskDepth,camera);gl.autoClear=false
              if(creekDepth){creekDepth.sync();gl.render(creekDepth.scene,camera)}
            }else gl.autoClear=false
            scene.userData.frameEnvironmentSlice=part
            if(part===1&&creekWater)creekWater.visible=false
            if(part===2)scene.background=null
            gl.render(scene,camera);gl.autoClear=clear
            if(creekWater)creekWater.visible=showWater!
            scene.background=background;scene.userData.frameEnvironmentSlice=undefined
            if(clock&&liveTime!==undefined)clock.value=liveTime
            if(part===1){gardenPart=1;gardenStats.reused++}
            else{
              if(part===2)[garden,nextGarden]=[nextGarden,garden]
              gardenPart=0;gardenRest=true;gardenCamera.copy(camera.matrixWorld);gardenProjection.copy(camera.projectionMatrix)
              gardenStats.renders++;if(viewChanged)gardenStats.viewUpdates++
            }
            if(part)gardenStats.batches++
          }else {gardenStats.reused++;gardenRest=false}
          scene.userData.deskEnvironmentCache=gardenStats
          bench.visible=showBench;scene.background=garden.texture;scene.userData.frameNatureCached=true
          if(creekWater)creekWater.visible=false
          gl.shadowMap.autoUpdate=update;gl.shadowMap.needsUpdate=needsUpdate
          // Retain real forest geometry for shadows while reusing only its
          // colour. Update the sun on a light frame, separate from the outdoor
          // colour refresh; desk/contact shadows still follow every movement.
          const suns:{light:DirectionalLight;needs:boolean}[]=[]
          if(refresh)scene.traverse(light=>{if(light instanceof DirectionalLight){suns.push({light,needs:light.shadow.needsUpdate});light.shadow.needsUpdate=false}})
          try{gl.setRenderTarget(oldTarget);gl.render(scene,camera)}finally{for(const {light,needs}of suns)if(light.shadow)light.shadow.needsUpdate=needs}
        }finally{
          bench.visible=showBench;nature.visible=showNature;scene.background=background
          if(creekWater)creekWater.visible=showWater!
          gl.setRenderTarget(oldTarget);gl.shadowMap.autoUpdate=update;gl.shadowMap.needsUpdate=needsUpdate;gl.autoClear=clear;scene.userData.frameLinearTarget=linearTarget
          scene.userData.frameNatureCached=cachedNature
          scene.userData.frameEnvironmentSlice=slice
          if(clock&&liveTime!==undefined)clock.value=liveTime
        }
        return
      }
    }else {lastGarden=-Infinity;gardenPart=0;gardenRest=false}
    if(!subject||(!state.vaseFocus&&!pour&&stage!=='trim'&&stage!=='observe')){
      if(active)restore()
      gl.render(scene,camera);return
    }
    active=true
    const movingPieces=[...world.pieces].filter(([pieceId,obj])=>!obj.userData.settled||world.active?.id===pieceId)
    const movingKey=movingPieces.map(([pieceId])=>pieceId).join(',')
    const foreground=[subject,world.marker,world.ghost,...movingPieces.map(([,obj])=>obj)]
    const bottleFlowers=state.vaseFocus?state.history.present.flowers.filter(f=>f.location==='vase').flatMap(f=>world.flowers.get(f.id)??[]):[]
    foreground.push(...bottleFlowers)
    if(pour)foreground.push(world.cup,world.stream)
    if(state.scissors&&world.scissors)foreground.push(world.scissors)
    const visible=foreground.filter((o):o is Group|Mesh=>!!o)
    const version=[pour,state.vaseFocus,...bottleFlowers.map(o=>o.children[0]?.uuid),state.ritual?.sceneId,id,state.serial,state.scissors,subject.children[0]?.uuid,
      world.pieces.size,movingKey,world.ghost?.children[0]?.uuid].join('/')
    if(subjectKey!==version){
      for(const [object,mask] of savedLayers)object.layers.mask=mask
      savedLayers.clear()
      scene.traverse(o=>{if(o instanceof Light)enable(o)})
      visible.forEach(o=>o.traverse(enable));subjectKey=version
    }
    const size=Math.min(.45,560/Math.max(width,height))
    const w=Math.max(1,Math.round(width*size)),h=Math.max(1,Math.round(height*size))
    const shotKey=[pour,state.vaseFocus,state.vaseFocus?Math.round((world.vaseViewAngle??0)*9):0,id,state.serial,state.scissors,movingKey,state.ritual?.sceneId,w,h,camera.projectionMatrix.elements[5]].join('/')
    const now=performance.now(),previousTarget=gl.getRenderTarget()
    if(key!==shotKey||!camera.matrixWorld.equals(cameraMatrix)&&now-lastShot>75){
      const hidden=new Set<Object3D>(visible)
      if(world.vase)hidden.add(world.vase)
      if(world.cup&&!state.vaseFocus)hidden.add(world.cup)
      for(const f of state.history.present.flowers)if(f.location==='vase'){
        const root=world.flowers.get(f.id);if(root)hidden.add(root)
      }
      const shown=[...hidden].filter(o=>o.visible)
      try{
        shown.forEach(o=>o.visible=false)
        target.setSize(w,h);gl.setRenderTarget(target);gl.render(scene,camera)
      }finally{
        gl.setRenderTarget(previousTarget);shown.forEach(o=>o.visible=true)
      }
      const radius=Math.max(4,Math.min(9,height*.010))
      material.uniforms.stepUV.value.set(radius/width,radius/height)
      cameraMatrix.copy(camera.matrixWorld);key=shotKey;lastShot=now
    }
    const mask=camera.layers.mask,background=scene.background,clear=gl.autoClear
    try{
      if(pour)scene.add(pourBackdrop)
      else {gl.render(quad,camera2d);gl.clearDepth();gl.autoClear=false}
      camera.layers.set(focusLayer);scene.background=null
      gl.render(scene,camera)
    }finally{
      if(pour)pourBackdrop.removeFromParent()
      camera.layers.mask=mask;scene.background=background;gl.autoClear=clear
    }
  }
  return {draw,dispose(){restore();deskDepthMaterial.dispose();deskDepthMeshes.clear();creekDepth?.dispose();target.dispose();garden.dispose();nextGarden.dispose();plane.dispose();material.dispose()}}
}
export function FlowerFocus({world}:{world:CoreWorld}){
  const gl=useThree(s=>s.gl),view=useMemo(()=>createFocusView(gl),[gl])
  useEffect(()=>()=>view.dispose(),[view])
  useFrame(({scene,camera,size})=>view.draw(scene,camera,world,size.width,size.height),1)
  return null
}
