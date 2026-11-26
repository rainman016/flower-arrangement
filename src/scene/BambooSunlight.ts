import {Euler,Matrix4,PerspectiveCamera,Raycaster,Vector2,Vector3,Vector4} from 'three'
import {deskView} from './core/desk-space'
import type {HeightAt} from './terrain-height'

export type BambooSunlight=ReturnType<typeof bambooSunlight>
const slope=new Vector2(5.7/4.7,9.7/4.7)
const trailTargets=[[.447,.285,.46,.15],[.345,.346,.74,.14],[.438,.406,.77,.13]] as const
const rimTargets=[[.115,.068,-14,1.05,2.0],[.200,.145,-9.0,.66,1.10]] as const

export function bambooWindowLayout(){
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80),ray=new Raycaster()
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  ray.setFromCamera(new Vector2(.080*2-1,1-.058*2),camera)
  const center=ray.ray.at((-18-ray.ray.origin.z)/ray.ray.direction.z,new Vector3())
  return {center,radius:new Vector3(2.15,1.40,4.20),direction:ray.ray.direction.clone(),eye:view.eye}
}

export function bambooWindowOpticalDepth(eye:Vector3,surface:Vector3){
  const {center,radius}=bambooWindowLayout(),from=eye.clone().sub(center).divide(radius),travel=surface.clone().sub(eye)
  const ray=travel.clone().divide(radius),a=ray.lengthSq(),b=from.dot(ray),c=from.lengthSq()-1,disc=b*b-a*c
  if(disc<=0||a<.00001)return 0
  const enter=Math.max(0,(-b-Math.sqrt(disc))/a),leave=Math.min(1,(-b+Math.sqrt(disc))/a)
  if(leave<=enter)return 0
  const middle=from.addScaledVector(ray,(enter+leave)*.5),density=Math.max(0,1-middle.lengthSq())
  return travel.length()*(leave-enter)*density*density
}

// Authoring uses the agreed seated camera once; these positions remain in world
// space during play, capture and look-around. No screen-space light overlay.
export function bambooSunlight(ground:HeightAt){
  const view=deskView(1536,1024),camera=new PerspectiveCamera(view.fov,1.5,.01,80)
  camera.position.copy(view.eye);camera.quaternion.setFromEuler(new Euler(view.pitch,0,0));camera.updateMatrixWorld(true)
  const ray=new Raycaster(),uv=new Vector2(),point=new Vector3()
  const project=(p:Vector3)=>new Vector2(p.x+p.y*slope.x,p.z+p.y*slope.y)
  function floorAt(x:number,y:number){
    ray.setFromCamera(uv.set(x*2-1,1-y*2),camera)
    let near=0,far=40
    for(let i=0;i<24;i++){
      const t=(near+far)*.5;ray.ray.at(t,point)
      if(point.y>ground(point.x,point.z))near=t;else far=t
    }
    return ray.ray.at((near+far)*.5,new Vector3())
  }
  const trail=trailTargets.map(([x,y,rx,rz])=>{
    const world=floorAt(x,y),p=project(world)
    return {screen:[x,y],world:world.toArray(),patch:new Vector4(p.x,p.y,rx,rz)}
  })
  const rims=rimTargets.map(([x,y,z,rx,rz])=>{
    ray.setFromCamera(uv.set(x*2-1,1-y*2),camera)
    const world=ray.ray.at((z-ray.ray.origin.z)/ray.ray.direction.z,new Vector3()),p=project(world)
    return {screen:[x,y],world:world.toArray(),patch:new Vector4(p.x,p.y,rx,rz)}
  })
  // A fixed world light field authored from the agreed view; it never follows
  // the live camera. Only actual bamboo leaf surfaces receive this transmission.
  const leafField=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
  return {trail,rims,slope,window:bambooWindowLayout(),leafField}
}

export function bambooSunEnvelope(layout:BambooSunlight,world:Vector3){
  const p=new Vector2(world.x+world.y*slope.x,world.z+world.y*slope.y)
  return Math.max(...layout.trail.map(({patch})=>{
    const x=p.x-patch.x,z=p.y-patch.y,u=(x*.985+z*.174)/patch.z,v=(-x*.174+z*.985)/patch.w
    return Math.pow(2,-2.1*(u*u+v*v))
  }))
}

