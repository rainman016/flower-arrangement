import { Box3, Color, PerspectiveCamera, Quaternion, HalfFloatType, WebGLRenderTarget, Float32BufferAttribute, Matrix4, Mesh, NoToneMapping, ShaderMaterial, UniformsLib, Vector3, Vector4, type Camera, type Object3D, type Texture } from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import {canopyProjection,forestSun} from './CanopyLight.ts'
import {lowWoodlandQuality} from './render-quality.ts'
import type {HeightAt} from './terrain-height'
import {correctCreekMirrorDepth,creekBedCapture} from './CreekOptics.ts'
import {extendCreekFarWater} from './CreekFarShore.ts'
import {creekShoreDepth} from './CreekShoreDepth.ts'

// Imported river UV V repeats at an asset-dependent scale. Preserve the bend
// but measure its row-centre arc length and actual cross-channel width in metres.
export function creekMetricCoordinates(source:Mesh){
  const {position,uv}=source.geometry.attributes,rows=new Map<number,{left:Vector3;right:Vector3;distance:number}>(),point=new Vector3()
  for(let i=0;i<position.count;i++){
    const u=uv.getX(i);if(u>.001&&u<.999)continue
    const v=uv.getY(i),row=rows.get(v)??{left:new Vector3(),right:new Vector3(),distance:0}
    point.fromBufferAttribute(position,i).applyMatrix4(source.matrixWorld);row[u<.5?'left':'right'].copy(point);rows.set(v,row)
  }
  let distance=0,previous:Vector3|null=null
  for(const [,row] of [...rows].sort((a,b)=>a[0]-b[0])){
    const center=row.left.clone().lerp(row.right,.5)
    if(previous)distance+=center.distanceTo(previous)
    row.distance=distance;previous=center
  }
  const metres=new Float32Array(position.count*2)
  for(let i=0;i<position.count;i++){
    const row=rows.get(uv.getY(i));if(!row)continue
    metres[i*2]=(uv.getX(i)-.5)*row.left.distanceTo(row.right);metres[i*2+1]=row.distance
  }
  return metres
}

function stoneWaterlines(root:Object3D,level:number){
  const caps:Vector4[]=[],a=new Vector3(),b=new Vector3(),hit=new Vector3()
  root.traverse(node=>{
    if(!(node instanceof Mesh)||!node.userData.surfaceSource)return
    const box=new Box3().setFromObject(node)
    if(box.min.y>=level||box.max.y<=level+.008)return
    const {position}=node.geometry.attributes,index=node.geometry.index,count=index?.count??position.count
    box.makeEmpty()
    for(let i=0;i<count;i+=3){
      for(let edge=0;edge<3;edge++){
        const start=i+edge,end=i+(edge+1)%3
        a.fromBufferAttribute(position,index?index.getX(start):start).applyMatrix4(node.matrixWorld)
        b.fromBufferAttribute(position,index?index.getX(end):end).applyMatrix4(node.matrixWorld)
        if((a.y<level)===(b.y<level))continue
        box.expandByPoint(hit.lerpVectors(a,b,(level-a.y)/(b.y-a.y)))
      }
    }
    if(box.isEmpty())return
    box.getCenter(hit);box.getSize(a)
    caps.push(new Vector4(hit.x,hit.z,Math.max(.04,a.x*.5),Math.max(.04,a.z*.5)))
  })
  return caps.sort((a,b)=>Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y)).slice(0,8)
}

