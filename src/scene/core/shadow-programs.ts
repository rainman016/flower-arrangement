import {BackSide,DoubleSide,FrontSide,Group,Mesh,MeshDepthMaterial,type Material,type MeshStandardMaterial,type Scene} from 'three'

/** Submit the same PCF depth variants that Three chooses on the first shadow draw. */
export function shadowPrograms(scene:Scene){
 const group=new Group(),owned:Material[]=[],sides=[BackSide,FrontSide,DoubleSide]
 scene.traverseVisible(object=>{
  if(!(object instanceof Mesh)||!object.castShadow)return
  const source=object.material
  if(Array.isArray(source))return
  const surface=source as MeshStandardMaterial,original=object.customDepthMaterial
  const depth=original?original.clone() as MeshDepthMaterial:new MeshDepthMaterial()
  if(original){depth.onBeforeCompile=original.onBeforeCompile;depth.customProgramCacheKey=()=>original.customProgramCacheKey()}
  depth.side=surface.shadowSide??sides[surface.side]
  depth.map=surface.map;depth.alphaMap=surface.alphaMap;depth.alphaTest=surface.alphaToCoverage?.5:surface.alphaTest
  depth.displacementMap=surface.displacementMap;depth.displacementScale=surface.displacementScale;depth.displacementBias=surface.displacementBias
  depth.clipShadows=surface.clipShadows;depth.clippingPlanes=surface.clippingPlanes;depth.clipIntersection=surface.clipIntersection
  depth.visible=surface.visible;depth.wireframe=surface.wireframe
  const proxy=object.clone(false);proxy.material=depth;group.add(proxy);owned.push(depth)
 })
 return {group,dispose:()=>{for(const material of owned)material.dispose();group.clear()}}
}
