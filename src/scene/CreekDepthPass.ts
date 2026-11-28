import {Mesh,Scene,ShaderMaterial} from 'three'

/** Early depth only where the physical creek surface has full coverage. */
export function creekDepthPass(water:Mesh){
 const source=water.material
 if(!(source instanceof ShaderMaterial)||!source.uniforms.creekShoreDepthMap)return null
 const material=new ShaderMaterial({colorWrite:false,depthWrite:true,uniforms:source.uniforms,
  vertexShader:source.vertexShader,
  fragmentShader:`uniform sampler2D creekShoreDepthMap;uniform vec4 creekShoreWorldToUv;uniform float creekShoreLevel,time;
   varying vec3 wp;varying vec2 channel;varying vec2 metres;
   void main(){vec2 p=wp.xz;
    float farBank=smoothstep(-3.8,-3.4,p.x)*(1.-smoothstep(2.9,3.4,p.x))*smoothstep(-9.8,-9.2,p.y)*(1.-smoothstep(-4.5,-4.1,p.y))*(1.-smoothstep(.18,.27,channel.x));
    if(farBank>.001){vec2 shoreUv=(p-creekShoreWorldToUv.xy)*creekShoreWorldToUv.zw;
     vec2 packedDepth=texture2D(creekShoreDepthMap,clamp(shoreUv,0.,1.)).rg;
     float shallow=dot(packedDepth,vec2(255.*256.,255.))*4./65535.-2.+wp.y-creekShoreLevel;
     float edgeWave=.0012*sin(metres.y*26.7+metres.x*3.1-time*3.4);
     float coverage=mix(1.,smoothstep(.0015,.040+edgeWave,shallow),farBank);
     if(coverage<.9999)discard;
    }gl_FragColor=vec4(0.);
   }`})
 const scene=new Scene(),proxy=new Mesh(water.geometry,material);proxy.name='creek_opaque_depth';proxy.matrixAutoUpdate=false;scene.add(proxy)
 return {scene,sync(){water.updateWorldMatrix(true,false);proxy.matrix.copy(water.matrixWorld);proxy.matrixWorldNeedsUpdate=true;proxy.visible=true;for(let parent:Mesh|import('three').Object3D|null=water;parent;parent=parent.parent)proxy.visible&&=parent.visible},dispose(){material.dispose()}}
}
