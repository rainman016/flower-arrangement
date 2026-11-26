import {Vector3} from 'three'
import {describe,expect,it} from 'vitest'
import {distanceShell} from '../../src/scene/distance-shell'

describe('woodland capture viewed from a translated eye',()=>{
  it('reprojects a new bake from the measured desk eye',()=>{
    const grid=8,faces=Array.from({length:6},()=>new Uint16Array((grid+1)**2).fill(600))
    const eye=new Vector3(0,1.47212016,1.14147949)
    const old=distanceShell(faces,grid)[5].positions,shifted=distanceShell(faces,grid,eye)[5].positions
    for(let i=0;i<old.length;i+=3){
      expect(shifted[i]).toBeCloseTo(old[i],5)
      expect(shifted[i+1]-old[i+1]).toBeCloseTo(eye.y-1.2,5)
      expect(shifted[i+2]-old[i+2]).toBeCloseTo(eye.z-.68,5)
    }
  })
  it('keeps colour rays intact across a leaf, a distant bank, and a cube seam',()=>{
    const grid=24,w=grid+1,faces=Array.from({length:6},()=>new Uint16Array(w*w).fill(3000))
    for(let y=0;y<w;y++) for(let x=0;x<w/2;x++) faces[5][y*w+x]=260
    const shell=distanceShell(faces,grid),face=shell[5]
    const side=Math.sqrt(face.positions.length/3)
    const point=(f:number,k:number)=>Array.from(shell[f].positions.slice(3*k,3*k+3))
    for(let y=0;y<side;y++) for(let x=0;x<side;x++){
      const k=y*side+x,[px,py,pz]=point(5,k),z=.68-pz
      expect(px/z).toBeCloseTo(2*x/(side-1)-1,5)
      expect((py-1.2)/z).toBeCloseTo(2*y/(side-1)-1,5)
      if(x===side-1)expect(point(5,k)).toEqual(point(0,y*side))
      if(x){
        const left=point(5,k-1),l=.68-left[2]
        for(const shift of [-.9,.9])expect((px-shift)/z).toBeGreaterThan((left[0]-shift)/l)
      }
    }
    // This cross-boundary row used to connect 2.6 and 30 metres directly.
    expect(face.indices.length).toBe(6*(side-1)**2)
    faces[2].fill(0)
    expect(distanceShell(faces,grid)[2].indices).toHaveLength(0)
  })
})
