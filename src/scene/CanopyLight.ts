import {CanvasTexture, RepeatWrapping, type MeshStandardMaterial, type Texture} from 'three'
import type {SceneId} from '../game/types'

export const forestSun={
  bamboo:[-5.7,4.7,-9.7],rain:[-5,8,-4.5],creek:[-4.1,4.4,-8.6]
} as const

export function canopyProjection(id:SceneId,clock?:string){
  const [x,y,z]=forestSun[id]
  return `uniform sampler2D canopyOpenings;
    float leafOpening(vec3 world){
      vec2 p=world.xz-world.y*vec2(${(x/y).toFixed(4)},${(z/y).toFixed(4)});
      vec2 q=mat2(.91,-.415,.415,.91)*p;
      ${clock&&id!=='rain'?`q+=vec2(.046*sin(${clock}*.57+p.y*.71),.033*sin(${clock}*.39+p.x*.50));
        p+=vec2(.073*sin(${clock}*.66+q.y),.049*sin(${clock}*.43+q.x));`:''}
      float clustered=texture2D(canopyOpenings,q*.122+vec2(.27,.61)).r;
      float detail=texture2D(canopyOpenings,mat2(.74,.67,-.67,.74)*p*.235+vec2(.64,.32)).r;
      return smoothstep(.12,.97,clustered*.72+detail*.28);
    }`
}

