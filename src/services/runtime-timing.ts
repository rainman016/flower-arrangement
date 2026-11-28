/** Lightweight phase markers, enabled only by the browser verification harness. */
export function runtimeMark(name:string){
 if((globalThis as {flowerCoreReview?:boolean}).flowerCoreReview)performance.mark('flower:'+name)
}
