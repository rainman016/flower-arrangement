export type ScreenRect={left:number;top:number;right:number;bottom:number}
export function overlap(a:ScreenRect,b:ScreenRect){
  return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
}
/** Prefer a nearby empty area; keep the mouth and the active plant unobstructed. */
export function floatPosition(view:{width:number;height:number},panel:{width:number;height:number},anchor:{x:number;y:number},avoid:ScreenRect[]){
  const {width:w,height:h}=panel,pad=14
  const xs=[anchor.x+w/2+80,anchor.x-w/2-80,anchor.x,view.width/2]
  const ys=[anchor.y-h/2,anchor.y+48,anchor.y-h-42,...avoid.flatMap(r=>[r.bottom+12,r.top-h-12]),view.height-h-pad]
  let best={x:pad+w/2,y:pad},score=Infinity
  for(const x of xs)for(const y of ys){
    const left=Math.max(pad,Math.min(view.width-w-pad,x-w/2)),top=Math.max(pad,Math.min(view.height-h-pad,y))
    const rect={left,top,right:left+w,bottom:top+h}
    const value=avoid.reduce((total,r)=>total+overlap(rect,r),0)*10000+Math.hypot(left+w/2-anchor.x,top+h/2-anchor.y)
    if(value<score){score=value;best={x:left+w/2,y:top}}
  }
  return best
}