// Attenuate only incident sunlight. Indirect skylight remains in the leaf shadows.
export function filterWoodlandSun(material:MeshStandardMaterial,openings:Texture,id:SceneId,leaf:boolean,lamina:boolean,skyView:Texture|null,dryTissue:boolean,time:{value:number}){
  const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey()
  material.onBeforeCompile=(s,renderer)=>{
    previous(s,renderer);s.uniforms.canopyOpenings={value:openings}
    s.uniforms.canopyWindClock=time
    if(skyView)s.uniforms.woodlandSkyView={value:skyView}
    const skyVarying=skyView?'varying float woodlandAmbientShade;':''
    s.vertexShader=skyVarying+(skyView?'uniform sampler2D woodlandSkyView;':'')+'varying vec3 canopySurface;\n'+s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec4 surfacePoint=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      surfacePoint=instanceMatrix*surfacePoint;
      #endif
      canopySurface=(modelMatrix*surfacePoint).xyz;
      ${skyView?`vec2 skyColumn=texture2D(woodlandSkyView,(canopySurface.xz+vec2(16.,29.))/32.).rg;
        woodlandAmbientShade=(1.-skyColumn.r)*smoothstep(-.25,1.1,skyColumn.g*32.-8.-canopySurface.y);`:''}`)
    if(dryTissue){
      // Phase is constant along a blade. Its age and colour travel with it in the wind.
      s.vertexShader='varying float tissueAge;\n'+s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
        float plantSeed=.37;
        #ifdef USE_INSTANCING
          plantSeed+=dot(instanceMatrix[3].xz,vec2(2.17,5.32));
        #endif
        tissueAge=.5+.5*sin(plantSeed+_phase*3.73);`)
      s.fragmentShader='varying float tissueAge;\n'+s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        diffuseColor.rgb*=mix(vec3(.81,.87,.70),vec3(1.16,1.08,.85),tissueAge);
        if(!gl_FrontFacing)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.27,.59,.14))),.15);`)
    }
    s.fragmentShader='uniform float canopyWindClock;\n'+canopyProjection(id,'canopyWindClock')+skyVarying+'\nvarying vec3 canopySurface;\n'+s.fragmentShader
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        float filtered=mix(${id==='rain'?'.79':'.28'},1.09,leafOpening(canopySurface));
        ${id==='rain'?`float eaveShade=(1.-smoothstep(2.9,4.1,abs(canopySurface.x+.6)))*
            smoothstep(-5.0,-1.16,canopySurface.z)*(1.-smoothstep(.9,2.3,canopySurface.y));
          filtered*=1.-.33*eaveShade;
          reflectedLight.indirectDiffuse*=1.-.18*eaveShade;`:''}
        reflectedLight.directDiffuse*=filtered;
        reflectedLight.directSpecular*=filtered;
        ${skyView?`reflectedLight.indirectDiffuse*=mix(vec3(1.),vec3(.43,.52,.45),woodlandAmbientShade);
          reflectedLight.indirectSpecular*=1.-.48*woodlandAmbientShade;`:''}
        ${lamina?`// Dry leaf cuticle catches a short reflection in direct light. Shaded tissue
          // reflects mostly skylight filtered by the neighbouring canopy.
          reflectedLight.directSpecular*=.61;
          reflectedLight.indirectSpecular*=vec3(.54,.57,.39);
          reflectedLight.indirectDiffuse*=vec3(1.12,1.13,.78);`:''}`)
    if(leaf){
      s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        float bladeWet=.5+.5*sin(dot(canopySurface,vec3(17.,9.,13.))+.68*sin(canopySurface.y*31.));
        roughnessFactor*=mix(${id==='rain'?'.48,.90':'.79,1.'},bladeWet);`)
        .replace('#include <opaque_fragment>',`vec3 leafNormal=inverseTransformDirection(normal,viewMatrix);
          vec3 skyDirection=normalize(vec3(${forestSun[id].map(v=>v.toFixed(2)).join(',')}));
          float transmission=max(0.,dot(-leafNormal,skyDirection))*(.24+.76*leafOpening(canopySurface));
          ${lamina?`float visibility=1.;
            #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
              DirectionalLightShadow shade=directionalLightShadows[0];
              visibility=getShadow(directionalShadowMap[0],shade.shadowMapSize,shade.shadowIntensity,shade.shadowBias,shade.shadowRadius,vDirectionalShadowCoord[0]);
            #endif
            float towardSun=max(0.,dot(normalize(canopySurface-cameraPosition),skyDirection));
            float midrib=abs(vMapUv.x-.50);
            float thinTissue=.52+.48*smoothstep(.012,.26,midrib);
            outgoingLight+=diffuseColor.rgb*vec3(1.60,1.62,.40)*thinTissue*transmission*(${dryTissue?'.08+1.46':'.31+1.83'}*visibility)*(.65+.62*towardSun);`:
            `outgoingLight+=diffuseColor.rgb*vec3(.95,1.09,.54)*transmission*${id==='rain'?'.27':'.68'};`}
          ${id==='rain'?`vec3 reflectedSky=reflect(normalize(canopySurface-cameraPosition),leafNormal);
            float film=pow(max(0.,dot(reflectedSky,normalize(vec3(-.49,.85,-.22)))),17.);
            outgoingLight+=vec3(.15,.20,.22)*film*(1.-.62*bladeWet);`:''}
          #include <opaque_fragment>`)
      if(lamina){
        s.fragmentShader=s.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
          #ifdef USE_FOG
            // Air between successive ranks of foliage reduces the contrast of small distant silhouettes.
            float leafHaze=.085*smoothstep(11.,34.,vFogDepth)*(1.-fogFactor);
            gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,leafHaze);
          #endif`)
      }
    }
  }
  material.customProgramCacheKey=()=>key+'-filtered-forest-'+id+'-'+leaf+'-'+lamina+'-'+Boolean(skyView)+'-'+dryTissue
}

// Both foliage and the projector use identical immutable pixels. Texture clones
// share the source while keeping independent transforms and disposal lifetimes.
let canopyTemplate:CanvasTexture|undefined
// A fixed canopy opening modulates the local sun; movable geometry still casts its own shadow.
export function canopyLight(){
  if(canopyTemplate)return canopyTemplate.clone()
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512
  const g=canvas.getContext('2d')!
  let seed=19283
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  g.fillStyle='white';g.fillRect(0,0,512,512);g.filter='blur(2.8px)'
  for(let i=0;i<118;i++){
    const x=rand()*640-64,y=rand()*620-56
    const angle=rand()*Math.PI*2,length=12+rand()*42
    for(let j=0;j<10;j++){
      const u=j/10,a=angle+(j%2?-.68:.68),px=x+Math.cos(angle)*length*u,py=y+Math.sin(angle)*length*u
      g.beginPath();g.ellipse(px+Math.cos(a)*7,py+Math.sin(a)*7,6+rand()*12,2+rand()*4,a,0,Math.PI*2)
      g.fillStyle='rgba(15,18,20,.73)';g.fill()
    }
  }
  const texture=new CanvasTexture(canvas);texture.wrapS=texture.wrapT=RepeatWrapping
  canopyTemplate=texture
  return texture.clone()
}
