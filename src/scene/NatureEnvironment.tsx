import {selectWoodlandDistance} from './woodland-distance'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ShaderChunk } from 'three'
import { Color, DoubleSide, Frustum, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Material, Matrix4, Mesh, MeshDepthMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RGBADepthPacking, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, type Camera } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SceneId } from '../game/types'
import type { Texture } from 'three'
import {streamSurface} from './StreamSurface'
import {carveStreamBed,detailForestFloor,distantLeafGeometry} from './ForestFloor'
import {canopyLight,filterWoodlandSun} from './CanopyLight'
import {terrainSampler,type HeightAt} from './terrain-height'
import {woodlandSoil,woodlandSoilSampling} from './WoodlandSoil'
import {creekShingle,creekBankHeight,bankSampling,dryBankSurface,dryBankNormal} from './CreekBank'
import {deepenCreekRun} from './CreekShallows'
import {woodlandLitter} from './WoodlandLitter'
import {shapeWoodlandGround} from './WoodlandGroundShape'
import {woodlandSkyView} from './WoodlandSkyView'
import {woodlandHorizon} from './WoodlandHorizon'
import {bambooCulmLOD,bambooLeafLOD,bambooMiddleGrove,bambooOuterGround,continueBambooGround,keepBambooPlant} from './BambooDepth'
import {lowWoodlandQuality} from './render-quality'
import {bambooCanopy} from './BambooCanopy'
import {bambooSurround,seatBambooGroves,seatBambooRocks} from './BambooSurround'
import {bambooBanks} from './BambooBanks'
import {bambooSunlight,bambooSunSampling,bambooSunResponse,type BambooSunlight} from './BambooSunlight'

// Analytic slopes have a fixed size in world space. Sampling derivatives of
// fine colour texels instead produced a screen-aligned 2x2 pattern at the desk.
const reliefNormal=`
  float bedHash(vec3 p) {
    p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z);
  }
  vec3 bedGradient(vec3 p) {
    vec3 i=floor(p), f=fract(p), w=f*f*(3.-2.*f);
    float a=bedHash(i),b=bedHash(i+vec3(1,0,0)),c=bedHash(i+vec3(0,1,0)),d=bedHash(i+vec3(1,1,0));
    float e=bedHash(i+vec3(0,0,1)),g=bedHash(i+vec3(1,0,1)),h=bedHash(i+vec3(0,1,1)),j=bedHash(i+vec3(1,1,1));
    return 6.*f*(1.-f)*vec3(mix(mix(b-a,d-c,w.y),mix(g-e,j-h,w.y),w.z),
      mix(mix(c-a,d-b,w.x),mix(h-e,j-g,w.x),w.z),
      mix(mix(e-a,g-b,w.x),mix(h-c,j-d,w.x),w.y));
  }
  vec3 bedNormal(vec3 n, vec3 worldSlope) {
    vec3 slope=mat3(viewMatrix)*worldSlope;
    return normalize(n-(slope-n*dot(n,slope)));
  }`

type Time = {value:number}
const windDeclarations=`uniform float natureTime;
uniform vec3 natureWindDirection;
attribute float _bend;
attribute float _phase;
vec3 natureWind(vec3 world, float flexibility, float phase){
  float gust=.6+.4*sin(natureTime*.37+world.x*.14+world.z*.12);
  float sway=sin(natureTime*.82+phase*.32)+.28*sin(natureTime*1.43+phase);
  vec3 offset=natureWindDirection*flexibility*gust*sway;
  return offset;
}`

function addWind(material:Material,time:Time,wind:Vector3,leaves:boolean,rain:boolean,tipWeighted=false){
  material.onBeforeCompile=shader=>{
    shader.uniforms.natureTime=time
    shader.uniforms.natureWindDirection={value:wind}
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+windDeclarations+(tipWeighted?'\nattribute float _leaf_tip;':''))
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        mat4 natureTransform=modelMatrix;
        #ifdef USE_INSTANCING
        natureTransform=modelMatrix*instanceMatrix;
        #endif
        vec3 natureWorld=(natureTransform*vec4(transformed,1.)).xyz;
        vec3 natureOffset=natureWind(natureWorld,_bend,_phase+natureTransform[3].x*.27+natureTransform[3].z*.38);
        ${leaves?`float flutter=${tipWeighted?'_leaf_tip*_leaf_tip':'1.'};
        natureOffset.y+=sin(natureTime*3.8+dot(natureWorld.xz,vec2(5.7,3.1)))*.013*min(1.,_bend*5.)*flutter;
        natureOffset.x+=sin(natureTime*2.4+natureWorld.z*3.5)*.018*min(1.,_bend*4.)*flutter;`:''}
        ${rain&&leaves?'natureOffset.y-=pow(max(0.,sin(natureTime*2.1+_phase+natureWorld.x*2.)),16.)*.023*min(1.,_bend*5.);':''}
        transformed+=inverse(mat3(natureTransform))*natureOffset;`)
  }
  material.customProgramCacheKey=()=>`nature-wind-${leaves}-${rain}-${tipWeighted}`
  material.needsUpdate=true
}

// Integrate light inside the clearings along the actual camera-to-surface segment.
// The paths stay fixed between the trees when the seated viewer turns their head.
function addClearingLight(material:Material,strength:number,bamboo:boolean,sunlight?:BambooSunlight,leaf=false,goldenLeaf=false,ground=false,canopyLeaf=false){
  const compile=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey()
  material.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer)
    shader.vertexShader='varying vec3 woodlandSurface;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec4 woodlandVertex=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      woodlandVertex=instanceMatrix*woodlandVertex;
      #endif
      woodlandSurface=(modelMatrix*woodlandVertex).xyz;`)
    if(bamboo){
      const layout=sunlight??bambooSunlight(()=>0)
      shader.uniforms.bambooSunPatches={value:layout.trail.map(p=>p.patch)}
      shader.uniforms.bambooRimPatches={value:layout.rims.map(p=>p.patch)}
      shader.uniforms.bambooLightWindow={value:layout.window.center}
      shader.uniforms.bambooLightRadius={value:layout.window.radius}
      shader.uniforms.bambooLeafField={value:layout.leafField}
      // A line integral stopped at the first opaque surface keeps foreground culms in silhouette.
      // Composite nearby scattering after the distant forest haze. Both use the same canopy openings.
      const shaftAxes=`        ${bambooSunSampling}
        const vec2 sunlightSlope=vec2(5.7,9.7)/4.7;
        #define mainGap bambooSunPatches[1].xy
        #define sideGap bambooSunPatches[2].xy
`
      const shaftIntegral=`        float litAir(vec3 eye,vec3 travel,vec2 center,float radius){
          vec2 start=eye.xz+eye.y*sunlightSlope-center;
          vec2 span=travel.xz+travel.y*sunlightSlope;
          float lengthInPlane=max(.001,length(span));
          vec2 axis=span/lengthInPlane;
          float along=-dot(start,axis);
          vec2 nearest=(start+axis*along)/radius;
          vec2 ends=vec2(-along,lengthInPlane-along)/radius;
          vec2 integral=ends*inversesqrt(vec2(1.)+ends*ends);
          float inside=max(0.,.5*(integral.y-integral.x));
          float h=eye.y+travel.y*clamp(along/lengthInPlane,0.,1.);
          float depth=radius*length(travel)/lengthInPlane;
          return exp2(-1.75*dot(nearest,nearest))*inside*min(4.,depth)
            *smoothstep(-.14,.30,h)*(1.-smoothstep(4.,6.4,h));
        }
`
      const fineShafts=`1.79*litAir(cameraPosition,travel,mainGap,.245)
            +.67*litAir(cameraPosition,travel,mainGap+vec2(-.11,.09),.052)
            +.78*litAir(cameraPosition,travel,mainGap+vec2(.12,-.08),.064)
            +.84*litAir(cameraPosition,travel,mainGap+vec2(-.22,.06),.071)
            +2.74*litAir(cameraPosition,travel,sideGap,.127)
            +.33*litAir(cameraPosition,travel,mainGap+vec2(.08,-.21),.48)`
      if(lowWoodlandQuality){
        // Across a folded leaf or the subdivided earth the accumulated air changes
        // slowly. Only the opening and the sharp shadow need per-pixel samples.
        shader.vertexShader='varying float shaftAir;\n'+shaftAxes+shaftIntegral+shader.vertexShader
          .replace('woodlandSurface=(modelMatrix*woodlandVertex).xyz;',`woodlandSurface=(modelMatrix*woodlandVertex).xyz;
            vec3 toSurface=woodlandSurface-cameraPosition;
            shaftAir=.94*litAir(cameraPosition,toSurface,mainGap,.14)+1.24*litAir(cameraPosition,toSurface,sideGap,.085);`)
      }
      shader.fragmentShader=(lowWoodlandQuality?'varying float shaftAir;\n':'')+`varying vec3 woodlandSurface;
        ${shaftAxes}
        float opening(vec2 p,vec2 center,float radius){
          vec2 d=(p-center)/radius;
          return exp2(-1.75*dot(d,d));
        }
        float sunOnPath(vec2 p,sampler2D openingsMap){
          vec2 branch=mat2(.82,-.57,.57,.82)*p;
          float highLeaves=texture2D(openingsMap,branch*.27+vec2(.39,.16)).r;
          float lowLeaves=texture2D(openingsMap,mat2(.61,.79,-.79,.61)*p*.66+vec2(.16,.78)).r;
          vec2 offset=vec2(highLeaves-.48,lowLeaves-.50)*vec2(.16,.10);
          float centre=bambooTrailEnvelope(p+offset);
          float shafts=smoothstep(.20,.82,highLeaves*.43+lowLeaves*.57);
          float fineLeaves=texture2D(openingsMap,mat2(.92,-.39,.39,.92)*p*1.13+vec2(.13,.27)).r;
          float brokenEdge=smoothstep(.14,.77,fineLeaves*.62+highLeaves*.38);
          float rockGap=opening((p-vec2(2.12,-3.34))*vec2(1.08,.80),vec2(0.),.38);
          float rimWindow=bambooRimEnvelope(p);
          return centre*mix(.32,1.55,shafts)*mix(.40,1.,brokenEdge)
            +.31*rockGap*(.42+.58*highLeaves)+.70*rimWindow*shafts;
        }
        ${lowWoodlandQuality?'':shaftIntegral}
      \n`+shader.fragmentShader
        // Apply the opening before Three's directional shadow test, including leaf and culm occlusion.
        .replace('#include <lights_fragment_begin>',`vec2 projected=woodlandSurface.xz+woodlandSurface.y*sunlightSlope;
          float pathSunlight=sunOnPath(projected,canopyOpenings);
          `+ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
            'getDirectionalLightInfo( directionalLight, directLight );\n directLight.color+=vec3(8.6,5.8,2.25)*pathSunlight;'))
        .replace('#include <opaque_fragment>',`
          // Finite volume behind the near bamboo: integrate only the segment
          // before the visible surface, so foreground culms occlude the window.
          float windowDepth=bambooWindowDepth(cameraPosition,woodlandSurface);
          float windowOpacity=min(.78,1.-exp(-windowDepth*.70));
          outgoingLight=mix(outgoingLight,vec3(1.98,1.35,.115),windowOpacity);
          // Warm bounced light on the two banks below the sunlit grove opening.
          // World-space falloff retains parallax, occlusion and the bark/leaf albedo.
          vec2 nearShoulder=(woodlandSurface.xz-vec2(-3.7,-7.6))/vec2(1.15,2.6);
          vec2 farShoulder=(woodlandSurface.xz-vec2(-8.3,-17.5))/vec2(2.60,5.0);
          float openingBounce=exp2(-1.55*dot(nearShoulder,nearShoulder))
            +1.32*exp2(-1.55*dot(farShoulder,farShoulder));
          vec3 surfaceFacing=inverseTransformDirection(normal,viewMatrix);
          float lightWrap=.36+.64*max(0.,dot(surfaceFacing,normalize(vec3(-.43,.62,-.66))));
          float greenBounce=smoothstep(-.05,.75,woodlandSurface.y)+.14;
          outgoingLight+=diffuseColor.rgb*vec3(.62,.43,.12)*openingBounce*lightWrap*greenBounce;
          ${leaf?`float rimVisibility=1.;
            #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
              DirectionalLightShadow rimShade=directionalLightShadows[0];
              rimVisibility=getShadow(directionalShadowMap[0],rimShade.shadowMapSize,rimShade.shadowIntensity,rimShade.shadowBias,rimShade.shadowRadius,vDirectionalShadowCoord[0]);
            #endif
            float tissueFacing=max(0.,dot(-surfaceFacing,normalize(vec3(-5.7,4.7,-9.7))));
            float thinRim=.36+.64*pow(1.-abs(dot(surfaceFacing,normalize(cameraPosition-woodlandSurface))),1.7);
            float rimWindow=bambooRimEnvelope(projected);
            outgoingLight+=diffuseColor.rgb*vec3(3.4,2.2,.48)*rimWindow*tissueFacing*thinRim*rimVisibility*leafOpening(woodlandSurface);`:''}
          #include <opaque_fragment>`)
        .replace('#include <fog_fragment>',`#include <fog_fragment>
          vec3 travel=woodlandSurface-cameraPosition;
          float air=${lowWoodlandQuality?'shaftAir':fineShafts};
          float breaks=leafOpening(vec3(projected.x,0.,projected.y));
          float groundHit=smoothstep(.21,.75,inverseTransformDirection(normal,viewMatrix).y)
            *max(opening(projected,mainGap,.57),opening(projected,sideGap,.36));
          air*=mix(1.,.22+.68*min(1.,pathSunlight),groundHit);
          float shaftGaps=texture2D(canopyOpenings,mat2(.92,-.39,.39,.92)*projected*.93+vec2(.13,.27)).r;
          float opacity=min(.045,1.-exp(-air*(.033+.022*breaks+.028*smoothstep(.23,.88,shaftGaps))));
          gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.98,.89,.69),opacity);
          // Forward-scattered sunlight accumulates only up to the first visible surface.
          vec3 rayDirection=normalize(travel);
          float phase=pow(max(0.,dot(rayDirection,normalize(vec3(-5.7,4.7,-9.7)))),12.);
          float sunHaze=phase*(1.-exp(-max(0.,length(travel)-2.5)*.065));
          gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.14,.91,.53),.08*sunHaze);
          // The local forest window is integrated in linear light above, before
          // tone mapping, rather than painting a pale wash over opaque trunks.
          `)
      bambooSunResponse(shader,ground,goldenLeaf,canopyLeaf)
      return
    }
    shader.fragmentShader=`varying vec3 woodlandSurface;
      float clearingLight(vec3 start,vec3 ray,vec2 floorCenter,float width){
        vec2 tilt=vec2(.93,1.95);
        vec2 from=start.xz+start.y*tilt-floorCenter;
        vec2 span=ray.xz+ray.y*tilt;
        float t=clamp(-dot(from,span)/max(.0001,dot(span,span)),0.,1.);
        vec2 nearest=from+span*t;
        float altitude=start.y+ray.y*t;
        float along=min(length(ray),width*length(ray)/max(.12,length(span)));
        return exp2(-2.*dot(nearest,nearest)/(width*width))*min(2.5,along)
          *smoothstep(-.10,.55,altitude)*(1.-smoothstep(5.,7.,altitude));
      }\n`+shader.fragmentShader.replace('#include <opaque_fragment>',`vec3 woodlandRay=woodlandSurface-cameraPosition;
        float sunAir=clearingLight(cameraPosition,woodlandRay,vec2(-.88,-2.68),.39)*1.21
          +clearingLight(cameraPosition,woodlandRay,vec2(-1.11,-2.48),.14)*1.17
          +clearingLight(cameraPosition,woodlandRay,vec2(-1.05,-3.62),.29)*1.24
          +clearingLight(cameraPosition,woodlandRay,vec2(-.68,-4.02),.14)*1.36
          +clearingLight(cameraPosition,woodlandRay,vec2(-1.77,-7.3),.32)
          +clearingLight(cameraPosition,woodlandRay,vec2(-1.19,-7.72),.19)*.68;

        outgoingLight+=vec3(.39,.323,.192)*sunAir*smoothstep(2.5,5.6,length(woodlandRay))*${strength.toFixed(2)};
        #include <opaque_fragment>`)
  }
  material.customProgramCacheKey=()=>key+'-clearing-'+strength+'-'+bamboo+(bamboo?'-sun-v2r4-'+leaf+'-'+goldenLeaf+'-'+ground+'-'+canopyLeaf:'')
}


