import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useCoreStore } from './state/core-store'
import CorePrototype from './app/CorePrototype'
import './styles/theme.css'

const core=new URLSearchParams(location.search).get('prototype')==='core'||Boolean((globalThis as unknown as {flowerCorePrototype?:boolean}).flowerCorePrototype)
const root=createRoot(document.getElementById('root')!)
if((globalThis as {flowerMaterialBench?:boolean}).flowerMaterialBench){
  void import('./app/App').then(({default:MaterialBench})=>root.render(<StrictMode><MaterialBench/></StrictMode>))
}else{
  if(!core)useCoreStore.getState().openJourney()
  root.render(<StrictMode><CorePrototype/></StrictMode>)
}

