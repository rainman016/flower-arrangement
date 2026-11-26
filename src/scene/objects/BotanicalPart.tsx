import { useEffect, useMemo } from 'react'
import { Mesh, MeshStandardMaterial, Object3D } from 'three'

import { wildflowerHead } from '../core/wildflower-head'

/** Clone transforms only; share loaded geometry/textures. Highlight materials are owned locally. */
export default function BotanicalPart({kit,name,highlight=false}:{kit:Object3D;name:string;highlight?:boolean}){
  const model=useMemo(()=>{
    const generated=name==='flower_daisy_head'
    const source=generated?wildflowerHead(true,true):kit.getObjectByName(name)
    if(!source)throw new Error('缺少花材模型 '+name)
    const object=source.clone(true),owned:MeshStandardMaterial[]=[]
    object.position.set(0,0,0)
    object.traverse(child=>{
      if(!(child instanceof Mesh))return
      child.castShadow=true;child.receiveShadow=true
      if(highlight){
        const mark=(material:MeshStandardMaterial)=>{
          const copy=material.clone();copy.emissive.set('#b76924');copy.emissiveIntensity=.5;owned.push(copy);return copy
        }
        child.material=Array.isArray(child.material)?child.material.map(mark):mark(child.material)
      }
    })
    return {object,owned,generated}
  },[kit,name,highlight])
  useEffect(()=>()=>{model.owned.forEach(material=>material.dispose());if(model.generated)model.object.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose()})},[model])
  return <primitive object={model.object} dispose={null}/>
}