/** Planar reflection follows the player's view. Riverbed pebbles show through the shallow margin. */
export function streamSurface(source:Mesh,level:number,eye:Camera,time:{value:number},openings:Texture,heightAt:HeightAt|null,eave?:Vector3,stoneRoot:Object3D|null=source.parent){
  const pool=Boolean(eave),cachedMirror=lowWoodlandQuality&&!pool
  const bedCapture=pool?null:creekBedCapture(level,source)
  const shoreDepth=pool?null:creekShoreDepth(heightAt??(()=>level-.20),level)
  const shoreline=Boolean(source.userData.bankDistanceUV)
  const caps=pool||!stoneRoot?[]:stoneWaterlines(stoneRoot,level)
  const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld)
  const plantingRows=new Map<number,{left:number[];right:number[]}>(),plantingPoint=new Vector3()
  if(!pool)for(let i=0;i<geometry.attributes.position.count;i++){
    const u=geometry.attributes.uv.getX(i);if(u>.001&&u<.999)continue
    const v=geometry.attributes.uv.getY(i),row=plantingRows.get(v)??{left:[],right:[]}
    plantingPoint.fromBufferAttribute(geometry.attributes.position,i);row[u<.5?'left':'right']=plantingPoint.toArray();plantingRows.set(v,row)
  }
  if(!pool)extendCreekFarWater(geometry)
  const pos=geometry.attributes.position,depths=new Float32Array(pos.count)
  for(let i=0;i<pos.count;i++)depths[i]=heightAt?Math.max(0,level-heightAt(pos.getX(i),pos.getZ(i))):.20
  geometry.setAttribute('bedDepth',new Float32BufferAttribute(depths,1))
  geometry.setAttribute('streamMetres',new Float32BufferAttribute(pool?new Float32Array(pos.count*2):creekMetricCoordinates(source),2))
  geometry.translate(0,-level,0).rotateX(Math.PI/2)
  const reflectionScale=lowWoodlandQuality?.5:1
  const water=new Reflector(geometry,{textureWidth:(pool?768:cachedMirror?1280:1024)*reflectionScale,textureHeight:(pool?432:cachedMirror?720:576)*reflectionScale,clipBias:.0015,multisample:0,
    shader:{name:'Stream across the woodland',uniforms:{...UniformsLib.fog,...(pool?{}:UniformsLib.lights),tDiffuse:{value:null},creekPreviousMirror:{value:null},creekMirrorMix:{value:1},color:{value:new Color()},textureMatrix:{value:new Matrix4()},time:{value:0},
      creekBedMap:{value:null},creekBedDepth:{value:null},creekBedWorldToUv:{value:bedCapture?.worldToUv??new Vector4()},creekBedHeightRange:{value:bedCapture?.heightRange??new Vector3()},ior:{value:1.333},
      creekShoreDepthMap:{value:null},creekShoreWorldToUv:{value:shoreDepth?.worldToUv??new Vector4()},creekShoreLevel:{value:level},
      canopyOpenings:{value:openings},sunDirection:{value:new Vector3(...forestSun[pool?'rain':'creek']).normalize()},
      wetStones:{value:Array.from({length:8},(_,i)=>caps[i]??new Vector4())},wetStoneCount:{value:caps.length}},
      vertexShader:`uniform mat4 textureMatrix;uniform float time;attribute float bedDepth;attribute vec2 streamMetres;varying vec2 metres;varying float below;varying vec4 reflectionUv;varying vec3 wp;varying float across;varying vec2 channel;
      #include <fog_pars_vertex>
      ${pool?'':`#include <common>
      #include <shadowmap_pars_vertex>`}
      void main(){
        vec4 local=vec4(position,1.);below=bedDepth;metres=streamMetres;wp=(modelMatrix*local).xyz;channel=vec2(uv.x,1.-uv.y);across=${shoreline?'channel.y':'abs(uv.x-.5)*2.'};
        float wave=${pool?'0.':'.0015*sin(wp.z*5.6-wp.x*2.4-time*1.30)+.0007*sin(wp.z*10.4+wp.x*4.7-time*2.05)'};
        local.z+=wave;reflectionUv=textureMatrix*local;
        vec4 mvPosition=modelViewMatrix*local;gl_Position=projectionMatrix*mvPosition;
        ${pool?'':`vec4 worldPosition=modelMatrix*local;
        vec3 transformedNormal=mat3(viewMatrix)*vec3(0.,1.,0.);
        #include <shadowmap_vertex>`}
        #include <fog_vertex>
      }`,
      fragmentShader:`uniform sampler2D tDiffuse;uniform float time;varying vec4 reflectionUv;varying vec3 wp;varying float across;varying vec2 channel;varying vec2 metres;
      ${pool?'':`uniform sampler2D creekBedMap,creekBedDepth;uniform vec4 creekBedWorldToUv;uniform vec2 creekBedHeightRange;uniform float ior;uniform bool receiveShadow;
        uniform sampler2D creekShoreDepthMap;uniform vec4 creekShoreWorldToUv;uniform float creekShoreLevel;
        const int CREEK_RAY_STEPS=12;const int CREEK_REFINE_STEPS=5;
        vec2 creekBedUv(vec2 xz){return (xz-creekBedWorldToUv.xy)*creekBedWorldToUv.zw;}
        vec2 creekBedHeight(vec2 xz){
          vec2 uv=creekBedUv(xz);
          float valid=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
          float depth=texture2D(creekBedDepth,clamp(uv,0.,1.)).r;
          return vec2(mix(creekBedHeightRange.x,creekBedHeightRange.y,depth),valid*(1.-step(.999999,depth)));
        }`}
      uniform vec4 wetStones[8];uniform int wetStoneCount;uniform vec3 sunDirection;varying float below;
      ${canopyProjection(pool?'rain':'creek','time')}
      #include <fog_pars_fragment>
      ${pool?'':`#include <common>
      #include <packing>
      #include <shadowmap_pars_fragment>`}
      ${cachedMirror?'uniform sampler2D creekPreviousMirror;uniform float creekMirrorMix;':''}
      vec3 creekReflection(vec2 coord){
        vec3 current=texture2D(tDiffuse,coord).rgb;
        ${cachedMirror?'current=mix(texture2D(creekPreviousMirror,coord).rgb,current,creekMirrorMix);':''}
        return current;
      }
      float gaussian(float d){return exp(-d*d);}
      void main(){
        vec2 p=wp.xz;
        float a=${pool?'channel.y*6.35+channel.x*3.1+time*2.0':'metres.y*26.7+metres.x*3.1-time*3.4'}+sin(p.y*2.65)*.85;
        float b=${pool?'channel.y*13.8-channel.x*5.7+time*3.06':'metres.y*43.1-metres.x*5.7-time*4.7'}+.62*cos(p.x*2.7);
        float c=${pool?'channel.y*32.+channel.x*12.4+time*4.7':'metres.y*71.3+metres.x*12.4-time*6.1'};
        vec2 dx=dFdx(p),dy=dFdy(p);
        float det=dx.x*dy.y-dx.y*dy.x;
        vec2 along=vec2(dFdx(channel.y)*dy.y-dFdy(channel.y)*dx.y,dx.x*dFdy(channel.y)-dy.x*dFdx(channel.y));
        along=normalize(along*(det<0.?-1.:1.)+vec2(.00000001));
        // V runs upstream in this ribbon. Wakes must leave the downstream side.
        ${pool?'':'along=-along;'}
        float deep=smoothstep(.16,.42,below);
        float riffle=(1.-deep)*(.40+.60*smoothstep(-.3,.7,sin(p.x*1.7+p.y*.83)));
        vec2 tilt=along*(.024*cos(a)+.012*cos(b)+.004*cos(c))+vec2(-along.y,along.x)*.009*cos(b-.8*a);
        float capillary=${pool?'channel.y*69.+time*5.5+4.*sin(channel.x*7.+channel.y*2.1)':'metres.y*91.3-time*8.1+2.3*sin(metres.x*8.7+metres.y*2.1)'};
        tilt+=(along*.009*cos(capillary)+vec2(-along.y,along.x)*.014*sin(${pool?'channel.x*63.+channel.y*12.+time*2.7':'metres.x*63.+metres.y*12.-time*2.7'}))*(.46+.54*riffle);
        float wakeFlash=0.;float sheltered=0.;vec2 wakeSlope=vec2(0.);
        ${pool?'':`vec2 side=vec2(-along.y,along.x);
          for(int i=0;i<8;i++){
            if(i>=wetStoneCount)break;
            vec4 stone=wetStones[i];vec2 gap=p-stone.xy;
            float u=dot(gap,along),v=dot(gap,side);
            float width=1./length(side/stone.zw),lengthwise=1./length(along/stone.zw);
            float edge=length(gap/stone.zw)-1.;
            // Flow reaches the nose first. Side streaks accelerate past the flanks;
            // the eddy pocket behind the rock has weaker background ripples.
            float relative=u/lengthwise;
            float brush=.012+.036*width;
            float bow=gaussian((edge-.045)*width/brush)*(1.-smoothstep(-.70,.02,relative));
            float flank=gaussian((abs(v)-width*(1.03-.16*relative*relative))/(brush*1.48))
              *smoothstep(-.88,-.32,relative)*(1.-smoothstep(.38,1.08,relative));
            float travel=max(u-.34*lengthwise,0.);
            float widthDown=width*.86+.12*travel;
            float decay=exp(-travel/(.18+2.30*width));
            float tail=smoothstep(.30,.91,relative)*decay
              *gaussian((abs(v)-widthDown)/(.018+.065*width+.025*travel));
            float pocket=smoothstep(.63,1.10,relative)*decay*(1.-smoothstep(.20,.89,abs(v)/widthDown));
            sheltered=max(sheltered,pocket);
            float sideBeat=.5+.5*sin(u*32.+sign(v)*.8-time*5.4+.48*cos(v*13.));
            float wakeBeat=.5+.5*cos(travel*24.-abs(v)*8.5-time*3.1+.8*sin(travel*9.+sign(v)));
            wakeSlope+=along*(.085*bow+.047*tail*(2.*wakeBeat-1.))
              +side*sign(v)*(.09*bow+.14*flank*(.42+.58*sideBeat)+.09*tail*(2.*wakeBeat-1.));
            wakeFlash+=bow*(.57+.24*sideBeat)+flank*(.10+.42*sideBeat*sideBeat)+tail*.48*wakeBeat*wakeBeat;
          }`}
        float rippleRim=0.;
        ${pool?`vec2 grid=p*4.9,cell=floor(grid),q=fract(grid)-.5;
          float seed=fract(sin(dot(cell,vec2(37.13,91.72)))*4385.33);
          q-=vec2(seed-.5,fract(seed*13.42)-.5)*.31;
          float t=fract(time*(.57+.24*seed)+seed),radius=length(q),band=radius-t*(.32+.16*seed);
          float exposed=1.-smoothstep(${(eave?.z??0).toFixed(3)}-.12,${(eave?.z??0).toFixed(3)}+.02,p.y);
          float pulse=cos(band*104.)*exp(-band*band*490.)*(1.-t);
          tilt=exposed*.13*normalize(q+vec2(.0001))*pulse;
          rippleRim=exposed*max(0.,pulse)*(.24+.76*seed);
        `:''}
        ${pool?'':`float thread=metres.y*37.4-time*5.4+1.35*sin(metres.x*11.+p.y*.94)+.65*sin(metres.y*2.31);
          float run=.5+.5*sin(p.x*1.8+p.y*.64+sin(p.y*1.07));
          tilt+=along*(.006+.019*run)*cos(thread)+side*.012*sin(thread*.56+p.x*12.);
          // Unequal packets of centimetre-scale downstream riffles divide the
          // right-hand tree silhouettes; quieter lanes remain between packets.
          float rightRun=smoothstep(.55,1.45,p.x)*(1.-smoothstep(4.8,6.1,p.x))
            *smoothstep(-6.3,-5.0,p.y)*(1.-smoothstep(-1.0,.2,p.y));
          // Short cross-current facets share a long crest in world X. At the
          // seated eye this yields thin horizontal cuts through the true sky
          // columns, rather than large twisting vertical ribbons. Coordinates
          // remain in metres when the player looks elsewhere.
          float finePhase=p.y*109.7+p.x*5.4-time*6.8+.28*sin(p.x*3.2+p.y*.63);
          float thinPhase=p.y*163.1-p.x*8.7-time*8.4+.34*sin(p.x*2.1-p.y*.49);
          float packet=.22+.78*smoothstep(.18,.82,.5+.5*sin(p.x*14.7+p.y*1.3+.5*sin(p.y*2.2)-time*.6));
          float resolved=1.-smoothstep(.8,2.8,fwidth(finePhase));
          float fineResolved=1.-smoothstep(.8,2.8,fwidth(thinPhase));
          vec2 fineTilt=vec2(.012*cos(finePhase)*resolved+.004*cos(thinPhase)*fineResolved,.0028*sin(thinPhase)*fineResolved);
          tilt=mix(tilt,tilt*.32+fineTilt*packet,rightRun);
          tilt*=.60+.40*riffle;
          tilt=tilt*(1.-.65*sheltered)+wakeSlope;
        `}
        vec3 N=normalize(vec3(tilt.x,1.,tilt.y)),V=normalize(cameraPosition-wp);
        float shore=smoothstep(.60,.96,across);
        vec2 mirrorBend=mat2(viewMatrix[0].x,viewMatrix[0].y,viewMatrix[2].x,viewMatrix[2].y)*tilt;
        vec2 coord=reflectionUv.xy/reflectionUv.w+mirrorBend*(${pool?'.028':'mix(.16+.055*shore,.12+.025*shore,rightRun)'}+${pool?'.005':'.012'}/(1.+length(cameraPosition-wp)));
        ${pool?'':`// Ripple facets break the reflected grove into short cross-stream
          // fragments. The existing reflection supplies every bright and dark colour.
          float narrowWave=.67*sin(finePhase+.44*sin(p.x*12.+p.y*2.3))+.33*sin(thinPhase);
          float frontWindow=rightRun*(.42+.58*packet);
          coord+=frontWindow*vec2(.009*narrowWave*resolved,.0024*sin(thinPhase)*fineResolved);`}
        vec3 reflected=creekReflection(clamp(coord,.003,.997));
        ${pool?'':`// Retain the captured tree/sky boundary. Broad five-tap blur
          // flattened the real reflected crowns into a blue-green slab.
          vec2 blur=vec2(${(.45/(1024*reflectionScale)).toFixed(8)},0.);
          reflected=reflected*.80
            +creekReflection(clamp(coord+blur,.003,.997))*.10
            +creekReflection(clamp(coord-blur,.003,.997))*.10;
          // Compress only HDR peaks; preserve dim tree colour and the actual
          // contrast of sky openings. Wave normals move these captured edges.
          float mirrorLuma=dot(reflected,vec3(.2126,.7152,.0722));
          reflected/=1.+.90*max(0.,mirrorLuma-.72);
          float skyOpening=smoothstep(.14,.63,dot(reflected,vec3(.2126,.7152,.0722)));
          reflected*=1.+1.3*rightRun*skyOpening;
        `}
        float margin=smoothstep(.61,.95,across);
        ${shoreline?`float skyValue=dot(reflected,vec3(.21,.72,.07));
          reflected=mix(reflected,skyValue*vec3(.82,.97,1.03),.38)*(.43+.38*margin);
          reflected/=1.+max(0.,skyValue-.23)*1.47*(1.-margin);
          rippleRim*=.27+.73*margin;`:''}
        float incidence=1.-clamp(dot(N,V),0.,1.);
        float fresnel=${pool?'.085+.86*pow(incidence,2.55)':'.022+.96*pow(incidence,mix(4.6,3.3,deep))'};
        float openSky=leafOpening(wp);
        ${pool?`float depth=1.-smoothstep(.42,.96,across),absorption=${shoreline?'.12+.60*depth':'.17+.32*depth'};
        float glint=pow(max(dot(N,normalize(V+sunDirection)),0.),116.)*(.06+.94*openSky);
        float dissolved=(1.-fresnel)*absorption,alpha=min(.98,dissolved+fresnel);
        vec3 light=(reflected*fresnel+vec3(.016,.040,.036)*dissolved+vec3(.69,.81,.83)*rippleRim*.22+vec3(1.,.91,.73)*glint*${shoreline?'(.018+.10*margin)':'.19'})/alpha;
        ${shoreline?`float skyGlint=pow(max(dot(N,normalize(V+normalize(vec3(.32,.38,-.87)))),0.),115.);
          // A broken reflection on shallow shelves, strongest where rain disturbs
          // a sky-facing patch. The middle of the pool keeps its dark reflection.
          float shelf=margin*(1.-smoothstep(.032,.16,below));
          float windowLight=smoothstep(.21,.66,openSky+.08*sin(5.3*p.x+4.1*p.y+.76*sin(p.y*7.)));
          light+=reflected*shelf*windowLight*(.12+.38*rippleRim);
          light+=vec3(.71,.86,.91)*skyGlint*margin*(.020+.20*rippleRim);`:''}
        gl_FragColor=vec4(light,alpha);`:`
          // Intersect the refracted world ray with heights captured from above.
          // A foreground bank cannot occlude a sample from another bed location.
          vec3 bentRay=refract(-V,N,1./ior);
          // Follow the first surface crossing. Fixed-point iteration can jump
          // over a shallow bar and converge onto the deeper bed behind it.
          float limit=max(0.,(wp.y-creekBedHeightRange.y)/max(.34,-bentRay.y));
          float nearHit=0.,farHit=limit,bedValid=0.;
          for(int stepIndex=1;stepIndex<=CREEK_RAY_STEPS;stepIndex++){
            float travel=limit*float(stepIndex)/float(CREEK_RAY_STEPS);
            vec3 probe=wp+bentRay*travel;vec2 bedHeight=creekBedHeight(probe.xz);
            if(bedHeight.y>.5&&probe.y<=bedHeight.x){farHit=travel;bedValid=1.;break;}
            nearHit=travel;
          }
          for(int stepIndex=0;stepIndex<CREEK_REFINE_STEPS;stepIndex++){
            float travel=(nearHit+farHit)*.5;vec3 probe=wp+bentRay*travel;
            vec2 bedHeight=creekBedHeight(probe.xz);
            if(bedHeight.y>.5&&probe.y<=bedHeight.x)farHit=travel;else nearHit=travel;
          }
          float distanceInWater=(nearHit+farHit)*.5;
          vec3 bedPoint=wp+bentRay*distanceInWater;
          vec2 finalHeight=creekBedHeight(bedPoint.xz);
          bedValid*=finalHeight.y*(1.-smoothstep(.025,.12,abs(bedPoint.y-finalHeight.x)));
          vec4 bedSample=texture2D(creekBedMap,clamp(creekBedUv(bedPoint.xz),0.,1.));
          bedSample.a*=bedValid;
          // Clear shallow shelves keep the ochre mineral colour. Absorption grows
          // with the real ray length, leaving cool tree/sky reflection in the run.
          vec3 through=exp(-distanceInWater*vec3(2.25,1.35,2.10));
          vec3 volume=vec3(.009,.022,.008)*(.78+.28*openSky);
          vec3 bed=mix(volume,bedSample.rgb,bedSample.a);
          vec3 river=mix(volume,bed,through)*(1.-fresnel)+reflected*fresnel;
          float nh=max(dot(N,normalize(V+sunDirection)),0.);
          float rough=.034+.028*run+.035*min(wakeFlash,1.);
          float lobe=rough/max(.002,1.-nh*nh*(1.-rough*rough));
          float directSun=1.;
          #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            DirectionalLightShadow shadow=directionalLightShadows[0];
            if(receiveShadow)directSun=getShadow(directionalShadowMap[0],shadow.shadowMapSize,shadow.shadowIntensity,shadow.shadowBias,shadow.shadowRadius,vDirectionalShadowCoord[0]);
          #endif
          float capPhase=dot(p,along)*119.+sin(dot(p,side)*39.)*1.7-time*5.9;
          float glintPatch=smoothstep(.67,.91,.5+.5*sin(metres.x*17.3+metres.y*2.7-time*.73));
          float sparkle=pow(max(0.,cos(capPhase)),16.)*glintPatch*(1.-smoothstep(.6,3.,fwidth(capPhase)));
          float reflectedSun=min(3.4,lobe*lobe)*(.003+.11*openSky)*(.015+.985*sparkle)*directSun;
          river+=mix(vec3(.73,.82,.78),vec3(1.,.88,.64),openSky)*reflectedSun;
          float brokenLight=(.30+.70*fresnel)*(.52+.48*directSun);
          river+=mix(vec3(.34,.43,.40),vec3(.78,.79,.64),openSky)*wakeFlash*brokenLight;
          float waterCoverage=1.;
          float farBank=smoothstep(-3.8,-3.4,p.x)*(1.-smoothstep(2.9,3.4,p.x))
            *smoothstep(-9.8,-9.2,p.y)*(1.-smoothstep(-4.5,-4.1,p.y))*(1.-smoothstep(.18,.27,channel.x));
          if(farBank>.001){
            vec2 shoreUv=(p-creekShoreWorldToUv.xy)*creekShoreWorldToUv.zw;
            vec2 packedDepth=texture2D(creekShoreDepthMap,clamp(shoreUv,0.,1.)).rg;
            float shallow=dot(packedDepth,vec2(255.*256.,255.))*4./65535.-2.+wp.y-creekShoreLevel;
            float edgeWave=.0012*sin(metres.y*26.7+metres.x*3.1-time*3.4);
            float thinFilm=smoothstep(.0015,.040+edgeWave,shallow);
            waterCoverage=mix(1.,thinFilm,farBank);
          }
          gl_FragColor=vec4(river,waterCoverage);
        `}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`}})
  water.rotation.x=-Math.PI/2;water.position.y=level;water.name=source.name
  if(!pool)water.userData.creekPlantingRows=[...plantingRows.values()]
  water.userData.stoneWaterlines=caps.map(v=>v.toArray())
  const material=water.material as ShaderMaterial
  material.uniforms.time=time;material.transparent=true;material.depthWrite=false;material.fog=true
  material.lights=!pool
  // Reflector clones its uniforms, including textures. Use the live bed target.
  if(bedCapture){material.uniforms.creekBedMap.value=bedCapture.target.texture;material.uniforms.creekBedDepth.value=bedCapture.target.depthTexture}
  if(shoreDepth)material.uniforms.creekShoreDepthMap.value=shoreDepth.texture
  if(bedCapture)water.userData.creekBedCache=bedCapture.stats
  water.userData.creekOptics=bedCapture?'world-xz-hdr-depth-atlas+oblique-mirror':'rain-pool'
  if(bedCapture)water.userData.creekBedAtlas={size:[bedCapture.target.width,bedCapture.target.height],worldToUv:bedCapture.worldToUv.toArray(),heightRange:bedCapture.heightRange.toArray()}
  const mirrorTarget=water.getRenderTarget(),previousMirror=cachedMirror?new WebGLRenderTarget(mirrorTarget.width,mirrorTarget.height,{type:HalfFloatType,depthBuffer:false}):null
  if(previousMirror)material.uniforms.creekPreviousMirror.value=previousMirror.texture
  water.userData.warmOptics=(renderer:Parameters<typeof water.onBeforeRender>[0])=>{
    renderer.initRenderTarget(mirrorTarget)
    if(previousMirror)renderer.initRenderTarget(previousMirror)
    if(bedCapture)renderer.initRenderTarget(bedCapture.target)
  }
  const mirrorStats={renders:0,reused:0,viewUpdates:0,blends:0}
  water.userData.creekMirrorCache=mirrorStats
  const dispose=water.dispose.bind(water)
  water.dispose=()=>{previousMirror?.dispose();bedCapture?.dispose();shoreDepth?.texture.dispose();dispose()}
  const render=water.onBeforeRender.bind(water),view=new Matrix4(),projection=new Matrix4()
  const mirrorEye=cachedMirror&&eye instanceof PerspectiveCamera?eye.clone():null,rotation=new Quaternion(),savedRotation=new Quaternion()
  let last=-1,lastPass=-Infinity,blending=false
  water.onBeforeRender=(...args)=>{
    const camera=args[2]
    if(camera!==eye)return
    const viewChanged=!view.equals(camera.matrixWorld),projectionChanged=!projection.equals(camera.projectionMatrix)
    rotation.setFromRotationMatrix(camera.matrixWorld)
    const translated=[12,13,14].some(i=>view.elements[i]!==camera.matrixWorld.elements[i])
    // Planar reflection rays depend on the eye position, not the head direction.
    // A wider real capture stays valid during small rotations, without reprojection
    // lag or a locked view. Leave angular margin for the wave-normal offsets.
    const moved=projectionChanged||(mirrorEye?translated||rotation.angleTo(savedRotation)>.16:viewChanged)
    const bedUpdated=bedCapture?.capture(args[0],args[1])??false
    if(blending)material.uniforms.creekMirrorMix.value=Math.min(1,Math.max(0,(time.value-last)/.46))
    // The viewpoint is unchanged while carrying an object. Blend real forest
    // captures; wave normals/refraction still run every frame. Moving the eye or
    // projection immediately replaces the capture and disables temporal blending.
    if(!moved&&!bedUpdated&&time.value-last<(cachedMirror?1.15:.14)){mirrorStats.reused++;return}
    const now=performance.now()
    if(!moved&&!bedUpdated&&lowWoodlandQuality&&time.value!==last&&now-lastPass<65)return
    if(previousMirror&&mirrorStats.renders===0)args[0].initRenderTarget(previousMirror)
    blending=Boolean(previousMirror&&!viewChanged&&!projectionChanged&&!bedUpdated&&last>=0&&time.value-last<2.)
    if(blending&&previousMirror){args[0].copyTextureToTexture(mirrorTarget.texture,previousMirror.texture);mirrorStats.blends++}
    material.uniforms.creekMirrorMix.value=blending?0:1
    mirrorStats.renders++;if(moved)mirrorStats.viewUpdates++
    lastPass=now;last=time.value;view.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);savedRotation.copy(rotation)
    if(bedCapture)correctCreekMirrorDepth(args[1])
    const outsideOnly=lowWoodlandQuality?args[1].getObjectByName('workbench_and_tools'):undefined
    const shown=outsideOnly?.visible
    if(outsideOnly)outsideOnly.visible=false
    const tone=args[0].toneMapping
    const shell=bedCapture?args[1].getObjectByName('woodland_distance_surfaces'):undefined
    const grove=shell?.visible?args[1].getObjectByName('creek_mirror_grove'):undefined
    const groveShown=grove?.visible,shellShown=shell?.visible
    if(grove&&shell){grove.visible=true;shell.visible=false}
    if(!pool)args[0].toneMapping=NoToneMapping
    if(mirrorEye&&camera instanceof PerspectiveCamera){mirrorEye.copy(camera,false);mirrorEye.fov=2*Math.atan(Math.tan(camera.fov*Math.PI/360)*1.6)*180/Math.PI;mirrorEye.updateProjectionMatrix()}
    try{if(mirrorEye)render(args[0],args[1],mirrorEye,args[3],args[4],args[5]);else render(...args)}finally{
      args[0].toneMapping=tone;if(outsideOnly)outsideOnly.visible=shown!
      if(grove&&shell){grove.visible=groveShown!;shell.visible=shellShown!}
    }
  }
  return water
}
