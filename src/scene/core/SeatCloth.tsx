import { useEffect, useMemo } from 'react'
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, RepeatWrapping, SRGBColorSpace } from 'three'
import { DESK, WOOD_FRONT } from '../../game/desk-layout'

const back = .135, woodFront = WOOD_FRONT, top = DESK.top + .00035

function wovenSurface() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(128,128)
  for (let y=0;y<128;y++) for (let x=0;x<128;x++) {
    const index = (y*128+x)*4
    const over = ((x>>2)+(y>>2))%2
    const thread = Math.sin((over?x:y)*Math.PI/2)*5 + Math.sin((over?y:x)*Math.PI/16)*2
    const slub = Math.sin(x*.59+y*.37)*1.8
    const stripe = thread+slub
    pixels.data.set([178+stripe,166+stripe,146+stripe,255],index)
  }
  ctx.putImageData(pixels,0,0)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  return texture
}

function drapedCloth() {
  const positions:number[]=[], uv:number[]=[], colors:number[]=[], indices:number[]=[]
  const rows = [[back,top],[DESK.front-.021,top],[DESK.front-.017,top],[DESK.front-.014,top],[DESK.front-.010,top],[DESK.front-.008,top],[DESK.front,top],[DESK.front+.006,top-.008],[DESK.front+.007,top-.026],[DESK.front+.004,top-.050]]
  const columns=48
  rows.forEach(([z,y],r)=>{
    for(let c=0;c<=columns;c++){
      const x=DESK.left+(DESK.right-DESK.left)*c/columns,hang=Math.max(0,r-6)/3
      const wave=Math.sin(c*.66)+.4*Math.sin(c*1.7)
      positions.push(x,y+hang*.0022*wave,z+hang*.0035*wave)
      uv.push(x*18,(z-back+top-y)*18)
      const stripe=r===2||r===4
      colors.push(stripe?.55:1,stripe?.64:1,stripe?.56:1)
      if(r&&c){const i=r*(columns+1)+c;indices.push(i-columns-2,i-1,i,i-columns-2,i,i-columns-1)}
    }
  })
  const mesh=new BufferGeometry()
  mesh.setAttribute('position',new Float32BufferAttribute(positions,3))
  mesh.setAttribute('color',new Float32BufferAttribute(colors,3))
  mesh.setAttribute('uv',new Float32BufferAttribute(uv,2))
  mesh.setIndex(indices);mesh.computeVertexNormals()
  return mesh
}

export function SeatCloth() {
  const weave=useMemo(wovenSurface,[]), cloth=useMemo(drapedCloth,[])
  useEffect(()=>()=>{weave.dispose();cloth.dispose()},[weave,cloth])
  return <group name="linen-seat">
    <mesh position={[0,DESK.top-.0125,(woodFront+DESK.front)/2]} receiveShadow><boxGeometry args={[1.197,.024,DESK.front-woodFront]}/><meshStandardMaterial color="#73604c" roughness={.92}/></mesh>
    <mesh name="woven-linen" geometry={cloth} receiveShadow castShadow><meshStandardMaterial map={weave} vertexColors roughness={.97}/></mesh>
  </group>
}
