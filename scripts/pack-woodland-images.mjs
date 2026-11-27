import {execFileSync} from 'node:child_process'

const run=(args,input)=>execFileSync('ffmpeg',['-v','error','-i','pipe:0','-frames:v','1',...args,'pipe:1'],
  {input,maxBuffer:48*1024*1024,windowsHide:true})

// Depth bytes are measurements, not colour. Only accept a smaller encoding
// after decoding both images to identical RGBA bytes, including their alpha.
export function compactCaptureImage(original){
  const compact=run(['-c:v','libwebp','-lossless','1','-compression_level','6','-q:v','100','-f','webp'],original)
  if(compact.length>=original.length)return original
  const pixels=encoded=>run(['-f','rawvideo','-pix_fmt','rgba'],encoded)
  if(!pixels(original).equals(pixels(compact)))throw Error('Lossless woodland depth verification failed')
  return compact
}
