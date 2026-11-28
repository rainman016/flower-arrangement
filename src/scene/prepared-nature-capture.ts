import {Material,Mesh,Object3D,ShaderLib,type ShaderMaterial} from 'three'

type Clock={value:number}
export type PreparedShader={vertex:string;fragment:string;uniforms:Record<string,{value:unknown}>;clocks:string[];key:string}
export type NatureCapture={root:Object3D;clock:Clock;shaders:Map<Material,PreparedShader>;water?:Mesh;waterY?:number}

// This hook is only enabled by the bounded offline preparation script. The
// normal game does not retain shader source or build a second scene graph.
export function capturePreparedNature(root:Object3D,clock:Clock,water?:Mesh,waterY?:number){
  const target=globalThis as unknown as {flowerPrepareCapture?:boolean;__naturePreparation?:NatureCapture}
  if(!target.flowerPrepareCapture)return
  const shaders=new Map<Material,PreparedShader>(),visited=new Set<Material>()
  const builtins=new Set(Object.values(ShaderLib).flatMap(s=>Object.keys(s.uniforms)))
  root.traverse(object=>{
    if(!(object instanceof Mesh))return
    const materials=[...(Array.isArray(object.material)?object.material:[object.material]),object.customDepthMaterial].filter(Boolean) as Material[]
    for(const material of materials){
      if(visited.has(material))continue;visited.add(material)
      const previous=material.onBeforeCompile,key=material.customProgramCacheKey()
      material.customProgramCacheKey=()=>key
      material.onBeforeCompile=(shader,renderer)=>{
        previous.call(material,shader,renderer)
        const uniforms:PreparedShader['uniforms']={},clocks:string[]=[]
        for(const [name,value] of Object.entries(shader.uniforms)){
          if(value===clock){clocks.push(name);continue}
          if(!builtins.has(name))uniforms[name]=value
        }
        // ShaderMaterial carries all its original uniforms in Object3D JSON.
        if((material as ShaderMaterial).isShaderMaterial)for(const [name,value] of Object.entries((material as ShaderMaterial).uniforms))
          if(value===clock&&!clocks.includes(name))clocks.push(name)
        shaders.set(material,{vertex:shader.vertexShader,fragment:shader.fragmentShader,uniforms,clocks,key})
      }
    }
  })
  target.__naturePreparation={root,clock,shaders,water:water?.clone(),waterY}
}
