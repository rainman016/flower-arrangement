// Project physical destinations through the visible point originally grasped.
export async function deskMouseTargets(page,id,screen,targets,anchor=false){
  return page.evaluate(({id,screen,targets,anchor})=>{
    const a=window.__coreInspect,root=a.world.flowers.get(id)||a.world[id]
    if(id==='cup')return targets.map(([x,z])=>{
      const inTray=Math.abs(x)<.305*.78&&Math.abs(z+.215)<.196*.72
      const p=new a.Vector3(x,inTray?.774:.758,z).project(a.camera)
      return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2}
    })
    const cast=new a.Raycaster()
    const pointAt=(x,y)=>({x:2*x/innerWidth-1,y:1-2*y/innerHeight})
    let hit
    for(const [dx,dy] of [[0,0],[4,0],[-4,0],[0,4],[0,-4],[6,4],[-6,4]]){
      cast.setFromCamera(pointAt(screen.x+dx,screen.y+dy),a.camera)
      hit=cast.intersectObject(root,true)[0]
      if(hit)break
    }
    if(!hit)throw Error('No visible grip on '+id)
    cast.setFromCamera(pointAt(screen.x,screen.y),a.camera)
    const ray=cast.ray,grip=ray.at((hit.point.y-ray.origin.y)/ray.direction.y,new a.Vector3())
    const origin=anchor?hit.point:root.getWorldPosition(new a.Vector3())
    return targets.map(([x,z])=>{
      const p=new a.Vector3(x+grip.x-origin.x,grip.y,z+grip.z-origin.z).project(a.camera)
      return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2}
    })
  },{id,screen,targets,anchor})
}

export async function visibleDeskPoint(page,id,partName,visibleOnly=false){
  return page.evaluate(({id,partName,visibleOnly})=>{
    const a=window.__coreInspect,root=a.world.pieces.get(id)??a.world.flowers.get(id)??a.world[id]
    const ray=new a.Raycaster(),v=new a.Vector3(),first=new a.Vector3(),next=new a.Vector3(),last=new a.Vector3()
    const objects=[...new Set([root,...a.world.flowers.values(),a.world.vase,a.world.scissors,a.world.cup,...(visibleOnly?[a.world.table,a.world.tray]:[])])].filter(Boolean)
    const bounds=objects.map(object=>({object,box:new a.Box3().setFromObject(object)}))
    const surface=partName?root.getObjectByName(partName):root
    let answer
    surface?.traverse(mesh=>{
      if(answer||!mesh.isMesh)return
      const g=mesh.geometry,pos=g.attributes.position,index=g.index,n=index?.count??pos.count
      for(let i=0;i<n-2;i+=3){
        const vertex=(j,out)=>mesh.localToWorld(out.fromBufferAttribute(pos,index?index.getX(j):j))
        vertex(i,first);vertex(i+1,next);vertex(i+2,last)
        v.copy(first).add(next).add(last).multiplyScalar(1/3).project(a.camera)
        const x=Math.round((v.x+1)*innerWidth/2),y=Math.round((1-v.y)*innerHeight/2)
        if(document.elementFromPoint(x,y)?.tagName!=='CANVAS')continue
        ray.setFromCamera({x:x/innerWidth*2-1,y:1-y/innerHeight*2},a.camera)
        const hits=ray.intersectObjects(bounds.filter(({box})=>ray.ray.intersectsBox(box)).map(({object})=>object),true)
        const firstHit=visibleOnly?hits.find(h=>h.object.material?.opacity!==0):hits[0]
        let o=firstHit?.object;while(o&&o!==surface)o=o.parent
        if(o===surface){answer={x,y};break}
      }
    });return answer
  },{id,partName,visibleOnly})
}

export function visibleFlowerPart(page,id,target){
    return page.evaluate(({id,target})=>{
      const a=window.__coreInspect,root=a.world.flowers.get(id),part=root.getObjectByName('part-'+target)
      const point=new a.Vector3()
      const project=v=>{v.project(a.camera);return [(1+v.x)*innerWidth/2,(1-v.y)*innerHeight/2]}
      if(!part.userData.detail)return project(part.getWorldPosition(point))
      const tip=part.children.at(-1),plant=root.getObjectByName('botanical-'+id)
      const center=project(new a.Box3().setFromObject(tip).getCenter(point)),ray=new a.Raycaster()
      const samples=[center]
      tip.traverse(mesh=>{
        if(!mesh.isMesh)return
        const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,n=index?.count??pos.count
        for(let i=0;i<n-2;i+=3*Math.max(1,Math.floor(n/360))){
          const vertex=j=>new a.Vector3().fromBufferAttribute(pos,index?index.getX(j):j)
          samples.push(project(mesh.localToWorld(vertex(i).add(vertex(i+1)).add(vertex(i+2)).multiplyScalar(1/3))))
        }
      })
      const distance=xy=>Math.hypot(xy[0]-center[0],xy[1]-center[1])
      for(const [x,y] of samples.sort((p,q)=>distance(p)-distance(q))){
        if(document.elementFromPoint(x,y)?.tagName!=='CANVAS')continue
        ray.setFromCamera({x:x/innerWidth*2-1,y:1-y/innerHeight*2},a.camera)
        let hit=ray.intersectObject(plant,true)[0]?.object
        while(hit&&hit!==part)hit=hit.parent
        if(hit===part)return [x,y]
      }
      throw Error('当前眼位找不到可见花材表面 '+target)
    },{id,target})
  }
