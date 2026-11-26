import {useEffect, useMemo, useRef} from 'react'
import {useFrame} from '@react-three/fiber'
import {CanvasTexture, Object3D, PerspectiveCamera, SpotLight, Vector3} from 'three'
import openings from './workbench-openings.json'
import {lowWoodlandQuality} from './render-quality'

// Each measurement is a gap in the canopy: floor x/z in metres, two radii,
// orientation and transmitted light. The lamp projects them onto moving props too.
const origin:[number,number,number]=[-5.6,5.13,-2.6]
const cone=.18

export default function WorkbenchCanopy({sceneId,target}:{sceneId:'bamboo'|'creek';target:Object3D}){
  const lamp=useRef<SpotLight>(null),revision=useRef(-1),last=useRef(-Infinity)
  useFrame(({scene,clock})=>{
    if(!lamp.current)return
    const value=scene.userData.workbenchShadowRevision??0
    if(value!==revision.current||clock.elapsedTime-last.current>.75){
      // This projector already represents canopy transmission. Only objects on the
      // workbench occlude it again; the directional sun handles the outdoor shadows.
      lamp.current.shadow.camera.layers.set(3)
      scene.getObjectByName('workbench_and_tools')?.traverse(o=>{if(o.castShadow)o.layers.enable(3)})
      lamp.current.shadow.needsUpdate=true
      revision.current=value;last.current=clock.elapsedTime
    }
  })
  const pattern=useMemo(()=>{
    const size=512,canvas=document.createElement('canvas')
    canvas.width=canvas.height=size
    const ctx=canvas.getContext('2d')!
    ctx.fillStyle='#151515';ctx.fillRect(0,0,size,size)
    const lens=new PerspectiveCamera(2*cone*180/Math.PI,1,1,15)
    lens.position.set(...origin);lens.lookAt(0,.77,0);lens.updateMatrixWorld()
    function project(x:number,z:number){
      const p=new Vector3(x,.758,z).project(lens)
      return [(p.x+1)*size/2,(1-p.y)*size/2]
    }
    ctx.globalCompositeOperation='lighter'
    for(const [x,z,major,minor,angle,amount] of openings[sceneId]){
      const [cx,cy]=project(x,z),co=Math.cos(angle),si=Math.sin(angle)
      const [ax,ay]=project(x+2.3*major*co,z+2.3*major*si)
      const [bx,by]=project(x-2.3*minor*si,z+2.3*minor*co)
      ctx.save();ctx.transform(ax-cx,ay-cy,bx-cx,by-cy,cx,cy)
      const gradient=ctx.createRadialGradient(0,0,0,0,0,1)
      for(const [r,power] of [[0,1],[.33,.78],[.64,.30],[1,0]]){
        const value=Math.round(228*Math.min(1,amount*power))
        gradient.addColorStop(r,'rgb('+value+' '+value+' '+value+')')
      }
      ctx.fillStyle=gradient;ctx.fillRect(-1,-1,2,2);ctx.restore()
    }
    return new CanvasTexture(canvas)
  },[sceneId])
  useEffect(()=>()=>pattern.dispose(),[pattern])
  return <spotLight ref={lamp} shadow-autoUpdate={!lowWoodlandQuality} shadow-needsUpdate position={origin} target={target} angle={cone} penumbra={.32}
    map={pattern} color="#ffdfab" intensity={sceneId==='bamboo'?2680:2920} castShadow
    shadow-mapSize={lowWoodlandQuality?[768,768]:[1536,1536]} shadow-camera-near={1}
    shadow-camera-far={15} shadow-bias={-.00008} shadow-normalBias={.0004}/>
}
