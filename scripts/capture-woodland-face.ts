import { DepthTexture, GLSL3, Scene, Mesh, OrthographicCamera, PlaneGeometry, DoubleSide, Vector3, WebGLRenderTarget, ShaderMaterial, NearestFilter } from 'three'
import {selectWoodlandDistance} from '../src/scene/woodland-distance'
const faces=[[1,0,0,0,1,0],[-1,0,0,0,1,0],[0,1,0,0,0,1],[0,-1,0,0,0,-1],[0,0,1,0,1,0],[0,0,-1,0,1,0]]
export function capture(){
  const a=(window as any).__coreInspect,scene=a.scene,gl=a.renderer
  const nature=scene.getObjectByName('nature_environment')
  if(!nature?.getObjectByName('environment_'+a.read().ritual.sceneId)||gl.getContext().isContextLost())throw Error('场景或 WebGL 上下文未就绪')
  const outdoor=new Set();nature.traverse((o:any)=>outdoor.add(o))
  scene.traverse((o:any)=>{if((o.isMesh||o.isPoints||o.isLine)&&!outdoor.has(o))o.visible=false})
  selectWoodlandDistance(nature,true,a.read().ritual.sceneId==='bamboo')
  scene.background=null;gl.setClearColor(0,0)
  const pixels=512,grid=76,near=.12,far=100
  gl.setPixelRatio(1);gl.setSize(pixels,pixels,false)
  const camera=a.camera.clone();camera.position.set(0,1.47212016,1.14147949);camera.fov=90;camera.aspect=1;camera.near=near;camera.far=far;camera.updateProjectionMatrix()
  const small=new WebGLRenderTarget(grid+1,grid+1,{minFilter:NearestFilter,magFilter:NearestFilter})
  const mat=new ShaderMaterial({side:DoubleSide,toneMapped:false,
    vertexShader:`varying float metres;void main(){
      vec4 p=vec4(position,1.);
      #ifdef USE_INSTANCING
        p=instanceMatrix*p;
      #endif
      p=modelViewMatrix*p;metres=-p.z;gl_Position=projectionMatrix*p;
    }`,fragmentShader:`varying float metres;void main(){
      float cm=floor(clamp(metres,0.,100.)*100.+.5);
      gl_FragColor=vec4(mod(cm,256.)/255.,floor(cm/256.)/255.,0.,1.);
    }`})
  // Read the actual filtered canopy depth. PCF exposes a comparison sampler, so
  // binary-search its reference rather than decoding a colour image of the shadow.
  const sun=scene.children.find((o:any)=>o.isDirectionalLight&&o.castShadow)
  if(!sun)throw Error('找不到林间主光')
  scene.traverse((light:any)=>{if(light.isLight&&light.castShadow&&light.shadow)light.shadow.needsUpdate=true})
  gl.shadowMap.needsUpdate=true;gl.setRenderTarget(null);gl.render(scene,a.camera)
  const side=768
  gl.setSize(side,side,false)
  const copyShadow=new ShaderMaterial({glslVersion:GLSL3,toneMapped:false,
    uniforms:{shadowDepth:{value:sun.shadow.map.depthTexture}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform highp sampler2DShadow shadowDepth;out vec4 stored;
    void main(){vec2 uv=gl_FragCoord.xy/${side}.;float lo=0.,hi=1.;
      for(int i=0;i<16;i++){float mid=(lo+hi)*.5;if(texture(shadowDepth,vec3(uv,mid))>.5)lo=mid;else hi=mid;}
      float q=floor(.5+65535.*(lo+hi)*.5);stored=vec4(floor(q/256.)/255.,mod(q,256.)/255.,0.,1.);
    }`})
  const pass=new Scene(),screen=new Mesh(new PlaneGeometry(2,2),copyShadow),ortho=new OrthographicCamera(-1,1,1,-1,.1,2)
  ortho.position.z=1;pass.add(screen);gl.render(pass,ortho)
  const shadow=gl.domElement.toDataURL('image/png').split(',')[1]
  copyShadow.dispose();screen.geometry.dispose();gl.setSize(pixels,pixels,false)
  // Sample the depth produced by the actual alpha-tested leaf, rock and horizon
  // materials. A generic override also covers the transparent parts of every leaf card.
  const target=new WebGLRenderTarget(pixels,pixels)
  target.depthTexture=new DepthTexture(pixels,pixels)
  const readDepth=new ShaderMaterial({toneMapped:false,uniforms:{sourceDepth:{value:target.depthTexture}},
    vertexShader:'varying vec2 texel;void main(){texel=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D sourceDepth;varying vec2 texel;void main(){
      float depth=texture2D(sourceDepth,texel).r;
      float cm=depth>=1.?0.:floor(.5+100.*${near}*${far}./(${far}.-depth*(${far}.-${near})));
      gl_FragColor=vec4(mod(cm,256.)/255.,floor(cm/256.)/255.,0.,1.);
    }`})
  const depthScene=new Scene(),quad=new Mesh(new PlaneGeometry(2,2),readDepth)
  depthScene.add(quad)
  const result=[]
  for(const f of faces){
    const forward=f[2]===-1
    const bambooFront=forward&&a.read().ritual.sceneId==='bamboo'
    const bamboo=a.read().ritual.sceneId==='bamboo'
    const colourSize=bambooFront?2048:bamboo?(f[1]===-1?512:f[1]===1?768:1280):forward?960:pixels
    // Matching pixel centres are essential: a coarser nearest-depth image
    // punched square sky holes through the separately filtered leaf silhouettes.
    const depthSize=colourSize
    gl.setSize(colourSize,colourSize,false);target.setSize(depthSize,depthSize)
    camera.up.set(f[3],f[4],f[5]);camera.lookAt(new Vector3(f[0],f[1],f[2]).add(camera.position));camera.updateMatrixWorld()
    gl.setRenderTarget(null);gl.render(scene,camera)
    const color=gl.domElement.toDataURL('image/webp',.87).split(',')[1]
    gl.setRenderTarget(target);gl.render(scene,camera)
    gl.setRenderTarget(null);gl.setSize(depthSize,depthSize,false);gl.render(depthScene,ortho)
    const occlusion=gl.domElement.toDataURL('image/png').split(',')[1]
    scene.overrideMaterial=mat;camera.fov=2*Math.atan((grid+1)/grid)*180/Math.PI;camera.updateProjectionMatrix()
    gl.setRenderTarget(small);gl.render(scene,camera)
    scene.overrideMaterial=null;camera.fov=90;camera.updateProjectionMatrix()
    const raw=new Uint8Array((grid+1)**2*4);gl.readRenderTargetPixels(small,0,0,grid+1,grid+1,raw)
    const depth=new Uint8Array((grid+1)**2*2)
    for(let i=0;i<depth.length/2;i++){depth[i*2]=raw[i*4];depth[i*2+1]=raw[i*4+1]}
    result.push({color,occlusion,depth:btoa(String.fromCharCode(...depth))})
  }
  gl.setRenderTarget(null);target.dispose();readDepth.dispose();quad.geometry.dispose();small.dispose();mat.dispose();return {grid,origin:camera.position.toArray(),faces:result,shadow}
}
