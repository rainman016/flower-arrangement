import {Color,DataTexture,DataUtils,EquirectangularReflectionMapping,HalfFloatType,LinearFilter,LinearSRGBColorSpace,RepeatWrapping,RGBAFormat,Vector3} from 'three'
import type {SceneId} from '../game/types'
import {forestSun} from './CanopyLight'
import {bambooWindowLayout} from './BambooSunlight'

// Two curved cloud layers. Sampling world directions keeps the zenith and longitude seam continuous.
export function woodlandSky(scene:SceneId){
  const width=768,height=384,data=new Uint16Array(width*height*4)
  const rain=scene==='rain',noise=new Float32Array(128*128)
  let seed=scene==='creek'?32457:scene==='rain'?21853:8678
  for(let i=0;i<noise.length;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;noise[i]=seed/4294967296}
  function sample(x:number,z:number){
    const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz
    const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz)
    const row=(iz&127)*128,next=((iz+1)&127)*128,left=ix&127,right=(ix+1)&127
    return (noise[row+left]*(1-u)+noise[row+right]*u)*(1-v)+(noise[next+left]*(1-u)+noise[next+right]*u)*v
  }
  function cloudField(x:number,z:number){
    return .51*sample(x,z)+.27*sample(x*1.91-z*.37+8,z*1.91+x*.37)+.14*sample(x*4.07,z*4.07+27)+.08*sample(x*8.3-5,z*8.3)
  }
  const sun=new Vector3(...forestSun[scene]).normalize()
  const bambooWindow=scene==='bamboo'?bambooWindowLayout().direction:null
  const horizon=new Color(rain?'#9facb3':'#a1becb'),zenith=new Color(rain?'#8295a2':'#4d87b5')
  const sunGlow=new Color(rain?'#d7dbd6':'#ffe4ac')
  const shadow=new Color(rain?'#87959d':'#b6c6ce'),bright=new Color(rain?'#d8dcd8':'#fcf7e7')
  const base=new Color(),cloud=new Color(),clamp=(n:number)=>Math.max(0,Math.min(1,n))
  for(let row=0;row<height;row++){
    const lat=((row+.5)/height-.5)*Math.PI,y=Math.sin(lat),radius=Math.cos(lat)
    const rise=clamp(Math.max(y,0)*1.08)**.54
    // The curved layer has a finite path length at the horizon.
    const distance=2.3/(Math.sqrt(Math.max(0,y)**2+.125)+Math.max(0,y))
    for(let col=0;col<width;col++){
      const lon=((col+.5)/width-.5)*2*Math.PI,x=radius*Math.cos(lon),z=radius*Math.sin(lon)
      const facing=clamp(sun.x*x+sun.y*y+sun.z*z)
      const px=x*distance*2.3+17,pz=z*distance*2.3+39
      const vapour=cloudField(px+.52*sample(px*.59,pz*.59),pz)
      const cover=clamp((vapour-(rain?.29:.43))*(rain?2.05:4.25))
      const cloudLight=clamp(.52+2.6*(vapour-cloudField(px+sun.x*.47,pz+sun.z*.47))+.23*facing)
      base.copy(horizon).lerp(zenith,rise).lerp(sunGlow,(rain?.12:.48)*facing**6)
      cloud.copy(shadow).lerp(bright,cloudLight)
      base.lerp(cloud,cover*cover*(3-2*cover)*clamp((y+.09)*5.4))
      if(!rain){
        const veil=clamp((cloudField(px*.81+pz*.48,pz*1.7+13)-.49)*2.8)
        base.lerp(bright,veil*.19*clamp(y*4))
        const glow=.85*facing**90+4.1*facing**3200
        base.r+=sunGlow.r*glow;base.g+=sunGlow.g*glow;base.b+=sunGlow.b*glow
      }
      if(bambooWindow){
        // A warm sky opening behind real culms, fixed to a world direction.
        // No image plane, camera lock or change to the remaining sky hemisphere.
        const facingWindow=clamp(bambooWindow.x*x+bambooWindow.y*y+bambooWindow.z*z)
        const window=.65*facingWindow**180+2.8*facingWindow**1450
        base.r+=3.0*window;base.g+=2.10*window
        base.b=base.b*(1.-.88*Math.min(.90,window*2.5))+.035*window
      }
      const i=(row*width+col)*4
      data[i]=DataUtils.toHalfFloat(base.r);data[i+1]=DataUtils.toHalfFloat(base.g)
      data[i+2]=DataUtils.toHalfFloat(base.b);data[i+3]=DataUtils.toHalfFloat(1)
    }
  }
  const texture=new DataTexture(data,width,height,RGBAFormat,HalfFloatType)
  texture.name='Woodland daylight | '+scene;texture.colorSpace=LinearSRGBColorSpace
  texture.mapping=EquirectangularReflectionMapping;texture.wrapS=RepeatWrapping
  texture.magFilter=texture.minFilter=LinearFilter;texture.needsUpdate=true
  return texture
}