export const bambooSunSampling=`
  uniform vec4 bambooSunPatches[3];
  uniform vec4 bambooRimPatches[2];
  uniform vec3 bambooLightWindow;
  uniform vec3 bambooLightRadius;
  uniform mat4 bambooLeafField;
  float bambooLightPatch(vec2 p,vec4 sunArea){
    vec2 d=p-sunArea.xy;
    vec2 q=vec2(dot(d,vec2(.985,.174)),dot(d,vec2(-.174,.985)))/sunArea.zw;
    return exp2(-2.1*dot(q,q));
  }
  float bambooTrailEnvelope(vec2 p){
    float energy=0.;
    for(int i=0;i<3;i++)energy=max(energy,bambooLightPatch(p,bambooSunPatches[i]));
    return energy;
  }
  float bambooRimEnvelope(vec2 p){
    return max(bambooLightPatch(p,bambooRimPatches[0]),bambooLightPatch(p,bambooRimPatches[1]));
  }
  float bambooWindowDepth(vec3 eye,vec3 surface){
    vec3 from=(eye-bambooLightWindow)/bambooLightRadius;
    vec3 travel=surface-eye,ray=travel/bambooLightRadius;
    float a=dot(ray,ray),b=dot(from,ray),c=dot(from,from)-1.,disc=b*b-a*c;
    if(disc<=0.||a<.00001)return 0.;
    float enter=max(0.,(-b-sqrt(disc))/a),leave=min(1.,(-b+sqrt(disc))/a);
    if(leave<=enter)return 0.;
    vec3 middle=from+ray*(enter+leave)*.5;
    float density=max(0.,1.-dot(middle,middle));
    return length(travel)*(leave-enter)*density*density;
  }
`

