import { useEffect, useMemo } from 'react'
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three'

/** Keep the entire possible insertion segment straight; bend only above the narrow neck. */
export function stemPoint(height:number,length:number){
  const t=Math.max(0,Math.min(1,(height-.15)/Math.max(.01,length-.15)))
  return new Vector3(.004*Math.sin(Math.PI*t),height,.002*Math.sin(Math.PI*t*1.3))
}
export default function BotanicalStem({length,selected}:{length:number;selected:boolean}){
  const geometry=useMemo(()=>{
    const curve=new CatmullRomCurve3(Array.from({length:25},(_,i)=>stemPoint(length*i/24,length)))
    const mesh=new TubeGeometry(curve,32,.00125,8,false),position=mesh.getAttribute('position')
    for(let ring=0;ring<=32;ring++){
      const t=ring/32,center=curve.getPointAt(t),scale=1-.42*t
      for(let side=0;side<=8;side++){
        const index=ring*9+side,p=new Vector3().fromBufferAttribute(position,index).sub(center).multiplyScalar(scale).add(center)
        position.setXYZ(index,p.x,p.y,p.z)
      }
    }
    mesh.computeVertexNormals();return mesh
  },[length])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <mesh geometry={geometry} castShadow><meshStandardMaterial color={selected?'#5e793b':'#6c7c3e'} roughness={.67}/></mesh>
}