function Rain({time,eave,span,heightAt}:{time:Time;eave:Vector3;span:number;heightAt:HeightAt}){
  const resources=useMemo(()=>{
    const base=new PlaneGeometry(1,1),geometry=new InstancedBufferGeometry()
    geometry.index=base.index;geometry.attributes=base.attributes
    const origins:number[]=[]
    // Deterministic distribution; the physical shelter stays dry. Extra drops fall off the eave.
    for(let i=0;i<650;i++){
      const x=((i*.61803398875)%1-.5)*24,z=((i*.41421356237)%1-.5)*24
      if(Math.abs(x-eave.x)<span&&z>eave.z-.12&&z<2.2)continue
      origins.push(x,(i*.754877666)%1*6,z,6)
    }
    for(let i=0;i<52;i++)origins.push(eave.x-span+i/51*span*2,(i*.723)%1*eave.y,eave.z,eave.y)
    for(let i=0;i<780;i++){
      const z=eave.z-.15-((i*.7320508)%1)*8.9,x=((i*.41421356)%1-.5)*12
      origins.push(x,(i*.61803399)%1*4.3,z,4.3)
    }
    geometry.setAttribute('origin',new InstancedBufferAttribute(new Float32Array(origins),4));geometry.instanceCount=origins.length/4
    const ground=Array.from({length:geometry.instanceCount},(_,i)=>Math.max(-.096,heightAt(origins[i*4],origins[i*4+2])))
    geometry.setAttribute('groundHeight',new InstancedBufferAttribute(new Float32Array(ground),1))
    const material=new ShaderMaterial({transparent:true,depthWrite:false,fog:true,uniforms:{...UniformsUtils.clone(UniformsLib.fog),natureTime:time},
      vertexShader:`attribute vec4 origin;attribute float groundHeight;uniform float natureTime;varying vec2 rainUv;varying float distanceFade;
      #include <fog_pars_vertex>
      void main(){rainUv=uv;vec3 p=origin.xyz;p.y=groundHeight+mod(origin.y-natureTime*4.6,max(.1,origin.w-groundHeight));p.x+=(p.y-groundHeight)*.025;
      vec4 mvPosition=modelViewMatrix*vec4(p,1.);distanceFade=1.-smoothstep(8.,17.,length(mvPosition.xyz));
      float streak=.13+.085*fract(origin.x*12.71);
      mvPosition.xyz+=(modelViewMatrix*vec4(0.,position.y*streak,0.,0.)).xyz;mvPosition.x+=position.x*.0075;
      gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
      fragmentShader:`varying vec2 rainUv;varying float distanceFade;
      #include <fog_pars_fragment>
      void main(){float edge=sin(rainUv.y*3.14159);gl_FragColor=vec4(.68,.77,.78,.38*edge*distanceFade);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      }`})
    return {geometry,material}
  },[time,eave,span,heightAt])
  useEffect(()=>()=>{resources.geometry.dispose();resources.material.dispose()},[resources])
  return <mesh name="rain_and_eave_drops" geometry={resources.geometry} material={resources.material} frustumCulled={false} raycast={()=>null}/>
}

function RainRipples({time,eave,span,heightAt}:{time:Time;eave:Vector3;span:number;heightAt:HeightAt}){
  const resources=useMemo(()=>{
    const base=new PlaneGeometry(1,1),geometry=new InstancedBufferGeometry()
    geometry.index=base.index;geometry.attributes=base.attributes
    const origins:number[]=[],slopes:number[]=[]
    for(let i=0;i<180&&origins.length<70*4;i++){
      const alongEave=i%3===0
      const x=eave.x+((i*.6180339)%1-.5)*span*2
      const z=eave.z+(alongEave?((i*.4142136)%1-.5)*.28:-.1-((i*.4142136)%1)*7)
      const y=heightAt(x,z)
      if(y<-.091||y>(alongEave?.15:-.025))continue
      const sx=(heightAt(x+.024,z)-heightAt(x-.024,z))/.048
      const sz=(heightAt(x,z+.024)-heightAt(x,z-.024))/.048
      if(Math.hypot(sx,sz)>.42)continue
      origins.push(x,y+.0028,z,i*.723);slopes.push(sx,sz)
    }
    geometry.setAttribute('origin',new InstancedBufferAttribute(new Float32Array(origins),4));geometry.instanceCount=origins.length/4
    geometry.setAttribute('bankSlope',new InstancedBufferAttribute(new Float32Array(slopes),2))
    const material=new ShaderMaterial({transparent:true,depthWrite:false,side:DoubleSide,fog:true,uniforms:{...UniformsUtils.clone(UniformsLib.fog),natureTime:time},
      vertexShader:`attribute vec4 origin;attribute vec2 bankSlope;uniform float natureTime;varying vec2 rippleUv;varying float life;
      #include <fog_pars_vertex>
      void main(){rippleUv=uv;life=fract(natureTime*.68+origin.w);
      vec3 p=origin.xyz+vec3(position.x,dot(bankSlope,position.xy),position.y)*(.012+life*.132);
      vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
      fragmentShader:`varying vec2 rippleUv;varying float life;
      #include <fog_pars_fragment>
      void main(){float r=length(rippleUv-.5);float ring=1.-smoothstep(0.,.025,abs(r-.41));
      gl_FragColor=vec4(.45,.55,.53,ring*(1.-life)*.32);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
      }`})
    return {geometry,material}
  },[time,eave,span,heightAt])
  useEffect(()=>()=>{resources.geometry.dispose();resources.material.dispose()},[resources])
  return <mesh name="rain_ground_ripples" geometry={resources.geometry} material={resources.material} frustumCulled={false} raycast={()=>null}/>
}

export default function NatureEnvironment({model,kit,sceneId,floor,bankAtlas,distance}:{model:GLTF;kit:GLTF;sceneId:SceneId;floor:Texture;bankAtlas?:Texture;distance?:import('three').Group}){
  const {gl,camera,invalidate}=useThree(),time=useMemo<Time>(()=>({value:0}),[model]),active=useRef(false)
  const nature=useMemo(()=>{
    if(bankAtlas)bankAtlas.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy())
    const root=model.scene.clone(true),owned:Material[]=[],instancesOwned:InstancedMesh[]=[]
    const composed=Boolean(root.getObjectByName('environment_'+sceneId)?.userData.referenceComposition)
    const openBambooPath=sceneId==='bamboo'&&root.getObjectByName('environment_bamboo')?.userData.clearBambooPath===true
    root.name='nature_environment';root.userData.natureClock=time;root.userData.renderedFrames=0
    root.updateMatrixWorld(true);kit.scene.updateMatrixWorld(true)
    const anchor=(name:string)=>{
      const object=root.getObjectByName(name)
      if(!object)throw Error('缺少自然场景锚点 '+name)
      return object.getWorldPosition(new Vector3())
    }
    const wind=anchor('wind_direction').normalize().multiplyScalar(.1235)
    const eave=sceneId==='rain'?anchor('eave_drip_line'):new Vector3()
    const terrain=root.getObjectByName('terrain') as Mesh,channel=root.getObjectByName('creek_surface')
    const importedGround=composed||sceneId==='rain'?terrainSampler(terrain):null
    const bambooGround=openBambooPath&&importedGround?continueBambooGround(root,terrain,importedGround):null
    const originalGround=bambooGround?.at??importedGround
    const carved=composed&&sceneId==='creek'&&channel instanceof Mesh?carveStreamBed(terrain,channel):null
    const shaped=composed&&originalGround?shapeWoodlandGround(root,terrain,originalGround,carved?terrainSampler(terrain):originalGround,sceneId):null
    if(root.getObjectByName('environment_rain')?.userData.openRainClearing){
      // The enlarged shore uses the continuous heightfield for both clay and litter.
      const formerBankSkin=root.getObjectByName('exposed_wet_clay')
      if(formerBankSkin)formerBankSkin.visible=false
    }
    const heightAt=shaped?.at??originalGround
    if(openBambooPath&&heightAt)bambooMiddleGrove(root,heightAt)
    if(openBambooPath&&heightAt)bambooSurround(root,heightAt)
    const releaseBambooOuter=openBambooPath&&heightAt?bambooOuterGround(root,heightAt,floor):null
    const bankMesh=root.getObjectByName('root_bank_soil')
    const bankHeight=bankAtlas&&heightAt&&bankMesh instanceof Mesh?creekBankHeight(bankMesh,heightAt,channel instanceof Mesh?channel:undefined):null
    const grass=composed&&heightAt?detailForestFloor(root,kit.scene,heightAt,sceneId,bankHeight):null
    if(openBambooPath&&heightAt)seatBambooRocks(root,kit.scene,heightAt)
    if(openBambooPath&&heightAt)seatBambooGroves(root,heightAt)
    if(sceneId==='creek'&&bankMesh instanceof Mesh&&channel instanceof Mesh)deepenCreekRun(bankMesh,terrain,channel,root)
    const bambooSun=sceneId==='bamboo'&&heightAt?bambooSunlight(heightAt):undefined
    const bambooBank=openBambooPath&&heightAt?bambooBanks(root,heightAt):null
    const releaseBambooCanopy=openBambooPath&&heightAt?bambooCanopy(root,heightAt):null
    const soilShade=composed&&heightAt?woodlandSoil(root,kit.scene,sceneId==='creek'?bankHeight??heightAt:heightAt):null
    const releaseLitter=soilShade&&heightAt?woodlandLitter(root,bankHeight??heightAt,soilShade,sceneId):null
    const skyView=composed&&heightAt?woodlandSkyView(root,kit.scene,heightAt):null
    if(composed&&sceneId!=='bamboo')root.traverse(o=>{
      if(String(o.userData.prototype??'').startsWith('bryophyte_')){o.scale.y*=.37;o.updateMatrixWorld(true)}
    })
    const waterLevel=sceneId==='creek'?anchor('water_level'):new Vector3()
    const groves=root.children.flatMap(child=>[child,...child.children]).filter(child=>child.userData.gardenPrototype)
    if(grass)groves.push(grass.template)
    const kinds=['tree','fern','rock','ledge','rootwood',...groves.map(template=>template.userData.gardenPrototype as string)]
    const farLeaves=new Map<Mesh['geometry'],Mesh['geometry']>()
    const cameraPlanes=new WeakMap<Camera,{clip:Matrix4;planes:Frustum}>(),clip=new Matrix4()
    function planesFor(view:Camera){
      let data=cameraPlanes.get(view)
      clip.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse)
      if(!data){data={clip:new Matrix4(),planes:new Frustum()};cameraPlanes.set(view,data)}
      if(!data.clip.equals(clip)){data.clip.copy(clip);data.planes.setFromProjectionMatrix(clip,view.coordinateSystem)}
      return data.planes
    }
    for(const kind of kinds){
      const local=groves.find(template=>template.userData.gardenPrototype===kind)
      const prototypes=local?[local]:kit.scene.children.filter(o=>o.name.startsWith('forest_'+kind+'_'))
      // glTF may wrap the authored roots in an extra scene node.
      if(!prototypes.length)kit.scene.traverse(o=>{if(new RegExp('^forest_'+kind+'_\\d+$').test(o.name))prototypes.push(o)})
      const locations:Matrix4[]=[]
      root.traverse(o=>{if(o.userData.prototype===kind&&!o.userData.bambooOmit)locations.push(o.matrixWorld.clone())})
      if(locations.length&&!prototypes.length)throw Error('缺少自然模型 '+kind)
      prototypes.forEach((prototype,variant)=>{
        const instances=locations.filter((matrix,i)=>i%prototypes.length===variant&&
          (!openBambooPath||!lowWoodlandQuality||keepBambooPlant(kind,matrix)))
        if(!instances.length)return
        prototype.traverse(source=>{
          if(!(source instanceof Mesh))return
          const transform=local?local.matrixWorld.clone().invert().multiply(source.matrixWorld):source.matrixWorld
          // Cull groups of plants beyond the view independently, also during transmission passes.
          const patches=new Map<string,Matrix4[]>()
          for(const instance of instances){
            const distance=Math.hypot(instance.elements[12],instance.elements[14])
            const bambooLOD=openBambooPath&&lowWoodlandQuality&&kind.startsWith('grove_')&&distance>2.8
            if(bambooLOD&&source.name.endsWith('_twigs'))continue
            const distant=bambooLOD||(kind==='tree'&&source.name.endsWith('_leaves')||source.userData.woodlandBlade&&kind.startsWith('grove_'))&&distance>13
            const patchWidth=kind==='tree'?3.6:7
            const key=[instance.elements[12],instance.elements[14]].map(v=>Math.floor(v/patchWidth)).join(',')+(distant?',far':'')
            const group=patches.get(key)??[];group.push(instance);patches.set(key,group)
          }
          for(const [patch,group] of patches){
            let geometry=source.geometry
            if(patch.endsWith(',far')){
              if(!farLeaves.has(geometry))farLeaves.set(geometry,openBambooPath&&source.name.endsWith('_culm')?bambooCulmLOD(geometry):
                openBambooPath&&source.userData.woodlandBlade?bambooLeafLOD(geometry):distantLeafGeometry(geometry))
              geometry=farLeaves.get(geometry)!
            }
            const mesh=new InstancedMesh(geometry,source.material,group.length)
            mesh.name=source.name;mesh.userData={...source.userData}
            group.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix.clone().multiply(transform)))
            mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);instancesOwned.push(mesh)
            if((geometry.index?.count??geometry.attributes.position.count)*group.length>45000){
              // A sphere around a canopy often reaches below the horizon even when every leaf is above it.
              // Use the actual planted bounds for the desk, planar mirror and each light independently.
              mesh.computeBoundingBox()
              const bounds=mesh.boundingBox!.clone().applyMatrix4(root.matrixWorld).expandByScalar(.24)
              const select=(view:Camera)=>{mesh.count=planesFor(view).intersectsBox(bounds)?group.length:0}
              const restore=()=>{mesh.count=group.length}
              mesh.onBeforeRender=(_r,_s,view)=>select(view);mesh.onAfterRender=restore
              mesh.onBeforeShadow=(_r,_o,_view,shadow)=>select(shadow);mesh.onAfterShadow=restore
            }
          }
        })
      })
    }
    for(const template of groves)template.removeFromParent()
    const placements:Object3D[]=[]
    root.traverse(o=>{if(o.userData.prototype)placements.push(o)})
    for(const marker of placements)marker.removeFromParent()
    const oldWater=root.getObjectByName(sceneId==='rain'?'rain_pool':'creek_surface')
    const openings=canopyLight()
    const water=oldWater instanceof Mesh?streamSurface(oldWater,sceneId==='rain'?-.096:waterLevel.y,camera,time,openings,sceneId==='creek'?bankHeight??heightAt:heightAt,sceneId==='rain'?eave:undefined,root):null
    if(water){oldWater!.removeFromParent();root.add(water)}
    const wetMoss=kit.scene.getObjectByName('forest_ledge_0_surface')
    const bank=root.getObjectByName('bank_moss')
    const mossSurface=composed&&bank instanceof Mesh?bank:wetMoss
    const mossMap=mossSurface instanceof Mesh&&mossSurface.material instanceof MeshStandardMaterial?mossSurface.material.map:null
    const mossNormal=mossSurface instanceof Mesh&&mossSurface.material instanceof MeshStandardMaterial?mossSurface.material.normalMap:null
    const canopy=root.getObjectByName('canopy')
    const leafPhoto=canopy instanceof Mesh&&canopy.material instanceof MeshStandardMaterial?canopy.material.map:null
    const patchMaterials=new Map<string,{surface:Material;depth?:Material}>()
    root.traverse(o=>{
      if(!(o instanceof Mesh))return
      const ground=kit.scene.getObjectByName('forest_ground_material')
      if(o.name==='terrain'&&!composed&&ground instanceof Mesh)o.material=ground.material
      if(o.userData.surfaceSource){
        const scan=kit.scene.getObjectByName(o.userData.surfaceSource)
        if(!(scan instanceof Mesh))throw Error('缺少岸石表面 '+o.userData.surfaceSource)
        o.material=scan.material
      }
      o.raycast=()=>null
      o.receiveShadow=true;o.castShadow=o.name!=='terrain'&&o.name!=='creek_surface'&&o.name!=='bank_moss'
      const leaves=/canopy|fern|leaves|grass|blades/.test(o.name)
      const lamina=sceneId==='bamboo'&&o.userData.woodlandBlade===true
      if(o===water){
        o.castShadow=false;o.renderOrder=1;return
      }
      const copy=(source:Material)=>{
        const key=o instanceof InstancedMesh?source.uuid+'-'+o.name:''
        const cached=key?patchMaterials.get(key):undefined
        if(cached){o.customDepthMaterial=cached.depth;return cached.surface}
        const m=source.clone();owned.push(m)
        if(m instanceof MeshStandardMaterial){
          m.envMapIntensity=leaves?.65:.7
          if(o.name==='exposed_wet_clay'){
            m.color.setRGB(.82,.66,.45);m.roughness=.67;m.normalScale.setScalar(.83)
          }
          if(o.name==='terrain'&&!composed){
            m.map=floor;m.map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy())
            m.color.set('#d6caab');m.normalScale.setScalar(.25)
            m.onBeforeCompile=shader=>{
              shader.vertexShader='varying vec3 gardenPosition;\n'+shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenPosition=(modelMatrix*vec4(position,1.)).xyz;')
              shader.uniforms.gardenMoss={value:mossMap??floor}
              shader.fragmentShader='varying vec3 gardenPosition;uniform sampler2D gardenMoss;\n'+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
                vec2 uv2=mat2(.84,-.54,.54,.84)*vMapUv*.43+vec2(.25,.18);
                vec3 layer=texture2D(map,uv2).rgb;
                float islands=.5+.25*sin(gardenPosition.x*1.41+sin(gardenPosition.z*.71))+.25*cos(gardenPosition.z*2.03);
                float path=abs(gardenPosition.x+.27-.75*sin(gardenPosition.z*.43)-.21*sin(gardenPosition.z*.89));
                float bank=${sceneId==='bamboo'?'smoothstep(.20,1.37,path+.31*sin(gardenPosition.z*1.7)+.21*cos(gardenPosition.z*2.86))':'.82+.18*islands'};
                vec3 scan=texture2D(gardenMoss,gardenPosition.xz*.88).rgb;
                float tufts=smoothstep(.025,.29,dot(scan,vec3(.24,.64,.12)));
                vec3 moss=mix(vec3(.032,.053,.013),vec3(.16,.205,.067),tufts)*(.56+islands*.62);
                diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.62,.65,.52),moss,bank*(.54+.38*islands));
                diffuseColor.rgb*=.80+.33*smoothstep(.03,.4,dot(layer,vec3(.25,.65,.10)));`)
            }
          }
          if(o.name==='bank_moss'&&!composed){
            m.map=mossMap;m.color.setRGB(.30,.46,.09);m.roughness=.96
          }
          if((o.name==='terrain'||o.name==='root_bank_soil')&&composed){
            m.color.setRGB(1,1,1);m.normalScale.setScalar(.50);m.roughness=.91
            if(o.name==='root_bank_soil')m.vertexColors=false
            m.onBeforeCompile=shader=>{
              shader.uniforms.scanMoss={value:mossMap??floor}
              if(bankAtlas)shader.uniforms.creekSediment={value:bankAtlas}
              if(sceneId==='rain')shader.uniforms.forestEave={value:eave}
              shader.uniforms.fallenLitter={value:floor}
              shader.uniforms.woodlandSoil={value:soilShade}
              shader.vertexShader=(openBambooPath?'attribute float _bambooBankCover;varying float bankCoverage;\n':'')+'attribute float _mosscover;attribute float _wetness;varying vec4 groundSample;\n'+shader.vertexShader
                .replace('#include <begin_vertex>','#include <begin_vertex>\ngroundSample=vec4((modelMatrix*vec4(position,1.)).xz,_mosscover,_wetness);'+(openBambooPath?'\nbankCoverage=_bambooBankCover;':''))
              shader.fragmentShader=(sceneId==='rain'?'uniform vec3 forestEave;\n':'')+(openBambooPath?'varying float bankCoverage;\n'+reliefNormal:'')+(bankAtlas?bankSampling:'')+woodlandSoilSampling+'\nvarying vec4 groundSample;uniform sampler2D scanMoss;uniform sampler2D fallenLitter;\n'+shader.fragmentShader
                .replace('#include <map_fragment>',`#include <map_fragment>
                  vec2 g=groundSample.xy;
                  vec3 a=texture2D(scanMoss,g*.87+vec2(.23,.14)).rgb;
                  vec3 b=texture2D(scanMoss,mat2(.80,-.60,.60,.80)*g*2.12).rgb;
                  float micro=clamp(dot(a*.62+b*.38,vec3(.26,.57,.17))*2.3,0.,1.);
                  float islands=.50+.22*sin(g.x*2.2+.84*sin(g.y*1.63))+.19*cos(g.y*3.72+g.x)+.09*sin(dot(g,vec2(9.5,5.2)));
                  float cover=smoothstep(.14,.81,groundSample.z*.89+.48*(islands-.5)+.27*(micro-.4));
                  vec3 mossColour=mix(a,b,.31)*vec3(.94,1.04,.81)*(.72+.46*islands);
                  mossColour=mix(vec3(dot(mossColour,vec3(.22,.68,.10))),mossColour,.84);
                  vec3 litter=texture2D(fallenLitter,g*.75).rgb;
                  vec3 soil=mix(diffuseColor.rgb,litter,.28+.21*islands)*mix(.64,.32,groundSample.w);
                  vec4 footprint=soilAt(g);
                  float debris=clamp(dot(litter,vec3(.28,.62,.10))*2.5,0.,1.);
                  float moisture=groundSample.w;
                  float shoulder=footprint.g*(.74+.48*debris);
                  float bare=clamp(shoulder*1.40+moisture*.37+(.48-micro)*.32,0.,.91);
                  soil=mix(soil,litter*vec3(.63,.52,.37),clamp(.12+.52*shoulder+.22*debris*islands,0.,.8));
                  soil*=mix(vec3(1.05,.95,.85),vec3(.55,.52,.43),moisture);
                  ${sceneId==='bamboo'?`float loam=dot(soil,vec3(.27,.61,.12));
                    soil=mix(vec3(.89,.91,.77)*loam,soil,.33)*(.79+.16*debris);`:''}
                  ${sceneId==='rain'?`float bankDamp=smoothstep(.06,.64,moisture);
                    float matting=smoothstep(.27,.68,.55*islands+.32*micro+.38*debris);
                    cover=max(cover,.88*bankDamp*matting);
                    soil=mix(soil,litter*vec3(.53,.49,.32),.44*bankDamp);`:''}
                  diffuseColor.rgb=mix(soil,mossColour,cover*(1.-bare))*(1.-.69*footprint.r-.16*footprint.g);
                  ${openBambooPath?`vec2 crumbUv=g*5.4+vec2(islands*.12,debris*.043);
                    vec3 crushed=texture2D(fallenLitter,crumbUv).rgb;
                    float grains=smoothstep(.035,.28,dot(crushed,vec3(.30,.55,.15)));
                    float humus=clamp(1.-cover*(1.-bare),0.,1.);
                    float gaps=smoothstep(.50,.74,.67*islands+.25*(1.-micro)+.13*debris);
                    humus=max(humus,gaps*.92);
                    vec3 earth=texture2D(map,g*.94+vec2(.43,.21)).rgb;
                    float aggregate=smoothstep(.13,.40,dot(earth,vec3(.38,.51,.11)));
                    vec3 mineralSoil=mix(vec3(.029,.021,.014),vec3(.117,.095,.064),aggregate)*(.65+.68*grains);
                    diffuseColor.rgb=mix(diffuseColor.rgb,mineralSoil,humus*(.13+.65*gaps)*(1.-.84*footprint.r));
                    diffuseColor.rgb*=1.+(grains-.45)*(.27+.40*humus);`:''}
                  ${openBambooPath?`vec2 footPatch=(g-vec2(1.61,-3.12))/vec2(.59,.26);
                    float exposedBed=1.-smoothstep(.60,1.20,length(footPatch)+.14*sin(13.*g.x)+.13*(aggregate-.5));
                    vec3 packedEarth=mix(vec3(.031,.021,.013),vec3(.122,.087,.048),aggregate)*(.70+.68*grains);
                    diffuseColor.rgb=mix(diffuseColor.rgb,packedEarth*(1.-.68*footprint.r),exposedBed*(.75+.17*grains));
                    float fines=1.-smoothstep(.52,.89,.57*grains+.43*aggregate);
                    float poreFilm=smoothstep(.20,.77,moisture)*(.38+.62*fines);
                    diffuseColor.rgb*=mix(vec3(1.),vec3(.27,.25,.22),poreFilm);`:''}
                  ${openBambooPath?`float trailDepth=1.-smoothstep(-9.,-4.8,g.y);
                    float trailCentre=mix(-.12+.46*sin(g.y*.81),-.12+.30*sin((g.y+4.8)*.27)-.62*smoothstep(6.5,12.,-g.y),trailDepth);
                    float flank=abs(g.x-trailCentre)/mix(1.,.72,trailDepth);
                    float trail=smoothstep(.23,.94,flank+.21*sin(g.y*2.0+g.x*1.2)+.27*(islands-.5));
                    float runner=trail*smoothstep(.25,.67,.53*islands+.46*micro+.16*debris);
                    float pathReach=smoothstep(-8.2,-6.1,g.y)*(1.-smoothstep(.81,1.47,flank));
                    vec3 humic=mix(vec3(.056,.032,.018),vec3(.17,.108,.055),aggregate)*(.64+.68*grains);
                    // Mineral grains stay light on small ridges; fine humus in the
                    // stone apron and pockets between leaf clusters holds moisture.
                    float settled=footprint.g*(.35+.65*fines)+smoothstep(.48,.78,islands)*(.27+.34*fines);
                    humic*=mix(vec3(1.),vec3(.49,.48,.39),clamp(settled,0.,1.));
                    // Damp leaf mould and moss interrupt the worn centre at the toes of both slopes.
                    float seam=.5+.5*sin(g.y*1.91+1.24*g.x+.96*sin(g.x*2.39+.61*g.y));
                    float drift=smoothstep(.45,.72,.39*seam+.28*islands+.21*micro+.12*debris);
                    float toe=clamp(drift*(.65+.32*settled)*(1.-.64*exposedBed),0.,1.);
                    vec3 mould=mix(humic*vec3(.52,.64,.51),mossColour*(.65+.27*micro),.42+.37*micro);
                    vec3 pathBed=mix(mix(humic,mould,toe),mossColour*(.64+.40*micro),runner);
                    diffuseColor.rgb=mix(diffuseColor.rgb,pathBed,pathReach*(.77-.56*exposedBed));
                    float groveShade=smoothstep(5.8,10.5,-g.y);
                    vec3 deepLitter=mix(humic*vec3(.31,.40,.25),mossColour*vec3(.43,.53,.33),.53+.24*islands);
                    diffuseColor.rgb=mix(diffuseColor.rgb,deepLitter,groveShade*(.65+.24*trail));
                    float livingBank=smoothstep(.05,.92,bankCoverage);
                    float feltGrain=smoothstep(.025,.20,dot(a*.64+b*.36,vec3(.25,.65,.10)));
                    vec3 bankMoss=mix(vec3(.013,.026,.008),vec3(.048,.081,.026),feltGrain)*(.72+.39*islands);
                    vec3 agedLeaves=texture2D(fallenLitter,g*1.53+vec2(.27,.41)).rgb*vec3(.32,.25,.15);
                    float mossPatches=smoothstep(.30,.72,.51*islands+.29*micro+.20*grains);
                    float nearSoil=(1.-smoothstep(.65,2.8,-g.y))*.32;
                    vec3 bankHumus=mix(vec3(.038,.028,.016),vec3(.081,.060,.032),.55*micro+.45*debris);
                    vec3 bankSkin=mix(bankHumus,bankMoss,clamp(.27+.57*mossPatches-nearSoil,.10,.84));
                    bankSkin=mix(bankSkin,agedLeaves,.17+.22*grains);
                    float brokenEdge=smoothstep(.03+.10*islands,.91,bankCoverage);
                    diffuseColor.rgb=mix(diffuseColor.rgb,bankSkin*(1.-.55*footprint.r),brokenEdge*(.87+.08*islands));`:''}
                  ${sceneId==='rain'?`float bankY=soilElevation(footprint);
                    float drip=1.-smoothstep(.05,.47,abs(g.y-forestEave.z+.08*sin(g.x*3.1)));
                    drip*=1.-smoothstep(2.8,3.9,abs(g.x-forestEave.x));
                    float soaked=max(1.-smoothstep(-.09,.18+.12*islands,bankY),drip*.93);
                    float mudFilm=soaked*(1.-smoothstep(.42,.88,.55*debris+.45*micro));
                    vec3 earth=mix(vec3(.034,.021,.013),vec3(.123,.079,.042),debris)*(.70+.39*islands);
                    float alluvium=1.-smoothstep(-.06,.21+.08*islands+.04*(debris-.5),bankY);
                    vec3 rainClay=mix(vec3(.029,.017,.010),vec3(.103,.068,.039),.59*debris+.41*micro);
                    earth=mix(earth,rainClay,alluvium);
                    diffuseColor.rgb=mix(diffuseColor.rgb,earth*(1.-.65*mudFilm),max(.48+.44*soaked,.88*alluvium)*(1.-cover*.44));
                    diffuseColor.rgb*=1.-.48*footprint.r;`:''}
                  ${sceneId==='creek'?`float shoreY=soilElevation(footprint)+.132;
                    float tide=1.-smoothstep(.00,.26+.09*islands,shoreY);
                    float sandReach=1.-smoothstep(.23,.78+.13*islands,shoreY);
                    float grains=smoothstep(.025,.24,texture2D(fallenLitter,g*4.37+debris*.13).r);
                    vec3 sand=mix(vec3(.069,.043,.023),vec3(.181,.136,.076),grains)*(.69+.43*islands);
                    sand*=mix(vec3(1.),vec3(.42,.47,.48),tide*(1.-grains*.43));
                    diffuseColor.rgb=mix(diffuseColor.rgb,sand,sandReach*(1.-cover*.63)*(.61+.20*debris));
                    diffuseColor.rgb*=1.-.37*footprint.r;
                    ${bankAtlas?dryBankSurface:''}`:''}
                  ${sceneId!=='rain'?`
                    // Reintroduce the millimetre-to-centimetre contrast of the real litter scan
                    // after blending the soil types. The low-frequency colour still follows moisture.
                    vec2 litterPatch=mat2(.94,-.342,.342,.94)*g*.89+vec2(.21,.44);
                    vec3 fragmentScan=texture2D(fallenLitter,litterPatch).rgb;
                    const vec3 eyeSensitivity=vec3(.23,.66,.11);
                    float fragmentValue=dot(fragmentScan,eyeSensitivity);
                    float averageBed=dot(textureLod(fallenLitter,litterPatch,5.3).rgb,eyeSensitivity);
                    float fineRelief=clamp((fragmentValue+.013)/(averageBed+.013),.38,2.7);
                    float dryLand=${sceneId==='creek'?'smoothstep(.01,.30,shoreY)':'1.'};
                    float mineralFraction=clamp(1.-.66*cover,0.,1.);
                    float litterLayer=dryLand*(.44+.43*mineralFraction)*(1.-.58*footprint.r);
                    diffuseColor.rgb*=mix(1.,.79*pow(fineRelief,1.13),litterLayer);
                    float tawny=smoothstep(.035,.20,fragmentScan.r-fragmentScan.b)
                      *smoothstep(.022,.14,fragmentScan.r-fragmentScan.g*.80);
                    vec3 dryLeaf=mix(fragmentValue*vec3(.79,.63,.40),fragmentScan*vec3(.65,.70,.57),.46);
                    diffuseColor.rgb=mix(diffuseColor.rgb,dryLeaf*(1.-.46*moisture),tawny*litterLayer*.70);
                    ${openBambooPath?`// The worn centre exposes pale grit; its wooded shoulders retain dark humus.
                    float wornTrack=(1.-trail)*(.64+.36*smoothstep(.15,.65,aggregate))*(1.-.72*groveShade);
                    vec3 soilReflectance=mix(vec3(.205,.255,.132),vec3(.56,.49,.37),wornTrack);
                    diffuseColor.rgb*=mix(soilReflectance,vec3(.68,.55,.37),.19*tawny*(1.-moisture));`:
                    sceneId==='creek'?`// Keep minerals underwater visible, while upper banks absorb light in moist leaf mould.
                    float woodedBank=smoothstep(.03,.34,shoreY)*(.75+.25*islands);
                    vec3 bankReflectance=mix(vec3(.50,.47,.34),vec3(.21,.28,.155),woodedBank);
                    diffuseColor.rgb*=mix(vec3(1.),bankReflectance,smoothstep(-.018,.085,shoreY));`:''}
                  `:''}`)
                .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
                  ${sceneId==='rain'?`
                    #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
                      reflectedLight.indirectSpecular+=radiance*mudFilm*(.026+.12*pow(1.-saturate(dot(normal,geometryViewDir)),4.));
                    #endif`:''}
                  ${openBambooPath?`
                    // Beneath the low growth, the ground sees a second, lower foliage layer.
                    // Sun through both layers retains its warmth; the damp pores hold a small glint.
                    float lowWindow=leafOpening(vec3(g.x,.74,g.y));
                    float warmPatch=smoothstep(.38,.83,lowWindow)*(.52+.48*islands);
                    reflectedLight.directDiffuse*=mix(vec3(.33,.38,.26),vec3(1.02,.91,.69),warmPatch);
                    reflectedLight.directSpecular*=mix(.24,.78,warmPatch);
                    #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
                      float filmFresnel=.045+.26*pow(1.-saturate(dot(normal,geometryViewDir)),4.);
                      reflectedLight.indirectSpecular+=radiance*filmFresnel*poreFilm;
                    #endif`:''}`)
                .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n'+ (openBambooPath?`
                  vec3 crumbs=bedGradient(vec3(g.x*18.3,2.17,g.y*18.3));
                  normal=bedNormal(normal,vec3(crumbs.x,0.,crumbs.z)*(.078+.12*humus)*(1.-smoothstep(5.,14.,length(vViewPosition))));
                  normal=normalize(mix(normal,nonPerturbedNormal,poreFilm*.74));
                  normal=bedNormal(normal,bedGradient(vec3(g.x*28.1,1.77,g.y*28.1))*.11*livingBank);`:
                  sceneId==='rain'?'normal=normalize(mix(normal,nonPerturbedNormal,mudFilm*.59));':
                  sceneId==='creek'?'normal=normalize(mix(normal,nonPerturbedNormal,tide*(1.-grains)*.54));'+(bankAtlas?dryBankNormal:''):'')) 
                .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n'+(openBambooPath?
                  'roughnessFactor=mix(roughnessFactor,.19+.08*aggregate,poreFilm);roughnessFactor=mix(roughnessFactor,.95,livingBank);':
                  sceneId==='rain'?'roughnessFactor=mix(.92,.24,mudFilm);':
                  sceneId==='creek'?'roughnessFactor=mix(.94,.35,tide*(1.-.42*grains));'+(bankAtlas?'roughnessFactor=mix(roughnessFactor,clamp(bankRough*(1.-.23*tide),.46,.98),dryBank);':''):
                  'roughnessFactor=mix(roughnessFactor,.40,smoothstep(.64,.98,groundSample.w)*.77);'))
            }
          }
          if(!lamina&&o.name.includes('grove_')&&o.name.endsWith('leaves')){
            m.color.setRGB(.27,.39,.092);m.emissive.setRGB(.022,.034,.007)
          }
          if(o.name.includes('grove_')&&o.name.endsWith('culm')){
            m.color.setRGB(1.68,1.75,1.11);m.emissive.setRGB(.012,.018,.005);m.roughness=.44
            if(openBambooPath){m.color.setRGB(1.24,1.48,1.15);m.emissive.setRGB(0,0,0);m.roughness=.78}
          }
          if(o.name.includes('forest_tree_')&&leaves){
            m.color.setRGB(1.05,1.24,.80);m.emissive.setRGB(.013,.023,.006)
          }
          if(o.name.includes('forest_ledge_')){
            m.onBeforeCompile=shader=>{
              shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
                vec3 nWorld=inverseTransformDirection(normalize(vNormal),viewMatrix);
                float grain=dot(diffuseColor.rgb,vec3(.25,.62,.13));
                float tufts=smoothstep(.023,.20,grain)*smoothstep(.25,.88,nWorld.y);
                diffuseColor.rgb=mix(diffuseColor.rgb*.75,vec3(.064,.103,.023)*(.33+3.5*grain),.79*tufts);
              `)
            }
          }
          if(o.name.startsWith('sedge_')){m.color.setRGB(.18,.265,.080);m.emissive.setRGB(.016,.024,.005)}
          if(o.name==='understory_leaves'&&!lamina){
            m.map=leafPhoto;m.color.setRGB(1.62,1.36,2.0);m.emissive.setRGB(.014,.024,.008)
          }
          if(o.name.includes('forest_rock')){
            m.onBeforeCompile=shader=>{
              shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
                vec3 upNormal=inverseTransformDirection(normalize(vNormal),viewMatrix);
                float mottling=clamp(diffuseColor.g*5.,0.,1.);
                vec3 moss=vec3(.065,.115,.034)*(.45+1.7*mottling);
                diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.78,.85,.82),moss,smoothstep(.18,.80,upNormal.y)*(.58+.35*mottling));`)
            }
          }
          if(o.userData.surfaceSource){
            const mantle=o.geometry.hasAttribute('_mossMantle')
            m.normalScale.setScalar(.94);m.roughness=o.userData.waterlineStone?.26:sceneId==='rain'?.46:.82
            m.envMapIntensity=o.userData.waterlineStone?1.76:sceneId==='rain'?1.30:.90
            m.onBeforeCompile=shader=>{
              shader.uniforms.mossSkin={value:mossMap??floor}
              shader.uniforms.mossRelief={value:mossNormal??mossMap??floor}
              shader.uniforms.woodlandSoil={value:soilShade}
              shader.vertexShader='varying vec3 rockPosition;\n'+shader.vertexShader
                .replace('#include <begin_vertex>','#include <begin_vertex>\nrockPosition=(modelMatrix*vec4(position,1.)).xyz;')
              if(mantle){
                shader.vertexShader='attribute float _mossMantle;attribute float _rockLip;varying vec2 outcropSurface;\n'+shader.vertexShader
                  .replace('#include <project_vertex>','outcropSurface=vec2(_mossMantle,_rockLip);\n#include <project_vertex>')
                shader.fragmentShader='varying vec2 outcropSurface;\n'+shader.fragmentShader
              }
              shader.fragmentShader=(openBambooPath?reliefNormal:'')+woodlandSoilSampling+'\nvarying vec3 rockPosition;uniform sampler2D mossSkin;uniform sampler2D mossRelief;\n'+shader.fragmentShader
                .replace('#include <color_fragment>',`#include <color_fragment>
                  vec3 up=inverseTransformDirection(normalize(vNormal),viewMatrix);
                  vec2 stoneUv=rockPosition.xz*1.65+rockPosition.y*vec2(.37,.28);
                  vec3 cushion=texture2D(mossSkin,stoneUv).rgb;
                  float colony=.5+.26*sin(dot(rockPosition,vec3(7.,3.,3.6)))+.24*cos(rockPosition.z*5.3-rockPosition.x*2.2);
                  float nap=smoothstep(.018,.30,dot(cushion,vec3(.23,.68,.09)));
                  float growth=smoothstep(.30,.95,up.y*.70+colony*.55+nap*.22-.16)
                    *${sceneId==='bamboo'?'1.':sceneId==='creek'?'smoothstep(-.118,-.041+colony*.03,rockPosition.y)':'smoothstep(-.082,.048+colony*.04,rockPosition.y)'};
                  vec3 exposed=diffuseColor.rgb*vec3(.84,.86,.86);
                  float mineral=dot(exposed,vec3(.24,.63,.13));
                  exposed=mix(vec3(.084,.088,.075)*(.60+.70*nap),exposed,smoothstep(.018,.083,mineral));
                  vec3 green=cushion*vec3(.83,1.09,.68)*(.66+.72*nap);
                  ${sceneId==='creek'?`float wetBand=1.-smoothstep(-.13,-.043+.021*(nap-.5),rockPosition.y);
                    float lichen=smoothstep(.54,.79,nap+.22*colony)*smoothstep(.18,.78,up.y);
                    exposed*=mix(vec3(.97,.96,.91),vec3(.42,.55,.57),wetBand);
                    exposed=mix(exposed,vec3(.19,.18,.115)*(.48+.73*nap),lichen*(1.-wetBand)*.38);
                    green*=vec3(.97,1.03,.81)*(.70+.58*nap);`:''}
                  vec4 foot=soilAt(rockPosition.xz);
                  float soilLip=rockPosition.y-soilElevation(foot);
                  float mud=(1.-smoothstep(-.012,.08+.075*nap,soilLip))*(.48+.52*foot.g);
                  ${sceneId==='rain'?`// A dark wet face reaches a different height on each rock.
                    float abovePool=rockPosition.y+.096;
                    float wetStoneFilm=(1.-smoothstep(.012,.057+.031*nap,abovePool))*
                      smoothstep(.002,.039,soilLip)*(1.-growth);
                    exposed*=mix(vec3(1.),vec3(.46,.55,.53),wetStoneFilm);`:''}
                  ${sceneId==='creek'&&o.userData.outcropFoot?`// Exposed inland shoulders are drier than stream boulders.
                    growth*=.23*(.34+.66*(1.-smoothstep(.015,.07,soilLip)));
                    mud*=.39;
                    exposed=mix(exposed,vec3(dot(exposed,vec3(.28,.57,.15)))*vec3(1.12,1.03,.89),.74);
                    exposed+=vec3(.077,.065,.049)*(.58+.75*nap);`:''}
                  float faceExposure=smoothstep(.05,.52,soilLip)*(1.-smoothstep(.30,.89,up.y));
                  growth*=1.-faceExposure*.88;
                  float faceGrain=dot(cushion,vec3(.31,.51,.18));
                  exposed=mix(exposed,vec3(.14,.127,.101)*(.52+1.24*faceGrain),faceExposure*(.32+.28*nap));
                  ${o.userData.exposedShoulder?`float granite=dot(exposed,vec3(.25,.59,.16));
                    exposed=mix(${openBambooPath?'vec3(.61,.79,.87)':'vec3(.52,.57,.53)'}*granite,exposed,.13);
                    growth=clamp(growth+.29*smoothstep(.42,.96,up.y)*nap,0.,1.);`:''}
                  ${openBambooPath?`
                    float bedding=rockPosition.y*4.6+rockPosition.x*2.4-rockPosition.z*1.34;
                    float fleck=texture2D(mossSkin,stoneUv*5.7).r;
                    float fracture=abs(fract(bedding+.32*nap+.14*sin(rockPosition.x*11.+rockPosition.z*8.))-.5);
                    float seam=(1.-smoothstep(.014,.103,fracture))*smoothstep(.18,.70,nap+.29*colony);
                    float crystal=smoothstep(.016,.093,fleck);
                    exposed*=mix(vec3(.77,.80,.80),vec3(1.20,1.18,1.13),crystal)*(1.-.41*seam);
                    growth*=smoothstep(.17,.65,nap*.76+colony*.47+up.y*.32);
                    float cushionEdge=smoothstep(.28,.71,growth+.32*(nap-.25));
                    growth=mix(growth,cushionEdge,.69);
                    float grainPit=smoothstep(.021,.14,dot(cushion,vec3(.27,.64,.09)));
                    exposed=mix(exposed,vec3(.12,.132,.125)*(.42+.95*grainPit+.41*crystal),
                      .35*faceExposure)*(1.-.16*seam);
                    float damp=1.-smoothstep(.006,.064+.064*nap,soilLip);
                    exposed*=mix(vec3(1.),vec3(.43,.52,.52),damp);
                    green*=mix(vec3(.72,.79,.67),vec3(1.13,1.07,.91),nap);
                  `:''}
                  ${mantle?`// Project the fine nap onto the turning face as well as the crest.
                    vec3 w=pow(abs(up),vec3(3.));w/=max(.001,dot(w,vec3(1.)));
                    vec3 felt=texture2D(mossSkin,rockPosition.zy*2.8).rgb*w.x+
                      texture2D(mossSkin,rockPosition.xz*2.8).rgb*w.y+texture2D(mossSkin,rockPosition.xy*2.8).rgb*w.z;
                    float napFine=smoothstep(.025,.14,dot(felt,vec3(.24,.65,.11)));
                    growth=smoothstep(.15,.84,outcropSurface.x+.26*(napFine-.5));
                    float tuftLight=.63+.38*napFine+.16*max(0.,up.y);
                    green=(mix(vec3(.013,.023,.006),vec3(.047,.061,.018),.34+.50*napFine)+felt*.12)*tuftLight;
                    float grain=smoothstep(.012,.14,dot(diffuseColor.rgb,vec3(.26,.59,.15)));
                    float ledge=smoothstep(-.009,.028,outcropSurface.y);
                    float foliation=rockPosition.x*59.-rockPosition.y*28.+rockPosition.z*15.
                      +.84*sin(12.*rockPosition.y+8.*rockPosition.z)+.45*grainPit;
                    float flake=smoothstep(.40,.93,sin(foliation))*(.12+.74*grainPit);
                    exposed=mix(vec3(.052,.056,.045),vec3(.140,.150,.125),.53*grain+.31*crystal+.16*ledge);
                    exposed*=(.80+.31*ledge)*(.89+.34*grainPit+.17*flake);
                    float polish=smoothstep(.002,.024,outcropSurface.y)*(1.-growth)*(.78+.22*grainPit);
                    exposed*=1.-.12*polish;
                  `:''}
                  ${sceneId==='bamboo'&&o.userData.outcropFoot?`float smallGrain=dot(exposed,vec3(.27,.59,.14));
                    exposed=vec3(.78,.85,.80)*smallGrain*.76;
                    growth=max(growth,.62*smoothstep(.19,.70,up.y+nap*.30));`:''}
                  diffuseColor.rgb=mix(mix(exposed,green,${mantle?'growth':'.90*growth'}),exposed*vec3(.49,.46,.34),mud*.80);`)
                .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
                  vec2 fibres=texture2D(mossRelief,stoneUv).rg*2.-1.;
                  normal=normalize(normal+mat3(viewMatrix)*vec3(fibres.x,0.,fibres.y)*(.33*growth));
                  ${openBambooPath?`vec3 worn=bedGradient(rockPosition*11.2)*.26+bedGradient(rockPosition*32.7+vec3(3.1))* .085;
                    ${mantle?`worn+=((.42*bedGradient(rockPosition*23.+vec3(1.7))+.18*bedGradient(rockPosition*57.))+
                      vec3(.65,-.31,.16)*cos(foliation)*(.24+.63*grainPit))*(1.-growth);`:''}
                    normal=bedNormal(normal,worn*(1.-.57*growth)*(1.-smoothstep(7.,19.,length(vViewPosition))));
                    ${mantle?'normal=normalize(mix(normal,nonPerturbedNormal,.92*polish));':''}`:''}`)
                .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
                  roughnessFactor=mix(mix(${sceneId==='bamboo'?'.61':'.18'},roughnessFactor,smoothstep(-.08,.18,rockPosition.y)),.93,growth);
                  ${sceneId==='creek'?'roughnessFactor=mix(roughnessFactor,.12+.11*nap,wetBand);':''}
                  ${sceneId==='rain'?'roughnessFactor=mix(roughnessFactor,.15+.12*nap,wetStoneFilm);':''}
                  ${openBambooPath?'roughnessFactor=mix(roughnessFactor,.37+.13*nap,damp*(1.-growth));':''}
                  ${mantle?'roughnessFactor=mix(roughnessFactor,.28+.10*crystal,polish);':''}`)
                .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
                  ${mantle?`
                    #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
                      float ridgeFresnel=.035+.10*pow(1.-saturate(dot(normal,geometryViewDir)),3.);
                      reflectedLight.indirectSpecular+=radiance*polish*ridgeFresnel;
                    #endif`:''}
                  ${sceneId==='rain'?`
                    #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
                      float grazingFilm=.035+.27*pow(1.-saturate(dot(normal,geometryViewDir)),4.);
                      reflectedLight.indirectSpecular+=radiance*grazingFilm*wetStoneFilm;
                    #endif`:''}`)
            }
            m.customProgramCacheKey=()=>'weathered-bank-'+sceneId+'-'+Boolean(o.userData.exposedShoulder)+'-'+openBambooPath+'-'+mantle+'-'+Boolean(o.userData.outcropFoot)
          }
          if(o.name==='submerged_stream_pebbles'){
            m.onBeforeCompile=s=>{
              s.vertexShader='varying float pebbleHeight;\n'+s.vertexShader
                .replace('#include <project_vertex>','#include <project_vertex>\npebbleHeight=(modelMatrix*instanceMatrix*vec4(transformed,1.)).y;')
              s.fragmentShader='varying float pebbleHeight;\n'+s.fragmentShader
                .replace('#include <color_fragment>','#include <color_fragment>\nfloat wetGravel=1.-smoothstep(-.138,-.082,pebbleHeight);diffuseColor.rgb*=mix(vec3(1.),vec3(.58,.63,.65),wetGravel);')
                .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.85,.30,wetGravel);')
            }
            m.customProgramCacheKey=()=>'shore-gravel-skin'
          }
          if(o.name==='pinned_wet_litter'||o.name==='root_pocket_litter'){
            const detailed=o.geometry.hasAttribute('_litterCoord')
            m.onBeforeCompile=s=>{
              if(detailed){
                s.vertexShader='attribute vec3 _litterCoord;varying vec3 leafSkin;\n'+s.vertexShader
                  .replace('#include <begin_vertex>','#include <begin_vertex>\nleafSkin=_litterCoord;')
                s.uniforms.humusTexture={value:floor}
                s.fragmentShader='uniform sampler2D humusTexture;varying vec3 leafSkin;\n'+s.fragmentShader
                  .replace('#include <color_fragment>',`#include <color_fragment>
                    if(leafSkin.z>=0.){
                      float age=leafSkin.z,t=leafSkin.x,w=abs(leafSkin.y);
                      vec2 uv=vec2(t*.64,leafSkin.y*.14)+vec2(age*2.31,.13+age);
                      vec3 skin=texture2D(humusTexture,uv).rgb;
                      float fleck=smoothstep(.014,.22,dot(skin,vec3(.32,.54,.14)));
                      float grain=.66*fleck+.34*smoothstep(.015,.16,texture2D(humusTexture,uv*3.6).g);
                      float rib=1.-smoothstep(.013,.046+fwidth(w),w);
                      float line=(t-.28*w+.042*w*w+.016*sin(t*17.+age))*8.4;
                      float branches=(1.-smoothstep(.016,.086+fwidth(line),abs(fract(line+.5)-.5)))*(1.-.69*w);
                      float rot=smoothstep(.24,.72,w*.47+age*.25+(1.-fleck)*.49);
                      diffuseColor.rgb*=mix(vec3(.58,.48,.40),vec3(1.22,1.18,1.06),grain)*(1.-.34*rot);
                      diffuseColor.rgb+=vec3(.040,.026,.013)*(rib*.95+branches*.48)*(.48+.52*age);
                    }`)
              }
              s.vertexShader='attribute float _leafFilm;varying float fallenFilm;\n'+s.vertexShader
                .replace('#include <begin_vertex>','#include <begin_vertex>\nfallenFilm=_leafFilm;')
              s.fragmentShader='varying float fallenFilm;\n'+s.fragmentShader
                .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=1.-.32*fallenFilm;')
                .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.55,.21,fallenFilm);')
            }
            m.customProgramCacheKey=()=>'pressed-wet-leaf-'+detailed
          }
          if(leaves){m.side=DoubleSide;m.roughness=sceneId==='rain'?.52:.79;m.color.multiply(new Color('#d0d2c5'));m.alphaTest=.4;m.transparent=false;m.depthWrite=true}
          if(composed&&leaves&&m.map){
            // Scanned leaf undersides receive diffuse light transmitted through the blade.
            m.emissiveMap=m.map;m.emissive.setRGB(.049,.071,.025)
            if(o.name.includes('forest_fern_'))m.color.setRGB(1.04,1.15,.97)
          }
          if(lamina){
            m.color.setRGB(1,1,1);m.emissiveMap=null;m.emissive.setRGB(0,0,0)
            m.alphaTest=o.userData.serratedMargin?.36:0;m.roughness=.64;m.normalScale.setScalar(.52);m.envMapIntensity=.40
          }
          if(openBambooPath&&(lamina||o.name.includes('forest_fern_')||o.name==='bamboo_verge_grass')){
            m.emissive.setRGB(0,0,0);m.roughness=lamina?.81:.91;m.envMapIntensity=lamina?.36:.28
            if(lamina)m.color.setRGB(.77,.90,.72)
            if(o.name.includes('forest_fern_'))m.color.multiply(new Color().setRGB(.84,.92,.63))
          }
          if(openBambooPath&&o.userData.bambooSunLeaf){m.color.setRGB(.77,.90,.72);m.emissive.setRGB(0,0,0);m.roughness=.78;m.envMapIntensity=.25;m.alphaTest=0}
          if(composed&&o.name.startsWith('bryophyte_')){
            m.color.setRGB(1.08,1.37,.90);m.roughness=.94
          }
          if(sceneId==='rain'&&/rocks|trunks/.test(o.name))m.roughness=.68
          if(composed&&sceneId==='rain'&&/forest_(rock|ledge|rootwood)|mature_bark|_bark/.test(o.name)){
            m.roughness=.49;m.color.multiplyScalar(.77);m.envMapIntensity=1.05
          }
          if(m.map)m.map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy())
        }
        if(o.userData.wind){
          // Blender exports these scalar attributes in the same world scale as the model.
          for(const name of ['_bend','_phase'])if(!o.geometry.getAttribute(name))throw Error('缺少风摆权重 '+o.name+' '+name)
          const tipWeighted=lamina&&Boolean(o.geometry.getAttribute('_leaf_tip'))
          addWind(m,time,wind,leaves,sceneId==='rain',tipWeighted)
          const depth=new MeshDepthMaterial({depthPacking:RGBADepthPacking,side:leaves?DoubleSide:m.side})
          if(m instanceof MeshStandardMaterial){depth.map=m.map;depth.alphaTest=m.alphaTest}
          addWind(depth,time,wind,leaves,sceneId==='rain',tipWeighted);owned.push(depth);o.customDepthMaterial=depth
        }
        if(composed&&o.name.startsWith('bryophyte_')&&m instanceof MeshStandardMaterial){
          const windCompile=m.onBeforeCompile.bind(m),windKey=m.customProgramCacheKey()
          m.onBeforeCompile=(shader,renderer)=>{
            windCompile(shader,renderer)
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
              float tissue=dot(diffuseColor.rgb,vec3(.26,.65,.09));
              diffuseColor.rgb=mix(vec3(.035,.055,.017),diffuseColor.rgb,smoothstep(.01,.18,tissue));`)
          }
          m.customProgramCacheKey=()=>windKey+'-bamboo-moss'
        }
        if(composed&&o.name.startsWith('grove_')&&o.name.endsWith('_culm')){
          const windCompile=m.onBeforeCompile.bind(m),key=m.customProgramCacheKey()
          const variant=Number(o.name.split('_')[1]),height=6.3+variant*.59
          const spacing=height/Math.round(height/.42)
          m.onBeforeCompile=(s,r)=>{
            windCompile(s,r)
            s.vertexShader='varying vec3 stemLocal;\n'+s.vertexShader.replace('#include <project_vertex>','stemLocal=position;\n#include <project_vertex>')
            s.fragmentShader='varying vec3 stemLocal;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
              float joint=fract(stemLocal.y/${spacing.toFixed(5)});
              float rim=1.-smoothstep(.012,.042,abs(joint-.038));
              float groove=1.-smoothstep(.01,.045,abs(joint-.091));
              float theta=atan(stemLocal.z,stemLocal.x);
              float wax=.5+.5*sin(7.*theta+stemLocal.y*.74+sin(theta*13.));
              float vein=sin(theta*74.+.39*sin(stemLocal.y*2.9));
              float fibre=1.+.046*vein*(1.-smoothstep(.7,2.3,fwidth(theta)*74.));
              float bloom=(1.-smoothstep(.04,.29,joint))*(.20+.34*wax);
              diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.83,.91,.80),diffuseColor.rgb*vec3(1.09,1.035,.85),wax);
              diffuseColor.rgb=diffuseColor.rgb*fibre*(1.-.50*groove)+vec3(.115,.108,.059)*rim+vec3(.041,.049,.032)*bloom;
              ${openBambooPath?`vec2 skin=vec2(stemLocal.x*9.+stemLocal.z*6.,stemLocal.y*.88);
                float scuff=texture2D(rootLitter,skin).g;
                float chalk=smoothstep(.035,.19,scuff)*(.21+.65*(1.-smoothstep(.05,.46,joint)))*(1.-rim);
                diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.178,.191,.133)*(.78+.38*wax),.55*chalk);
                diffuseColor.rgb*=.90+.16*smoothstep(.04,.23,scuff);`:''}`)
            if(openBambooPath){
              s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
                float rindDust=clamp(.18+.47*wax+.72*bloom-.76*rim,0.,1.);
                roughnessFactor=mix(.52,.94,rindDust);`)
                .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
                  vec3 tangentRind=normalize(cross(normal,mat3(viewMatrix)*vec3(0.,1.,0.))+vec3(.00001));
                  normal=normalize(normal+tangentRind*(.037*vein+.065*sin(theta*21.+stemLocal.y*.68))*
                    (1.-smoothstep(.38,2.20,fwidth(theta)*48.)));`)
            }
          }
          m.customProgramCacheKey=()=>key+'-bamboo-joint-'+variant
        }
        if(composed&&!lamina&&sceneId==='bamboo'&&o.name.startsWith('grove_')&&o.name.endsWith('_leaves')){
          const windCompile=m.onBeforeCompile.bind(m),key=m.customProgramCacheKey()
          m.onBeforeCompile=(s,r)=>{
            windCompile(s,r)
            s.vertexShader='varying vec2 bladeUv;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbladeUv=uv;')
            s.fragmentShader='varying vec2 bladeUv;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
              float halfBlade=abs(bladeUv.x-.5),pixel=max(.009,fwidth(bladeUv.x));
              float midrib=(1.-smoothstep(.012,.030+pixel,halfBlade))*.032/(.032+pixel);
              float flank=smoothstep(.04,.92,bladeUv.x);
              diffuseColor.rgb*=mix(vec3(.83,.91,.82),vec3(1.13,1.085,.86),flank);
              diffuseColor.rgb+=vec3(.053,.065,.018)*midrib;`)
          }
          m.customProgramCacheKey=()=>key+'-bamboo-blade'
        }
        if(composed&&m instanceof MeshStandardMaterial&&(/_culm$|_bark\d*$|^exposed_wet_clay$/.test(o.name))){
          const previous=m.onBeforeCompile.bind(m),materialKey=m.customProgramCacheKey(),clay=o.name==='exposed_wet_clay'
          m.onBeforeCompile=(shader,renderer)=>{
            previous(shader,renderer);shader.uniforms.woodlandSoil={value:soilShade};shader.uniforms.rootLitter={value:floor}
            shader.vertexShader='varying vec3 rootWorld;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
              vec4 rootVertex=vec4(transformed,1.);
              #ifdef USE_INSTANCING
                rootVertex=instanceMatrix*rootVertex;
              #endif
              rootWorld=(modelMatrix*rootVertex).xyz;`)
            shader.fragmentShader=woodlandSoilSampling+'\nvarying vec3 rootWorld;uniform sampler2D rootLitter;\n'+shader.fragmentShader
              .replace('#include <color_fragment>',`#include <color_fragment>
                vec4 soilContact=soilAt(rootWorld.xz);
                float heightAboveSoil=rootWorld.y-soilElevation(soilContact);
                vec3 organic=texture2D(rootLitter,rootWorld.xz*1.29+rootWorld.y*vec2(.18,.09)).rgb;
                float coarse=smoothstep(.045,.28,dot(organic,vec3(.28,.62,.10)));
                float moisture=1.-smoothstep(-.016,.115+.14*coarse,heightAboveSoil);
                ${clay?`float poolWet=1.-smoothstep(-.091,.073+.07*coarse,rootWorld.y);
                  diffuseColor.rgb=mix(diffuseColor.rgb,organic*vec3(.68,.52,.33),.24+.30*coarse);
                  diffuseColor.rgb*=mix(vec3(.99,.91,.76),vec3(.49,.45,.36),poolWet)*(1.-.61*soilContact.r);`:
                  `vec3 bark=diffuseColor.rgb;
                  diffuseColor.rgb=mix(bark,bark*vec3(.45,.47,.32)+organic*vec3(.095,.066,.033),moisture*(.72+.28*soilContact.r));`}`)
            if(clay)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',
              '#include <roughnessmap_fragment>\nroughnessFactor=mix(.80,.27,poolWet*(.58+.42*coarse));')
          }
          m.customProgramCacheKey=()=>materialKey+'-root-contact-'+clay
        }
        if(composed&&m instanceof MeshStandardMaterial)filterWoodlandSun(m,openings,sceneId,leaves,lamina,skyView,
          openBambooPath&&(lamina||o.name.includes('forest_fern_')&&leaves),time)
        if(sceneId!=='rain'&&m instanceof MeshStandardMaterial)addClearingLight(m,composed?(sceneId==='bamboo'?1.02:.18):(sceneId==='bamboo'?.31:.16),composed&&sceneId==='bamboo',bambooSun,leaves,Boolean(o.userData.bambooSunLeaf),o.name==='terrain'||o.name==='root_bank_soil',lamina||/^(grove_.*_leaves|bamboo_side_crown_.*_leaves)$/.test(o.name))
        if(key)patchMaterials.set(key,{surface:m,depth:o.customDepthMaterial})
        return m
      }
      o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material)
    })
    const span=Number(root.getObjectByName('eave_drip_line')?.userData.halfSpan??1.6)
    const releaseHorizon=!openBambooPath&&!distance&&composed&&heightAt?woodlandHorizon(root,kit.scene,heightAt,sceneId,floor,openings):null
    const releaseShingle=bankAtlas&&bankHeight&&soilShade?creekShingle(root,bankHeight,soilShade,waterLevel.y,bankAtlas,openings,time,kit.scene,model.scene):null
    const releaseDistance=distance?selectWoodlandDistance(root,false,sceneId==='bamboo'&&distance.userData.layeredCapture===true):undefined
    if(distance)root.add(distance)
    root.userData.distantCanopy=[...farLeaves].map(([src,lod])=>[src.index?.count,lod.index?.count])
    return {root,owned,instancesOwned,releaseDistance,water,eave,span,heightAt,soilShade,grass,openings,farLeaves,carved,releaseLitter,releaseShingle,shaped,skyView,releaseHorizon,bambooGround,releaseBambooOuter,releaseBambooCanopy,bambooBank}
  },[model,kit,sceneId,time,gl,floor,bankAtlas,camera,distance])
  useEffect(()=>()=>{nature.owned.forEach(m=>m.dispose());nature.instancesOwned.forEach(m=>m.dispose());nature.water?.dispose();nature.water?.geometry.dispose();nature.soilShade?.dispose();nature.releaseLitter?.();nature.releaseDistance?.();nature.releaseShingle?.();nature.shaped?.dispose();nature.skyView?.dispose();nature.grass?.dispose();nature.openings.dispose();nature.carved?.dispose()},[nature])
  useEffect(()=>()=>{nature.farLeaves.forEach((lod,source)=>{if(lod!==source)lod.dispose()})},[nature])
  useEffect(()=>()=>{nature.bambooGround?.dispose();nature.releaseBambooOuter?.();nature.releaseBambooCanopy?.();nature.bambooBank?.dispose()},[nature])
  useEffect(()=>()=>nature.releaseHorizon?.(),[nature])
  useEffect(()=>{
    const preference=matchMedia('(prefers-reduced-motion: reduce)')
    let timer:ReturnType<typeof setInterval>|undefined
    const sync=()=>{
      if(timer)clearInterval(timer)
      active.current=!preference.matches&&document.visibilityState!=='hidden'
      gl.domElement.dataset.environmentMotion=active.current?'running':preference.matches?'reduced':'paused'
      if(active.current)timer=setInterval(invalidate,1000/30)
      invalidate()
    }
    sync();preference.addEventListener('change',sync);document.addEventListener('visibilitychange',sync)
    return()=>{if(timer)clearInterval(timer);active.current=false;preference.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync)}
  },[gl,invalidate])
  useFrame((_,delta)=>{
    nature.root.userData.renderedFrames++
    if(active.current)time.value+=Math.min(delta,.1)
  })
  return <group dispose={null} name="three_dimensional_nature">
    <primitive object={nature.root}/>
    {sceneId==='rain'&&nature.heightAt&&<><Rain time={time} eave={nature.eave} span={nature.span} heightAt={nature.heightAt}/><RainRipples time={time} eave={nature.eave} span={nature.span} heightAt={nature.heightAt}/></>}
  </group>
}
