import { Vector3 } from 'three'

// A single capture has no colour for a newly uncovered surface behind a leaf.
// Reproject only the depth changes supported by a neighbourhood of rays. Limiting
// the angular slope of inverse range keeps silhouettes from folding as the eye moves.
export const captureFaces = [
  [1,0,0, 0,1,0], [-1,0,0, 0,1,0], [0,1,0, 0,0,1],
  [0,-1,0, 0,0,-1], [0,0,1, 0,1,0], [0,0,-1, 0,1,0],
] as const

export function distanceShell(depths: readonly Uint16Array[], grid: number, origin=new Vector3(0,1.2,.68)) {
  const segments = Math.max(2, Math.ceil(grid / 4)), stride = segments + 1
  const nodes = new Map<number, number>(), directions: Vector3[] = [], inverse: number[] = []
  const neighbours: { id: number; cost: number }[][] = []
  const faces = captureFaces.map((axes, faceIndex) => {
    const forward = new Vector3(axes[0], axes[1], axes[2])
    const up = new Vector3(axes[3], axes[4], axes[5]), right = forward.clone().cross(up)
    const ids: number[] = [], depth = depths[faceIndex], width = grid + 1
    const vertex = new Vector3(), diameter = 2 * segments + 1
    function connect(a: number, b: number) {
      // Inverse metres per radian. The largest normal player translation from
      // the capture eye is below a metre. Leave margin for wide aspect ratios.
      const cost = .18 * directions[a].distanceTo(directions[b])
      neighbours[a].push({id:b, cost})
      neighbours[b].push({id:a, cost})
    }
    for (let y = 0; y <= segments; y++) for (let x = 0; x <= segments; x++) {
      vertex.copy(forward).multiplyScalar(segments).addScaledVector(right, 2*x-segments).addScaledVector(up, 2*y-segments)
      const key = (vertex.x+segments)*diameter*diameter + (vertex.y+segments)*diameter + vertex.z+segments
      let id = nodes.get(key)
      if (id === undefined) {
        id = directions.length
        nodes.set(key,id); directions.push(vertex.clone().normalize()); neighbours.push([]); inverse.push(Infinity)
      }
      ids.push(id)
      const samples: number[] = []
      const minX = Math.max(0,Math.ceil((x-.5)*grid/segments)), maxX = Math.min(grid,Math.floor((x+.5)*grid/segments))
      const minY = Math.max(0,Math.ceil((y-.5)*grid/segments)), maxY = Math.min(grid,Math.floor((y+.5)*grid/segments))
      for (let j=minY;j<=maxY;j++) for (let i=minX;i<=maxX;i++) {
        const cm = depth[j*width+i]
        if (cm) samples.push(cm * .01 * Math.hypot(1,2*i/grid-1,2*j/grid-1))
      }
      if (samples.length) {
        samples.sort((a,b)=>a-b)
        const range = samples[Math.floor((samples.length-1)*.65)]
        inverse[id] = Math.min(inverse[id], 1/Math.max(3,range))
      }
      const k = y*stride+x
      if (x) connect(id,ids[k-1])
      if (y) connect(id,ids[k-stride])
      if (x&&y) {
        connect(id,ids[k-stride-1])
        connect(ids[k-1],ids[k-stride])
      }
    }
    return {ids, forward, occupied:depth.some(cm=>cm>0)}
  })
  const queue: number[] = [], queued = new Uint8Array(directions.length)
  for (let i=0;i<inverse.length;i++) if (Number.isFinite(inverse[i])) {queue.push(i);queued[i]=1}
  for (let i=0;i<queue.length;i++) {
    const current=queue[i]; queued[current]=0
    for (const edge of neighbours[current]) {
      const limit=inverse[current]+edge.cost
      if (inverse[edge.id]<=limit+1e-9) continue
      inverse[edge.id]=limit
      if (!queued[edge.id]) {queue.push(edge.id);queued[edge.id]=1}
    }
  }
  return faces.map(({ids,forward,occupied})=>{
    const positions=new Float32Array(ids.length*3), captureUv=new Float32Array(ids.length*3), indices:number[]=[]
    if (occupied) for (let k=0;k<ids.length;k++) {
      const id=ids[k], ray=directions[id], range=1/Math.min(1/3,inverse[id]), z=range*ray.dot(forward)
      const x=k%stride,y=Math.floor(k/stride)
      positions.set([origin.x+ray.x*range,origin.y+ray.y*range,origin.z+ray.z*range],k*3)
      captureUv.set([x/segments*z,y/segments*z,z],k*3)
      if (x&&y) indices.push(k-stride-1,k-stride,k,k-stride-1,k,k-1)
    }
    return {positions,captureUv,indices}
  })
}
