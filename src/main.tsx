import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useCoreStore } from './state/core-store'
import SceneEntry from './app/SceneEntry'
import './styles/theme.css'

const core=new URLSearchParams(location.search).get('prototype')==='core'||Boolean((globalThis as unknown as {flowerCorePrototype?:boolean}).flowerCorePrototype)
const root=createRoot(document.getElementById('root')!)
if((globalThis as {flowerMaterialBench?:boolean}).flowerMaterialBench){
  void import('./app/App').then(({default:MaterialBench})=>root.render(<StrictMode><MaterialBench/></StrictMode>))
}else if(core){
  void import('./app/CorePrototype').then(({default:CorePrototype})=>root.render(<StrictMode><CorePrototype/></StrictMode>))
}else{
  const hasSave=useCoreStore.getState().openJourney()
  root.render(<StrictMode><SceneEntry hasSave={hasSave}/></StrictMode>)
}
