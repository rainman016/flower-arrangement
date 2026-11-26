import {DataTexture,LinearFilter,RGBAFormat,Vector4} from 'three'
import type {HeightAt} from './terrain-height'

// Shore coverage follows the actual sculpted ground. Colour alpha in the HDR
// bed pass is not a reliable validity/depth pair at clipped, filtered bank texels.
// Pack signed water depth into RG; linear filtering still decodes linearly.
export function creekShoreDepth(ground:HeightAt,level:number){
  const minX=-5.4,maxX=5.4,minZ=-11.2,maxZ=-3.7,width=320,height=224
  const data=new Uint8Array(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const wx=minX+(x+.5)*(maxX-minX)/width,wz=maxZ-(y+.5)*(maxZ-minZ)/height
    const encoded=Math.round(Math.max(0,Math.min(1,(level-ground(wx,wz)+2)/4))*65535),i=(y*width+x)*4
    data[i]=encoded>>8;data[i+1]=encoded&255;data[i+3]=255
  }
  const texture=new DataTexture(data,width,height,RGBAFormat)
  texture.name='Creek | measured signed shore depth';texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true
  return {texture,worldToUv:new Vector4(minX,maxZ,1/(maxX-minX),-1/(maxZ-minZ))}
}
