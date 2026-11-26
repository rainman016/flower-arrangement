import { useMemo } from 'react'
import { BackSide, type Texture } from 'three'
import { TABLE_VIEW } from '../content/scene-view'

/** A small mirrored edge feather removes hard wrap lines in generated LDR environments.
 * This is a rendering transition, not a claim of reconstructed geometric continuity.
 * The original bitmap remains untouched. The same blend is in the Blender world material.
 */
const vertexShader=`varying vec2 vUv;
void main(){vUv=vec2(1.0-uv.x,uv.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const fragmentShader=`uniform sampler2D panorama; varying vec2 vUv;
void main(){
  float distanceToEdge=min(vUv.x,1.0-vUv.x);
  float blend=.5*(1.0-smoothstep(0.0,.025,distanceToEdge));
  vec3 current=texture2D(panorama,vUv).rgb;
  vec3 wrapped=texture2D(panorama,vec2(1.0-vUv.x,vUv.y)).rgb;
  gl_FragColor=vec4(mix(current,wrapped,blend),1.0);
  #include <colorspace_fragment>
}`
export default function Panorama({texture}:{texture:Texture}){
  const uniforms=useMemo(()=>({panorama:{value:texture}}),[texture])
  return <mesh position={TABLE_VIEW.eye} rotation={[0,Math.PI/2,0]} renderOrder={-1000} raycast={()=>null}>
    <sphereGeometry args={[40,64,32]}/>
    <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} side={BackSide} depthWrite={false} depthTest={false} toneMapped={false}/>
  </mesh>
}
