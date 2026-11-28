import type {Camera,Scene,WebGLRenderer} from 'three'

/** Measure real GPU work without synchronous readback. Called under the loading UI. */
export async function calibrateScene(renderer:WebGLRenderer,scene:Scene,camera:Camera,cancelled:()=>boolean){
 const gl=renderer.getContext() as WebGL2RenderingContext,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
 // First draw uploads buffers/textures and compiles shadow variants. It must finish
 // before the loading state is dismissed, but does not count toward calibration.
 const started=performance.now();renderer.render(scene,camera);scene.userData.runtimeTimings.firstDraw=performance.now()-started
 if(!ext||cancelled())return undefined
 const queries:WebGLQuery[]=[],values:number[]=[]
 try{
  for(let i=0;i<3&&!cancelled();i++){
   await new Promise(requestAnimationFrame)
   const q=gl.createQuery();if(!q)break
   queries.push(q);gl.beginQuery(ext.TIME_ELAPSED_EXT,q)
   try{renderer.render(scene,camera)}finally{gl.endQuery(ext.TIME_ELAPSED_EXT)}
  }
  const deadline=performance.now()+1500
  while(queries.length&&performance.now()<deadline&&!cancelled()){
   await new Promise(requestAnimationFrame)
   if(gl.getParameter(ext.GPU_DISJOINT_EXT))return undefined
   while(queries.length&&gl.getQueryParameter(queries[0],gl.QUERY_RESULT_AVAILABLE)){
    const q=queries.shift()!;values.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)
   }
  }
  if(values.length<3)return undefined
  return Math.max(...values)
 }finally{queries.forEach(q=>gl.deleteQuery(q))}
}
