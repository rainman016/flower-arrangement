import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EquirectangularReflectionMapping, RepeatWrapping, SRGBColorSpace, TextureLoader, type Group, type Texture } from 'three'
import { assetUrl, SCENES } from '../content/catalog'
import {lowWoodlandQuality} from '../scene/render-quality'
import {loadDistanceSurface} from '../scene/distance-surface'
import type { SceneId } from '../game/types'
export type SceneAssets={distance?:import('three').Group;kit:GLTF;natureKit:GLTF;environment:GLTF;sceneId:SceneId;light:Texture;floor:Texture;bankAtlas?:Texture}
let surfaces:Promise<[Texture,Texture]>|undefined
let creekSurface:Promise<Texture>|undefined
let kit:Promise<GLTF>|undefined
let natureKit:Promise<GLTF>|undefined
const distanceCache=new Map<SceneId,Promise<Group|undefined>>()
function distantForest(sceneId:SceneId){
  const asset=__FLOWER_ASSETS__.assets.find(a=>a.id==='distance-'+sceneId)
  const model=__FLOWER_ASSETS__.assets.find(a=>a.id==='environment-'+sceneId)
  if(!lowWoodlandQuality||!asset||asset.distanceFor!==(model?.originalFile??model?.file))return
  const cached=distanceCache.get(sceneId)
  if(cached)return cached
  const promise=loadDistanceSurface(assetUrl(asset.id)).catch(()=>{distanceCache.delete(sceneId);return undefined})
  distanceCache.set(sceneId,promise)
  return promise
}
const environments=new Map<SceneId,Promise<GLTF>>()
export async function loadSceneAssets(sceneId:SceneId):Promise<SceneAssets>{
  kit??=new GLTFLoader().loadAsync(assetUrl('prop-kit')).catch(e=>{kit=undefined;throw e})
  natureKit??=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl('nature-kit')).catch(e=>{natureKit=undefined;throw e})
  let environment=environments.get(sceneId)
  if(!environment){
    environment=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl(SCENES.find(s=>s.id===sceneId)!.environment))
      .catch(e=>{environments.delete(sceneId);throw e})
    environments.set(sceneId,environment)
  }
  surfaces??=Promise.all([
    new HDRLoader().loadAsync(assetUrl('woodland-light')),
    new TextureLoader().loadAsync(assetUrl('leaf-litter'))
  ]).then(([light,floor]):[Texture,Texture]=>{
    light.mapping=EquirectangularReflectionMapping
    floor.colorSpace=SRGBColorSpace;floor.flipY=false;floor.wrapS=floor.wrapT=RepeatWrapping
    return [light,floor]
  }).catch(error=>{surfaces=undefined;throw error})
  if(sceneId==='creek'){
    creekSurface??=new TextureLoader().loadAsync(assetUrl('creek-alluvium')).then(texture=>{
      texture.flipY=false
      return texture
    }).catch(error=>{creekSurface=undefined;throw error})
  }
  const [model,plants,nature,[light,floor],bankAtlas,distance]=await Promise.all([kit,natureKit,environment,surfaces,sceneId==='creek'?creekSurface:undefined,distantForest(sceneId)])
  return {distance,kit:model,natureKit:plants,environment:nature,sceneId,light,floor,bankAtlas}
}

