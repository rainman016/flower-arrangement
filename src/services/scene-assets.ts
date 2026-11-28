import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EquirectangularReflectionMapping, RepeatWrapping, SRGBColorSpace, TextureLoader, type Group, type Texture } from 'three'
import { assetUrl, SCENES } from '../content/catalog'
import {lowWoodlandQuality} from '../scene/render-quality'
import {loadDistanceSurface} from '../scene/distance-surface'
import {loadPreparedNature,type PreparedNature} from './prepared-nature'
import {runtimeMark} from './runtime-timing'
import {woodlandSky} from '../scene/WoodlandSky'
import {loadCachedAsset} from './cached-asset'
import type { SceneId } from '../game/types'
type SceneAssetBase={kit:GLTF;natureKit:Pick<GLTF,'scene'>;environment:Pick<GLTF,'scene'>;sceneId:SceneId;light:Texture;sky:Texture}
export type SceneAssets=SceneAssetBase&(
  {prepared:PreparedNature;distance?:undefined;floor?:undefined;bankAtlas?:undefined}|
  {prepared?:undefined;distance?:Group;floor:Texture;bankAtlas?:Texture}
)
let lightAsset:Promise<Texture>|undefined
let floorAsset:Promise<Texture>|undefined
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
const preparedCache=new Map<SceneId,Promise<PreparedNature>>()
const failedPrepared=new Set<SceneId>()
const skies=new Map<SceneId,Promise<Texture>>()
export async function loadSceneAssets(sceneId:SceneId,overlapTextures=false):Promise<SceneAssets>{
  runtimeMark('assets-start')
  // Start fixed sky computation while the selected scene's network requests run.
  // Lighting clones the texture; its CPU pixels are shared and never recomputed.
  if(!skies.has(sceneId))skies.set(sceneId,new Promise<void>(resolve=>setTimeout(resolve,0)).then(()=>woodlandSky(sceneId)).catch(error=>{skies.delete(sceneId);throw error}))
  const skyReady=skies.get(sceneId)!
  kit??=loadCachedAsset(assetUrl('prop-kit'),url=>new GLTFLoader().loadAsync(url)).catch(e=>{kit=undefined;throw e})
  lightAsset??=loadCachedAsset(assetUrl('woodland-light'),url=>new HDRLoader().loadAsync(url)).then(light=>{
    light.mapping=EquirectangularReflectionMapping;return light
  }).catch(error=>{lightAsset=undefined;throw error})
  const preparedAsset=__FLOWER_ASSETS__.assets.find(a=>a.id==='prepared-'+sceneId)
  const original=__FLOWER_ASSETS__.assets.find(a=>a.id==='environment-'+sceneId)
  if(lowWoodlandQuality&&!failedPrepared.has(sceneId)&&preparedAsset&&preparedAsset.preparedFor===(original?.originalFile??original?.file)&&!(globalThis as unknown as {flowerPrepareCapture?:boolean}).flowerPrepareCapture){
    let pending=preparedCache.get(sceneId)
    if(!pending){
      pending=loadPreparedNature(assetUrl(preparedAsset.id),assetUrl).catch(error=>{preparedCache.delete(sceneId);throw error})
      preparedCache.set(sceneId,pending)

    }
    const [prepared,model,light,sky]=await Promise.all([pending.catch(()=>undefined),kit,lightAsset,skyReady])
    runtimeMark('assets-ready')
    if(prepared?.sceneId===sceneId){
      void prepared.ready.catch(()=>failedPrepared.add(sceneId))
      const usable=overlapTextures||await prepared.ready.then(()=>true,()=>false)
      if(usable)return {prepared,kit:model,natureKit:{scene:prepared.root},environment:{scene:prepared.root},sceneId,light,sky}
    }
    // A failed optional prepared file falls back to the authored scene. Source
    // assets remain cached, and subsequent scene visits do not retry a bad file.
    failedPrepared.add(sceneId)
  }
  floorAsset??=new TextureLoader().loadAsync(assetUrl('leaf-litter')).then(floor=>{
    floor.colorSpace=SRGBColorSpace;floor.flipY=false;floor.wrapS=floor.wrapT=RepeatWrapping;return floor
  }).catch(error=>{floorAsset=undefined;throw error})
  natureKit??=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl('nature-kit')).catch(e=>{natureKit=undefined;throw e})
  let environment=environments.get(sceneId)
  if(!environment){
    environment=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetUrl(SCENES.find(s=>s.id===sceneId)!.environment))
      .catch(e=>{environments.delete(sceneId);throw e})
    environments.set(sceneId,environment)
  }
  if(sceneId==='creek'){
    creekSurface??=new TextureLoader().loadAsync(assetUrl('creek-alluvium')).then(texture=>{
      texture.flipY=false
      return texture
    }).catch(error=>{creekSurface=undefined;throw error})
  }
  const [model,plants,nature,light,floor,bankAtlas,distance,sky]=await Promise.all([kit,natureKit,environment,lightAsset,floorAsset,sceneId==='creek'?creekSurface:undefined,distantForest(sceneId),skyReady])
  return {distance,kit:model,natureKit:plants,environment:nature,sceneId,light,floor,bankAtlas,sky}
}
