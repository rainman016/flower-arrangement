import {Data3DTexture,DataUtils,HalfFloatType,LinearFilter,Matrix3,Vector3} from 'three'

// Inverse of the pinned Three r187 AgX transform, for already graded distance imagery.
const srgb=new Matrix3().fromArray([0.6274,0.0691,0.0164,0.3293,0.9195,0.088,0.0433,0.0113,0.8956])
const rec2020=new Matrix3().fromArray([1.6605,-0.1246,-0.0182,-0.5876,1.1329,-0.1006,-0.0728,-0.0083,1.1187])
const inset=new Matrix3().fromArray([0.856627153315983,0.137318972929847,0.11189821299995,0.0951212405381588,0.761241990602591,0.0767994186031903,0.0482516061458583,0.101439036467562,0.811302368396859]).invert()
const outset=new Matrix3().fromArray([1.1271005818144368,-0.1413297634984383,-0.14132976349843826,-0.11060664309660323,1.157823702216272,-0.11060664309660294,-0.016493938717834573,-0.016493938717834257,1.2519364065950405]).invert()
const curve=(x:number)=>((((((15.5*x-40.14)*x+31.96)*x-6.868)*x+.4298)*x+.1191)*x-.00232)
const inverse=(value:number)=>{let lo=0,hi=1;for(let i=0;i<22;i++){const mid=(lo+hi)*.5;if(curve(mid)<value)lo=mid;else hi=mid}return 2**(((lo+hi)*.5)*16.499999-12.47393)}
export function inverseDisplayLight(colour:Vector3){
 colour.applyMatrix3(srgb);colour.set(Math.max(0,colour.x)**(1/2.2),Math.max(0,colour.y)**(1/2.2),Math.max(0,colour.z)**(1/2.2)).applyMatrix3(outset)
 colour.set(inverse(colour.x),inverse(colour.y),inverse(colour.z)).applyMatrix3(inset).applyMatrix3(rec2020);return colour
}
export function displayLightTexture(){
 const size=33,data=new Uint16Array(size**3*4),colour=new Vector3()
 for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  inverseDisplayLight(colour.set((x/(size-1))**2,(y/(size-1))**2,(z/(size-1))**2))
  const i=((z*size+y)*size+x)*4;data[i]=DataUtils.toHalfFloat(colour.x);data[i+1]=DataUtils.toHalfFloat(colour.y);data[i+2]=DataUtils.toHalfFloat(colour.z);data[i+3]=DataUtils.toHalfFloat(1)
 }
 const texture=new Data3DTexture(data,size,size,size);texture.type=HalfFloatType;texture.minFilter=texture.magFilter=LinearFilter;texture.unpackAlignment=1;texture.needsUpdate=true;return texture
}
