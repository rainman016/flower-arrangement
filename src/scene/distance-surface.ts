import { Vector3, BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, Group, Mesh, ShaderMaterial, SRGBColorSpace, TextureLoader } from 'three'

import { captureFaces, distanceShell } from './distance-shell'

async function loadFaceTexture(blob:Blob){
  const url=URL.createObjectURL(blob)
  return new TextureLoader().loadAsync(url).finally(()=>URL.revokeObjectURL(url))
}

// Preserve the original WDS1 projection for scenery shipped without the
// per-pixel occlusion capture. New bakes opt into the continuous shell.
function legacyFace(depth:Uint16Array,grid:number,face:number){
  const width=grid+1,count=depth.length,queue=new Int32Array(count),coverage=new Uint8Array(count)
  let used=0
  for(let k=0;k<count;k++)if(depth[k]){
    queue[used++]=k
    const x=k%width,y=Math.floor(k/width)
    for(let j=Math.max(0,y-1);j<=Math.min(grid,y+1);j++)
      coverage.fill(1,j*width+Math.max(0,x-1),j*width+Math.min(grid,x+1)+1)
  }
  for(let i=0;i<used;i++){
    const k=queue[i],x=k%width
    const fill=(j:number)=>{if(!depth[j]){depth[j]=depth[k];queue[used++]=j}}
    if(x)fill(k-1)
    if(x+1<width)fill(k+1)
    if(k>=width)fill(k-width)
    if(k+width<count)fill(k+width)
  }
  const positions=new Float32Array(count*3),captureUv=new Float32Array(count*3),indices:number[]=[]
  const axes=captureFaces[face],forward=new Vector3(axes[0],axes[1],axes[2]),up=new Vector3(axes[3],axes[4],axes[5])
  const right=forward.clone().cross(up),p=new Vector3()
  if(used)for(let k=0;k<count;k++){
    const x=k%width,y=Math.floor(k/width),u=x/grid,v=y/grid,z=depth[k]*.01
    p.copy(forward).addScaledVector(right,2*u-1).addScaledVector(up,2*v-1).multiplyScalar(z)
    positions.set([p.x,p.y+1.2,p.z+.68],k*3);captureUv.set([u*z,v*z,z],k*3)
    if(x&&y&&(coverage[k]||coverage[k-1]||coverage[k-width]||coverage[k-width-1]))
      indices.push(k-width-1,k-width,k,k-width-1,k,k-1)
  }
  return {positions,captureUv,indices}
}

