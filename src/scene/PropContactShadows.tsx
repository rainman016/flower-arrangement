import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, type BufferGeometry, Color, DoubleSide, Matrix4, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, type Object3D } from 'three'

import {lowWoodlandQuality} from './render-quality'

const flowersByScene=new WeakMap<Scene,Map<Object3D,BufferGeometry>>()
export function registerFlowerShadow(scene:Scene,plant:Object3D,geometry:BufferGeometry){
  let flowers=flowersByScene.get(scene)
  if(!flowers){flowers=new Map();flowersByScene.set(scene,flowers)}
  flowers.set(plant,geometry)
  return ()=>{flowers.delete(plant);geometry.dispose()}
}

// The height map samples the underside of the tools and the actual uncut flower meshes.
// The two actual support planes sample it independently at their own elevations.
export default function PropContactShadows({sceneId}:{sceneId:string}){
  const {scene,gl}=useThree()
  const field=useMemo(()=>{
    const target=new WebGLRenderTarget(lowWoodlandQuality?896:1280,lowWoodlandQuality?672:960)
    const camera=new OrthographicCamera(-.64,.64,.48,-.48,.001,.55)
    camera.position.set(0,.68,-.065);camera.up.set(0,0,1);camera.lookAt(0,1,-.065)
    const scan=new Scene(),geometry=new PlaneGeometry(1,1)
    const height=new ShaderMaterial({side:DoubleSide,uniforms:{density:{value:1}},
      vertexShader:'varying float h;void main(){vec4 p=modelMatrix*vec4(position,1.);h=(p.y-.68)/.55;gl_Position=projectionMatrix*viewMatrix*p;}',
      fragmentShader:'uniform float density;varying float h;void main(){gl_FragColor=vec4(h,density,0.,1.);}'})
    const glassHeight=height.clone();glassHeight.uniforms.density.value=.22
    const radius=lowWoodlandQuality?1:2,spacing=lowWoodlandQuality?1.6:1
    const total=Array.from({length:2*radius+1},(_,i)=>Math.exp(-.37*((i-radius)*spacing)**2)).reduce((a,b)=>a+b)**2
    const shade=new ShaderMaterial({transparent:true,depthWrite:false,uniforms:{heights:{value:target.texture},texel:{value:new Vector2(1/1280,1/960)}},
      vertexShader:'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
      fragmentShader:`uniform sampler2D heights;uniform vec2 texel;varying vec3 p;
      float contact(vec2 uv){vec4 m=texture2D(heights,uv);float d=max(0.,.68+m.r*.55-p.y);return m.a*m.g*exp(-d*83.);}
      void main(){
        vec2 uv=(p.xz-vec2(0.,-.065))/vec2(1.28,.96)+.5;
        float shadow=0.,inner=0.;
        for(int x=-${radius};x<=${radius};x++){for(int z=-${radius};z<=${radius};z++){
          vec2 offset=vec2(float(x),float(z))*${spacing.toFixed(1)};
          float weight=exp(-dot(offset,offset)*.37);
          inner+=weight*contact(uv+offset*texel*.94);
          shadow+=weight*contact(uv+offset*texel*2.9);
        }}
        shadow*=${(8.0/total).toFixed(5)};inner*=${(8.0/total).toFixed(5)};
        gl_FragColor=vec4(.045,.025,.012,min(.74,.055*inner+.068*shadow+.14*contact(uv)));
        #include <colorspace_fragment>
      }`})
    const receivers=[new Mesh(geometry,shade),new Mesh(geometry,shade)]
    for(const receiver of receivers){receiver.raycast=()=>null;receiver.matrixAutoUpdate=false;receiver.visible=false}
    const sources:{source:Mesh;proxy:Mesh}[]=[]
    const supports:{root:Object3D;local:Matrix4}[]=[]
    return {target,camera,scan,height,glassHeight,geometry,shade,receivers,sources,supports,flowers:new Map<Object3D,Mesh>(),color:new Color(),initialized:false}
  },[sceneId])
  useEffect(()=>()=>{field.target.dispose();field.height.dispose();field.glassHeight.dispose();field.shade.dispose();field.geometry.dispose()},[field])
  useFrame(()=>{
    let dirty=!field.initialized
    if(!field.initialized){
      const roots=['vase_root','glass_root','scissors_root','wood_table_root','tray_root'].map(name=>scene.getObjectByName(name))
      if(!roots.every((o):o is Object3D=>!!o))return
      for(const root of roots.slice(0,3))root.traverse(obj=>{
        if(!(obj instanceof Mesh)||obj.name==='glass_water')return
        const proxy=new Mesh(obj.geometry,root===roots[1]?field.glassHeight:field.height);proxy.matrixAutoUpdate=false
        field.scan.add(proxy);field.sources.push({source:obj,proxy})
      })
      for(const [index,root] of roots.slice(3).entries()){
        root.updateWorldMatrix(true,true)
        const bounds=new Box3(),inverse=root.matrixWorld.clone().invert()
        root.traverse(o=>{
          if(!(o instanceof Mesh)||!o.name.startsWith(index?'Floating_tray_panel_':'Bench_board_'))return
          if(!o.geometry.boundingBox)o.geometry.computeBoundingBox()
          bounds.union(o.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)))
        })
        if(bounds.isEmpty())continue
        const size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3())
        const local=new Matrix4().makeRotationX(-Math.PI/2).scale(new Vector3(size.x,size.z,1))
        local.setPosition(center.x,bounds.max.y+.00023,center.z)
        field.supports.push({root,local})
      }
      field.initialized=true
    }
    const flowers=flowersByScene.get(scene)
    for(const [plant,proxy] of field.flowers){
      if(!flowers?.has(plant)){proxy.removeFromParent();field.flowers.delete(plant);dirty=true}
    }
    flowers?.forEach((geometry,plant)=>{
      let proxy=field.flowers.get(plant)
      if(!proxy){
        proxy=new Mesh(geometry,field.height);proxy.matrixAutoUpdate=false
        field.flowers.set(plant,proxy);field.scan.add(proxy);dirty=true
      }
      plant.updateWorldMatrix(true,false)
      if(!proxy.matrix.equals(plant.matrixWorld)){
        proxy.matrix.copy(plant.matrixWorld);proxy.matrixWorldNeedsUpdate=true;dirty=true
      }
    })
    for(const {source,proxy} of field.sources){
      source.updateWorldMatrix(true,false)
      if(!proxy.matrix.equals(source.matrixWorld)){
        proxy.matrix.copy(source.matrixWorld);proxy.matrixWorldNeedsUpdate=true;dirty=true
      }
    }
    field.supports.forEach(({root,local},i)=>{
      const plane=field.receivers[i];root.updateWorldMatrix(true,false)
      plane.matrix.multiplyMatrices(root.matrixWorld,local);plane.matrixWorldNeedsUpdate=true;plane.visible=true
    })
    if(!dirty)return
    scene.userData.workbenchShadowRevision=(scene.userData.workbenchShadowRevision??0)+1
    const previous=gl.getRenderTarget(),alpha=gl.getClearAlpha(),shadow=gl.shadowMap.autoUpdate
    gl.getClearColor(field.color)
    try{
      gl.shadowMap.autoUpdate=false;gl.setRenderTarget(field.target);gl.setClearColor(0,0);gl.clear()
      gl.render(field.scan,field.camera)
    }finally{
      gl.setRenderTarget(previous);gl.setClearColor(field.color,alpha);gl.shadowMap.autoUpdate=shadow
    }
  },-1)
  return <group name="tool_contact_shadows" dispose={null}>{field.receivers.map((plane,i)=><primitive key={i} object={plane}/>)}</group>
}
