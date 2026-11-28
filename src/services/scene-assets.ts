import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { EquirectangularReflectionMapping, RepeatWrapping, SRGBColorSpace, TextureLoader, type Group, type Texture } from 'three'
import { assetUrl, SCENES } from '../content/catalog'
import {lowWoodlandQuality} from '../scene/render-quality'
import {loadDistanceSurface} from '../scene/distance-surface'
import {loadPreparedNature,type PreparedNature} from './prepared-nature'
import type { SceneId } from '../game/types'
type SceneAssetBase={kit:GLTF;natureKit:Pick<GLTF,'scene'>;environment:Pick<GLTF,'scene'>;sceneId:SceneId;light:Texture}
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
export async function loadSceneAssets(sceneId:SceneId,overlapTextures=false):Promise<SceneAssets>{
  kit??=new GLTFLoader().loadAsync(assetUrl('prop-kit')).catch(e=>{kit=undefined;throw e})
  lightAsset??=new HDRLoader().loadAsync(assetUrl('woodland-light')).then(light=>{
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
    const [prepared,model,light]=await Promise.all([pending.catch(()=>undefined),kit,lightAsset])
    if(prepared?.sceneId===sceneId){
      void prepared.ready.catch(()=>failedPrepared.add(sceneId))
      const usable=overlapTextures||await prepared.ready.then(()=>true,()=>false)
      if(usable)return {prepared,kit:model,natureKit:{scene:prepared.root},environment:{scene:prepared.root},sceneId,light}
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
  const [model,plants,nature,light,floor,bankAtlas,distance]=await Promise.all([kit,natureKit,environment,lightAsset,floorAsset,sceneId==='creek'?creekSurface:undefined,distantForest(sceneId)])
  return {distance,kit:model,natureKit:plants,environment:nature,sceneId,light,floor,bankAtlas}
}