export async function loadDistanceSurface(url:string){
  const response=await fetch(url)
  if(!response.ok)throw Error('远景读取失败')
  const data=await response.arrayBuffer(),bytes=new DataView(data)
  const format=bytes.getUint32(0),seated=format===0x57445333,precise=seated||format===0x57445332
  if((format!==0x57445331&&!precise)||bytes.getUint8(5)!==6)throw Error('远景格式无效')
  const grid=bytes.getUint8(4),w=grid+1,count=w*w
  if(grid<2)throw Error('远景尺寸无效')
  let offset=seated?20:8
  const origin=seated?new Vector3(bytes.getFloat32(8,true),bytes.getFloat32(12,true),bytes.getFloat32(16,true)):new Vector3(0,1.2,.68)
  const group=new Group();group.name='woodland_distance_surfaces'
  group.userData.layeredCapture=precise
  const faces:{colour:Blob;depth:Uint16Array;occlusion?:Blob}[]=[]
  for(let i=0;i<captureFaces.length;i++){
    const length=bytes.getUint32(offset,true);offset+=4
    if(offset+length+count*2>data.byteLength)throw Error('远景数据不完整')
    const colour=new Blob([data.slice(offset,offset+length)],{type:'image/webp'});offset+=length
    const depth=new Uint16Array(count)
    for(let k=0;k<count;k++,offset+=2)depth[k]=bytes.getUint16(offset,true)
    let occlusion:Blob|undefined
    if(precise){
      const size=bytes.getUint32(offset,true);offset+=4
      if(!size||offset+size>data.byteLength)throw Error('远景遮挡数据不完整')
      occlusion=new Blob([data.slice(offset,offset+size)],{type:'image/png'});offset+=size
    }
    faces.push({colour,depth,occlusion})
  }
  const shell=precise?distanceShell(faces.map(face=>face.depth),grid,origin):faces.map((face,i)=>legacyFace(face.depth,grid,i))
  const sideMeshes=await Promise.all(faces.map(async(face,i)=>{
    const {positions,captureUv,indices}=shell[i]
    if(!indices.length)return null
    const [texture,metres]=await Promise.all([loadFaceTexture(face.colour),face.occlusion?loadFaceTexture(face.occlusion):null])
    texture.colorSpace=SRGBColorSpace
    if(metres){metres.minFilter=metres.magFilter=NearestFilter;metres.generateMipmaps=false}
    const geometry=new BufferGeometry()
    geometry.setAttribute('position',new BufferAttribute(positions,3))
    geometry.setAttribute('captureUv',new BufferAttribute(captureUv,3))
    geometry.setIndex(indices)
    const material=new ShaderMaterial({defines:metres?{CAPTURE_DEPTH:1}:{},uniforms:{captureOrigin:{value:origin},image:{value:texture},depthMap:{value:metres}},side:DoubleSide,toneMapped:false,
      vertexShader:`attribute vec3 captureUv;uniform vec3 captureOrigin;
        varying vec3 fromCapture;varying vec4 depthProjection;
        void main(){
          fromCapture=captureUv;
          vec4 viewPoint=modelViewMatrix*vec4(position,1.);
          #ifdef CAPTURE_DEPTH
          float originZ=(modelViewMatrix*vec4(captureOrigin,1.)).z;
          depthProjection=vec4(viewPoint.z-originZ,originZ,projectionMatrix[2].z,projectionMatrix[3].z);
          #endif
          gl_Position=projectionMatrix*viewPoint;
        }`,
      fragmentShader:`uniform sampler2D image,depthMap;varying vec3 fromCapture;varying vec4 depthProjection;
        void main(){
          vec2 uv=fromCapture.xy/fromCapture.z;
          vec4 colour=texture2D(image,uv);if(colour.a<.40)discard;
          #ifdef CAPTURE_DEPTH
          vec2 packedDepth=texture2D(depthMap,uv).rg;
          float metres=dot(packedDepth,vec2(255.,65280.))*.01;
          float eyeZ=depthProjection.y+depthProjection.x/fromCapture.z*metres;
          if(metres<.01||eyeZ>=0.)discard;
          gl_FragDepth=.5-.5*(depthProjection.z+depthProjection.w/eyeZ);
          #endif
          gl_FragColor=vec4(colour.rgb,1.);
          #include <colorspace_fragment>
        }`})
    const mesh=new Mesh(geometry,material);mesh.raycast=()=>{};return mesh
  }))
  for(const mesh of sideMeshes)if(mesh)group.add(mesh)
  if(offset<data.byteLength){
    const image=URL.createObjectURL(new Blob([data.slice(offset)],{type:'image/png'}))
    const depth=await new TextureLoader().loadAsync(image).finally(()=>URL.revokeObjectURL(image))
    depth.minFilter=depth.magFilter=NearestFilter;depth.generateMipmaps=false
    const geometry=new PlaneGeometry(2,2);geometry.setDrawRange(0,0)
    const pass=new Mesh(geometry,new MeshBasicMaterial({colorWrite:false,depthWrite:false,side:DoubleSide}))
    pass.name='distant_canopy_shadow';pass.frustumCulled=false;pass.castShadow=true;pass.raycast=()=>{}
    pass.customDepthMaterial=new ShaderMaterial({side:DoubleSide,uniforms:{packedDepth:{value:depth}},
      vertexShader:'varying vec2 texel;void main(){texel=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`varying vec2 texel;uniform sampler2D packedDepth;void main(){
        vec2 rg=texture2D(packedDepth,texel).rg;gl_FragDepth=(rg.r*65280.+rg.g*255.)/65535.;gl_FragColor=vec4(0.);
      }`})
    pass.onBeforeShadow=(_r,_self,_camera,shadowCamera)=>geometry.setDrawRange(0,shadowCamera instanceof OrthographicCamera?6:0)
    pass.onAfterShadow=()=>geometry.setDrawRange(0,0)
    group.add(pass)
  }
  if(!group.children.length)throw Error('远景无有效表面')
  return group
}