// The response is added after the soil's wetness/low-canopy attenuation, while
// retaining the existing directional shadow sampler and actual surface normal.
export function bambooSunResponse(shader:{vertexShader:string;fragmentShader:string},ground:boolean,goldenLeaf:boolean,canopyLeaf=false){
  if(!ground&&!goldenLeaf&&!canopyLeaf)return
  if(goldenLeaf||canopyLeaf){
    if(!goldenLeaf){
      // Existing blades carry a stable per-blade wind phase. Reuse it as tissue
      // variation, keeping some thicker/darker leaves inside the same aperture.
      if(!/attribute\s+float\s+_phase\s*;/.test(shader.vertexShader))shader.vertexShader='attribute float _phase;\n'+shader.vertexShader
      shader.vertexShader='varying float bambooSunLeafAge;\n'+shader.vertexShader
        .replace('#include <begin_vertex>','#include <begin_vertex>\nbambooSunLeafAge=.5+.5*sin(_phase*3.73);')
      shader.fragmentShader='varying float bambooSunLeafAge;\n'+shader.fragmentShader
    }
    shader.vertexShader=(goldenLeaf?'attribute float _sunTissue;varying float bambooSunTissue;\n':'')+'varying vec2 bambooSunUv;\n'+shader.vertexShader
      .replace('#include <begin_vertex>','#include <begin_vertex>\nbambooSunUv=uv;'+(goldenLeaf?'\nbambooSunTissue=_sunTissue;':''))
    shader.fragmentShader=(goldenLeaf?'varying float bambooSunTissue;\n':'')+'varying vec2 bambooSunUv;\n'+shader.fragmentShader
  }
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    float localSunVisibility=1.;
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow localSunShade=directionalLightShadows[0];
      localSunVisibility=getShadow(directionalShadowMap[0],localSunShade.shadowMapSize,localSunShade.shadowIntensity,localSunShade.shadowBias,localSunShade.shadowRadius,vDirectionalShadowCoord[0]);
    #endif
    vec3 localSunDirection=normalize(vec3(-5.7,4.7,-9.7));
    ${ground?`float groundFine=texture2D(canopyOpenings,mat2(.92,-.39,.39,.92)*projected*1.13+vec2(.13,.27)).r;
      vec2 edgeWarp=vec2(groundFine-.5,sin(dot(projected,vec2(13.7,9.3)))*.32)*.11;
      edgeWarp.y+=.052*sin(projected.x*7.3+projected.y*1.7);
      float sunShape=bambooTrailEnvelope(projected+edgeWarp);
      float sunCore=smoothstep(.16,.76,sunShape)*mix(.48,1.,smoothstep(.17,.80,groundFine));
      float brightFringe=smoothstep(.17,.29,sunShape)*(1.-smoothstep(.39,.57,sunShape))*smoothstep(.40,.84,groundFine);
      float groundCosine=max(0.,dot(surfaceFacing,localSunDirection));
      vec3 sunlitMineral=diffuseColor.rgb*vec3(10.8,6.4,1.65);
      outgoingLight+=sunlitMineral*(sunCore+.34*brightFringe)*groundCosine*(.12+.88*localSunVisibility);
      // A broad local aperture scatters onto the soil after the narrow direct
      // ray is blocked. Leaf cuts and grain colour remain visible in this term.
      float leafCuts=.10+.90*smoothstep(.24,.78,groundFine);
      float warmBand=smoothstep(.15,.72,sunShape)*leafCuts+.20*brightFringe;
      vec3 apertureDiffuse=diffuseColor.rgb*vec3(5.6,3.8,1.9);
      outgoingLight+=apertureDiffuse*warmBand*(.55+.45*max(0.,surfaceFacing.y));`:''}
    ${goldenLeaf||canopyLeaf?`vec4 leafFieldPoint=bambooLeafField*vec4(woodlandSurface,1.);
      vec2 leafRegion=leafFieldPoint.xy/leafFieldPoint.w*.5+.5;leafRegion.y=1.-leafRegion.y;
      float leafFocus=smoothstep(-.025,.008,leafRegion.x)*(1.-smoothstep(.315,.355,leafRegion.x))
        *smoothstep(-.035,.012,leafRegion.y)*(1.-smoothstep(.184,.215,leafRegion.y))
        *smoothstep(1.7,2.8,leafFieldPoint.w)*(1.-smoothstep(27.,33.,leafFieldPoint.w));
      // A finite angular opening in the authored grove, fixed when the player turns.
      // Branches on either side of the sun retain their shaded green faces.
      vec2 apertureOffset=(leafRegion-vec2(.078,.052))/vec2(.151,.172);
      leafFocus*=exp2(-.91*dot(apertureOffset,apertureOffset));
      float acrossBlade=abs(bambooSunUv.x-.5)*2.;
      float visibleMidrib=1.-smoothstep(.018,.085,acrossBlade);
      float belly=${goldenLeaf?'bambooSunTissue':'(.68+.25*smoothstep(.06,.82,acrossBlade))*mix(.14,1.,smoothstep(.14,.36,bambooSunLeafAge))'};
      float throughBlade=abs(dot(surfaceFacing,localSunDirection));
      float towardSource=pow(max(0.,dot(normalize(woodlandSurface-cameraPosition),localSunDirection)),3.);
      vec3 tissueFilter=diffuseColor.rgb*vec3(7.5,4.3,.75);
      outgoingLight+=tissueFilter*(.22+.78*throughBlade)*(.35+.65*towardSource)
        *(.30+.70*belly)*localSunVisibility*leafFocus;
      vec3 toAperture=normalize(bambooLightWindow-woodlandSurface);
      float skyWrap=.68+.32*abs(dot(surfaceFacing,toAperture));
      float softTransmission=(.30+.70*belly)*(.65+.35*towardSource)*skyWrap;
      // Thin tissue receives the nearby broad aperture even when the narrow
      // directional ray is blocked. Pigment still follows each real blade's
      // albedo; a spectral filter avoids multiplying its dark green twice.
      float leafPigment=dot(diffuseColor.rgb,vec3(.25,.65,.10));
      float bladeAlignment=.28+.72*smoothstep(.12,.84,throughBlade);
      float sprayLight=.5+.5*sin(woodlandSurface.x*2.5+woodlandSurface.z*1.6+sin(woodlandSurface.y*2.7));
      vec3 transmittedPigment=vec3(1.65,1.05,.014)*(.055+.85*leafPigment);
      outgoingLight+=transmittedPigment*6.4*softTransmission*bladeAlignment*(.55+.45*sprayLight)
        *(.72+.28*localSunVisibility)*(1.-.18*visibleMidrib)*leafFocus;
      // Short wavelengths are strongly absorbed through the blade's thicker belly.
      outgoingLight*=mix(vec3(1.),vec3(1.035,.94,.20),clamp(leafFocus*(.54+.46*belly),0.,1.));`:''}
    #include <opaque_fragment>`)
}
