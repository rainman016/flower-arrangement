// Explicit full quality keeps the original presentation for visual reviews.
const search=typeof window==='undefined'?null:new URLSearchParams(window.location.search)
export const qualityChoice=search?.get('quality')
export const lowWoodlandQuality=qualityChoice!=='full'

export function startingPixelRatio(width:number,height:number,deviceRatio:number){
  if(!lowWoodlandQuality)return Math.min(1.5,deviceRatio)
  const low=qualityChoice==='low'
  return Math.max(.5,Math.min(deviceRatio,low?.8:1,Math.sqrt((low?900000:1500000)/Math.max(1,width*height))))
}
