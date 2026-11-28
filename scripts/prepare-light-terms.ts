/** Preserve fine shadow sampling; interpolate the smooth clearing envelope on
 * densely tessellated earth/rocks. Does not touch foliage, props or water. */
export function prepareLightTerms<T extends {vertex:string;fragment:string}>(shader:T):T{
 if(shader.vertex.includes('preparedLightTerms')||!shader.vertex.includes('varying float shaftAir;')||!shader.fragment.includes('float pathSunlight=sunOnPath(projected,canopyOpenings);'))return shader
 const functionBody=(name:string)=>{
  const start=shader.fragment.indexOf('float '+name+'('),brace=shader.fragment.indexOf('{',start)
  if(start<0||brace<0)throw Error('Missing prepared light function '+name)
  let level=1,end=brace+1
  while(level&&end<shader.fragment.length){if(shader.fragment[end]==='{')level++;if(shader.fragment[end]==='}')level--;end++}
  if(level)throw Error('Incomplete prepared light function')
  return shader.fragment.slice(start,end)
 }
 const declaration='varying vec3 preparedLightTerms;\n',assignment='woodlandSurface=(modelMatrix*woodlandVertex).xyz;'
 const functions=functionBody('opening')+'\n'+functionBody('sunOnPath')+'\n'
 let vertex=declaration+shader.vertex
 if(!vertex.includes('uniform sampler2D canopyOpenings;'))vertex='uniform sampler2D canopyOpenings;\n'+vertex
 vertex=vertex.replace('void main() {',functions+'void main() {').replace(assignment,assignment+`
  vec2 preparedProjection=woodlandSurface.xz+woodlandSurface.y*sunlightSlope;
  vec2 preparedNear=(woodlandSurface.xz-vec2(-3.7,-7.6))/vec2(1.15,2.6);
  vec2 preparedFar=(woodlandSurface.xz-vec2(-8.3,-17.5))/vec2(2.60,5.0);
  preparedLightTerms=vec3(sunOnPath(preparedProjection,canopyOpenings),
    bambooWindowDepth(cameraPosition,woodlandSurface),
    exp2(-1.55*dot(preparedNear,preparedNear))+1.32*exp2(-1.55*dot(preparedFar,preparedFar)));
 `)
 if(!vertex.includes(functions))throw Error('Missing shader entry point')
 const fragment=(declaration+shader.fragment)
  .replace('float pathSunlight=sunOnPath(projected,canopyOpenings);','float pathSunlight=preparedLightTerms.x;')
  .replace('float windowDepth=bambooWindowDepth(cameraPosition,woodlandSurface);','float windowDepth=preparedLightTerms.y;')
  .replace(/float openingBounce=exp2\(-1\.55\*dot\(nearShoulder,nearShoulder\)\)\s*\+1\.32\*exp2\(-1\.55\*dot\(farShoulder,farShoulder\)\);/,'float openingBounce=preparedLightTerms.z;')
 return {...shader,vertex,fragment}
}
