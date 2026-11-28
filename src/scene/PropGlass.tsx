import { useContext, useLayoutEffect, useMemo } from 'react'
import {FrameTransmission} from './FrameRendering'
import { createPortal } from '@react-three/fiber'
import { Color, FrontSide, Mesh, ShaderChunk, Vector4, type MeshPhysicalMaterial, type Object3D } from 'three'
import { GLASS_LIP, tumblerWall } from './core/tumbler'

/** A hollow tumbler samples the active camera's opaque pass, including the flower stems. */
export default function PropGlass({model,waterPlane}:{model:Object3D;waterPlane?:Vector4}){
  const frame=useContext(FrameTransmission)
  const defines=useMemo(()=>frame?{STANDARD:'',PHYSICAL:'',USE_TRANSMISSION:''}:{STANDARD:'',PHYSICAL:''},[frame])
  const wall=useMemo(()=>model.getObjectByName('glass_hollow_wall'),[model])
  const optics=useMemo<MeshPhysicalMaterial['onBeforeCompile']>(()=>shader=>{
    if(frame)Object.assign(shader.uniforms,{transmission:{value:1},transmissionSamplerMap:{value:frame.texture},transmissionSamplerSize:{value:frame.size},thickness:{value:.005},attenuationColor:{value:new Color('#f0f6f2')},attenuationDistance:{value:.8}})
    shader.uniforms.liquidPlane={value:waterPlane??new Vector4(0,1,0,1)}
    const localVaryings='varying vec3 tumblerPoint;\nvarying vec3 tumblerEye;\n'
    shader.vertexShader=localVaryings+shader.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       tumblerPoint=position/${GLASS_LIP.scale};
       tumblerEye=(inverse(modelMatrix)*vec4(cameraPosition,1.0)).xyz/${GLASS_LIP.scale};`)
    const transmission=ShaderChunk.transmission_fragment.replace('material.thickness = thickness;',`
      {
      float heel = 1.0-smoothstep(.0125,.0145,tumblerPoint.y);
      float wet = (1.0-smoothstep(-.0005,.0005,dot(liquidPlane,vec4(tumblerPoint*${GLASS_LIP.scale},1.0))))*(1.0-heel);
      float facing = clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0);
      material.ior = mix(1.48,1.333,wet);
      material.thickness = mix(.0011/max(.14,facing),.021,heel) + wet*.064*facing;
      }
    `)
    const rimLighting=`
      // Integrate a rounded, subpixel glass bead across its circular section.
      // A light is reflected where its half vector lies in the normal plane of the roll.
      float tumblerRimLobe(vec3 eye,vec3 lightDir,vec3 tangent,vec3 radial,float sharpness) {
        vec3 halfDir=eye+lightDir;
        float t=dot(halfDir,tangent),r=dot(halfDir,radial);
        return exp2(-sharpness*t*t/max(.0001,t*t+r*r));
      }
    `
    shader.fragmentShader=localVaryings+'uniform vec4 liquidPlane;\n'+rimLighting+shader.fragmentShader
      .replace('#include <transmission_pars_fragment>',`
        #include <transmission_pars_fragment>
        #ifdef USE_TRANSMISSION
        vec3 tumblerSceneSample(vec3 localExit) {
          vec4 clip = projectionMatrix*viewMatrix*modelMatrix*vec4(localExit*${GLASS_LIP.scale},1.0);
          vec2 uv = clamp(.5+.5*clip.xy/max(.0001,clip.w),vec2(.001),vec2(.999));
          return getTransmissionSample(uv,.015,1.48).rgb;
        }
        #endif
      `)
      .replace('#include <transmission_fragment>',transmission)
      .replace('#include <opaque_fragment>',`
        {
        vec3 R = transformNormalByInverseViewMatrix(reflect(-normalize(vViewPosition),normal),viewMatrix);
        float opening = .22+.78*smoothstep(-.32,.69,dot(R,normalize(vec3(-.69,.65,.30))));
        float grazing = pow(1.0-clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0),5.0);
        float aa = max(.00035,fwidth(tumblerPoint.y)*.65);
        float radius = length(tumblerPoint.xz);
        float heelEdge = smoothstep(.025,.0305,radius);
        float rolledLip = smoothstep(.1109,.11215,tumblerPoint.y);
        float foot = 1.0-smoothstep(.00045,.00045+aa,abs(tumblerPoint.y-.0023));
        float innerFoot = 1.0-smoothstep(.00055,.00055+aa,abs(tumblerPoint.y-.0134));
        float azimuth = atan(tumblerPoint.z,tumblerPoint.x);
        float arch = pow(.5+.5*cos(2.0*azimuth+.72),1.6);
        float counterArch = pow(.5+.5*cos(3.0*azimuth-1.08),2.0);
        float waterHeight = dot(liquidPlane,vec4(tumblerPoint*${GLASS_LIP.scale},1.0));
        float waterAA = max(.00022,fwidth(waterHeight)*.5);
        float tide = heelEdge*(1.0-smoothstep(.00025,.0006+waterAA,abs(waterHeight)));
        float lowerTide = heelEdge*(1.0-smoothstep(.0002,.00055+waterAA,abs(waterHeight+.0011)));
        outgoingLight *= 1.0-.20*lowerTide;
        // Trace across the tapered wall to the rear meniscus and heel. Those edges
        // sit behind the front shell's depth, like the submerged stems in the transmission pass.
        vec3 nearNormal = normalize(vec3(tumblerPoint.x,-max(.0001,radius)*.078,tumblerPoint.z));
        vec3 sight = normalize(tumblerPoint-tumblerEye);
        vec3 immersed = refract(sight,nearNormal,1.0/1.333);
        float underwater = (1.0-smoothstep(-.001,.001,waterHeight))*smoothstep(.012,.015,tumblerPoint.y);
        vec3 path = normalize(mix(sight,immersed,underwater));
        float slopeY = .078*path.y;
        float travel = -2.0*(dot(tumblerPoint.xz,path.xz)-radius*slopeY)
          /max(.018,dot(path.xz,path.xz)-slopeY*slopeY);
        vec3 rear = tumblerPoint+path*clamp(travel,0.0,.17);
        float visibleRear = heelEdge*smoothstep(.001,.005,travel)
          *smoothstep(-.001,.0005,rear.y)*(1.0-smoothstep(.112,.114,rear.y));
        float rearWater = dot(liquidPlane,vec4(rear*${GLASS_LIP.scale},1.0));
        float rearAA = max(.00025,.54*fwidth(rear.y));
        float rearMeniscus = 1.0-smoothstep(.00028,.00075+.54*fwidth(rearWater),abs(rearWater));
        float rearHeel = 1.0-smoothstep(.00050,.00095+rearAA,abs(rear.y-.0134));
        float rearSole = 1.0-smoothstep(.00032,.00068+rearAA,abs(rear.y-.0023));
        float rearArc = .28+.72*pow(.5+.5*cos(2.0*atan(rear.z,rear.x)-.94),1.7);
        float solidHeel = smoothstep(.0008,.004,rear.y)*(1.0-smoothstep(.010,.014,rear.y));
        #ifdef USE_TRANSMISSION
        // The opaque pass contains the real tabletop and stems. Trace the underside
        // of the solid heel, then sample its transmitted and internally reflected paths.
        vec3 heelEntry = tumblerPoint;
        vec3 entryNormal = radius<.0305?vec3(0.0,1.0,0.0):nearNormal;
        vec3 heelRay = refract(sight,entryNormal,1.0/1.48);
        bool inHeel = tumblerPoint.y<=.0135;
        if (!inHeel && path.y<-.004) {
          float toFloor = (.0135-tumblerPoint.y)/path.y;
          vec3 floorHit = tumblerPoint+path*toFloor;
          if (toFloor<travel && length(floorHit.xz)<.0312) {
            inHeel = true;
            heelEntry = floorHit;
            heelRay = refract(path,vec3(0.0,1.0,0.0),mix(1.0,1.333,underwater)/1.48);
          }
        }
        if (inHeel && heelRay.y<-.004) {
          vec3 baseHit = heelEntry+heelRay*max(0.0,(.0008-heelEntry.y)/heelRay.y);
          float footprint = 1.0-smoothstep(.0305,.0323,length(baseHit.xz));
          if (footprint>.001) {
            vec3 baseN = normalize(vec3(baseHit.x*.8,1.0,baseHit.z*.8));
            vec3 exitRay = refract(heelRay,baseN,1.48);
            vec3 bounce = reflect(heelRay,baseN);
            vec3 innerExit = baseHit+bounce*(.0127/max(.035,bounce.y));
            float backWall = smoothstep(.026,.035,length(innerExit.xz));
            vec3 inwardN = -normalize(vec3(innerExit.x,-.00001,innerExit.z));
            vec3 exitN = normalize(mix(vec3(0.0,-1.0,0.0),inwardN,backWall));
            vec3 upwardRay = refract(bounce,exitN,1.48/mix(1.333,1.0,backWall));
            if (dot(upwardRay,upwardRay)<.001) upwardRay=reflect(bounce,exitN);
            vec3 returned = tumblerSceneSample(innerExit+upwardRay*.025);
            float fresnel = dot(exitRay,exitRay)<.001?1.0:.037+.963*pow(1.0-clamp(-dot(heelRay,baseN),0.0,1.0),5.0);
            vec3 through = tumblerSceneSample(baseHit+exitRay*.002);
            outgoingLight = mix(outgoingLight,mix(through,returned,fresnel),.86*footprint);
          }
        }
        #endif
        outgoingLight *= 1.0-visibleRear*.14*solidHeel;
        float glint = grazing*opening*.64*(1.0-rolledLip)
          +heelEdge*(foot*(.09+.89*arch)+innerFoot*(.08+.85*counterArch))
          +tide*(.08+.63*counterArch)
          +visibleRear*rearArc*(.54*rearMeniscus+.78*rearHeel+.49*rearSole+.11*solidHeel);
        outgoingLight += vec3(.88,.94,.89)*glint;
        #ifdef USE_ENVMAP
        if (rolledLip>0.0) {
          // The rolled profile sees different parts of the woodland panorama along
          // its two bevels. Keep the transmitted scene between the bright sky gaps.
          vec3 lipView = normalize(vViewPosition);
          vec3 lipShoulder = normalize(mat3(viewMatrix*modelMatrix)*vec3(tumblerPoint.x,.52*radius,tumblerPoint.z));
          vec3 lipNormal = normalize(normal+.28*lipShoulder);
          vec3 lipRadiance = getIBLRadiance(lipView,lipNormal,.055);
          float lipLuma = dot(lipRadiance,vec3(.2126,.7152,.0722));
          float lipSky = smoothstep(.105,.64,lipLuma);
          float lipFresnel = .042+.958*pow(1.0-clamp(abs(dot(lipView,lipNormal)),0.0,1.0),5.0);
          vec3 lipColour = totalDiffuse*mix(.80,1.0,lipSky)
            + totalSpecular*mix(.10,.82,lipSky)
            + lipRadiance*(lipFresnel+.20*lipSky);
          mat3 lipBasis = mat3(viewMatrix*modelMatrix);
          vec3 lipTangent = normalize(lipBasis*vec3(-tumblerPoint.z,0.0,tumblerPoint.x));
          vec3 lipRadial = normalize(lipBasis*vec3(tumblerPoint.x,0.0,tumblerPoint.z));
          float lipFront = dot(lipRadial,lipView);
          float alongRim = dot(lipTangent,lipView);
          float sideView = abs(alongRim)/max(.001,length(vec2(alongRim,lipFront)));
          // The far bevel faces the canopy through the opening. Only the side
          // shoulders retain a strong direct reflection there.
          float farReturn = smoothstep(.59,.96,sideView);
          float nearReturn = .18+.82*sideView*sideView;
          float bevelReturn = mix(farReturn,nearReturn,smoothstep(-.18,.18,lipFront))
            *mix(.83,1.0,smoothstep(.035,.35,lipLuma));
          #if NUM_DIR_LIGHTS > 0
            vec3 dayColour = directionalLights[0].color;
            float daylight = tumblerRimLobe(lipView,directionalLights[0].direction,lipTangent,lipRadial,5.0);
            lipColour += dayColour*(1.38*daylight*bevelReturn/(.90+dot(dayColour,vec3(.2126,.7152,.0722))));
          #endif
          #if NUM_RECT_AREA_LIGHTS > 0
            vec3 windowRay = rectAreaLights[0].position+vViewPosition;
            float windowAngle = atan(length(rectAreaLights[0].halfHeight),max(.01,length(windowRay)));
            float windowLobe = tumblerRimLobe(lipView,normalize(windowRay),lipTangent,lipRadial,1.0/max(.1,windowAngle));
            float nearShoulder = smoothstep(-.08,.70,lipFront);
            vec3 windowColour = rectAreaLights[0].color;
            lipColour += windowColour*(.53*windowLobe*nearShoulder*bevelReturn/(1.0+dot(windowColour,vec3(.2126,.7152,.0722))));
          #endif
          outgoingLight = mix(outgoingLight,lipColour,rolledLip);
        }
        #endif
        }
        #include <opaque_fragment>
      `)
  },[waterPlane,frame])
  useLayoutEffect(()=>{
    if(!(wall instanceof Mesh))return
    const lip=model.getObjectByName('glass_polished_lip'),outlet=model.getObjectByName('glass_pour_lip')
    const original=wall.geometry,outline=tumblerWall()
    const oldLipVisible=lip?.visible,oldOutlet=outlet?.position.clone()
    wall.geometry=outline
    // tumblerWall already models the rounded inner and outer folds of the lip.
    if(lip)lip.visible=false
    outlet?.position.set(-GLASS_LIP.radius,GLASS_LIP.height,0)
    const previous=new Map<Mesh,boolean>()
    model.traverse(o=>{if(o instanceof Mesh){previous.set(o,o.castShadow);o.castShadow=false}})
    return ()=>{
      wall.geometry=original
      if(lip&&oldLipVisible!==undefined)lip.visible=oldLipVisible
      if(outlet&&oldOutlet)outlet.position.copy(oldOutlet)
      previous.forEach((shadow,o)=>{o.castShadow=shadow})
      outline.dispose()
    }
  },[model,wall])
  if(!(wall instanceof Mesh))return null
  return createPortal(<meshPhysicalMaterial attach="material" metalness={0} depthWrite side={FrontSide}
    onBeforeCompile={optics}
    defines={defines} userData={{frameTransmission:!!frame}} transmission={frame?0:1} thickness={.005} ior={1.48} roughness={.018} envMapIntensity={.87}
    color="#ffffff" attenuationColor="#f0f6f2" attenuationDistance={.8}/>,wall)
}
