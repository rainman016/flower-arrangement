import { useMemo,useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry,Float32BufferAttribute,DoubleSide } from 'three'
import { useCoreStore } from '../../state/core-store'
import type { CoreWorld } from './CoreCanvas'
const profile=[[.012,.0205],[.020,.0320],[.026,.0350],[.039,.0383],[.055,.0383],[.068,.0363],[.084,.0313],[.098,.0248],[.11,.0191],[.122,.0145],[.137,.0114],[.151,.0108],[.164,.0125],[.175,.01586],[.179,.0172]]
const samples=40
function radiusAt(y:number){
  const i=profile.findIndex(p=>p[0]>=y)
  if(i<=0)return profile[i===0?0:profile.length-1][1]
  const [y0,r0]=profile[i-1],[y1,r1]=profile[i]
  return r0+(r1-r0)*(y-y0)/(y1-y0)
}
export default function VaseWater({world}:{world:CoreWorld}){
  const geometry=useMemo(()=>{
    const g=new BufferGeometry(),indices=[]
    g.setAttribute('position',new Float32BufferAttribute(new Float32Array((profile.length*samples+1)*3),3))
    for(let row=1;row<profile.length;row++)for(let j=0;j<samples;j++){
      const a=(row-1)*samples+j,b=(row-1)*samples+(j+1)%samples
      indices.push(a,a+samples,b,b,a+samples,b+samples)
    }
    const cap=profile.length*samples,top=cap-samples
    for(let j=0;j<samples;j++)indices.push(cap,top+(j+1)%samples,top+j)
    g.setIndex(indices);return g
  },[])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  useFrame(()=>{
    const ml=useCoreStore.getState().history.present.vaseMl+world.previewMl
    if(geometry.userData.ml===ml)return
    geometry.userData.ml=ml
    geometry.setDrawRange(0,ml>0?geometry.index!.count:0)
    const height=.012+.166*ml/130,p=geometry.getAttribute('position')
    profile.forEach(([level],row)=>{
      const y=Math.min(level,height),radius=radiusAt(y)*.985
      for(let j=0;j<samples;j++){const angle=2*Math.PI*j/samples;p.setXYZ(row*samples+j,Math.cos(angle)*radius,y,Math.sin(angle)*radius)}
    })
    p.setXYZ(profile.length*samples,0,height,0);p.needsUpdate=true;geometry.computeVertexNormals()
  })
  return <mesh name="vase-water-volume" frustumCulled={false} geometry={geometry} renderOrder={2}><meshStandardMaterial color="#85bad0" opacity={.65} transparent roughness={.12} metalness={.12} side={DoubleSide} depthWrite={false}/></mesh>
}

