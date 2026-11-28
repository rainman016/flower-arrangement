import {InstancedMesh,Mesh,type Material} from 'three'

/** Compile the real vertex format without copying forest instance buffers. */
export function warmupMesh(source:Mesh,material:Material|Material[]=source.material){
  const proxy=source instanceof InstancedMesh?new InstancedMesh(source.geometry,material,0):source.clone(false)
  proxy.material=material
  if(source instanceof InstancedMesh&&proxy instanceof InstancedMesh){
    proxy.instanceMatrix=source.instanceMatrix
    proxy.instanceColor=source.instanceColor
    proxy.morphTexture=source.morphTexture
    proxy.count=source.count
    proxy.name=source.name
    proxy.receiveShadow=source.receiveShadow
  }
  return proxy
}
