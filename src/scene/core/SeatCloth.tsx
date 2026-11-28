import { useLoader } from '@react-three/fiber'
import { Shape, SRGBColorSpace, TextureLoader } from 'three'
import { DESK } from '../../game/desk-layout'
import seatMat from './seat-mat.webp?inline'

// Begin with the scene module, before any expensive three-dimensional assembly.
useLoader.preload(TextureLoader, seatMat)
export function useSeatClothTexture(){
  const nap = useLoader(TextureLoader, seatMat)
  nap.colorSpace = SRGBColorSpace
  nap.anisotropy = 4
  return nap
}

const width = .72
const depth = .30
const front = DESK.front - .032
// The outline uses unit coordinates so the photo UVs cover the mat exactly once.
const rx = .0025 / width, ry = .0025 / depth
const outline = new Shape()
outline.moveTo(rx, 0)
outline.lineTo(1 - rx, 0)
outline.quadraticCurveTo(1, 0, 1, ry)
outline.lineTo(1, 1 - ry)
outline.quadraticCurveTo(1, 1, 1 - rx, 1)
outline.lineTo(rx, 1)
outline.quadraticCurveTo(0, 1, 0, 1 - ry)
outline.lineTo(0, ry)
outline.quadraticCurveTo(0, 0, rx, 0)

export function SeatCloth() {
  const nap = useSeatClothTexture()
  return <mesh name="seat-mat" position={[-width / 2, DESK.top + .00008, front]}
    rotation={[-Math.PI / 2, 0, 0]} scale={[width, depth, 1]} receiveShadow>
    <shapeGeometry args={[outline, 4]} />
    <meshStandardMaterial map={nap} bumpMap={nap} bumpScale={.00010}
      roughness={.99} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-4} />
  </mesh>
}
