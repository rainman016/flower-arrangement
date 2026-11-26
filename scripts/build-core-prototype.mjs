/** Offline core prototype: same manifest and renderer as the scene window. */
import {build} from 'vite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {extname,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('../',import.meta.url))
const final=process.argv.includes('--five-forms')
const output=resolve(root,process.env.FLOWER_DELIVERY || (final?'art/deliverables/five-forms':'art/deliverables/core-interaction-v1'))
const entry=final?'src/main.tsx':'src/core-main.tsx'
const manifestText=await readFile(resolve(root,process.env.FLOWER_ASSET_MANIFEST || 'public/assets/manifest.json'),'utf8')
const catalog=JSON.parse(manifestText)
const result=await build({root,define:{__FLOWER_ASSETS__:'globalThis.flowerPreviewCatalog','import.meta.env.BASE_URL':'""'},build:{write:false,modulePreload:false,cssCodeSplit:false,rolldownOptions:{input:resolve(root,entry),output:{codeSplitting:false}}}})
const files=(Array.isArray(result)?result:[result]).flatMap(r=>r.output)
const scripts=files.filter(f=>f.type==='chunk'),css=files.find(f=>f.type==='asset'&&f.fileName.endsWith('.css'))
if(scripts.length!==1||!css)throw Error('Expected one script and stylesheet')
const mime={'.bin':'application/octet-stream','.glb':'model/gltf-binary','.ogg':'audio/ogg','.png':'image/png','.jpg':'image/jpeg','.hdr':'application/octet-stream'}
const packed=[],assetHashes=[]
for(const asset of catalog.assets){
  const bytes=await readFile(resolve(root,'public',asset.file))
  packed.push({id:asset.id,mime:mime[extname(asset.file)],base64:bytes.toString('base64')})
  assetHashes.push({id:asset.id,file:asset.file,sha256:createHash('sha256').update(bytes).digest('hex')})
}
const cssText=typeof css.source==='string'?css.source:Buffer.from(css.source).toString('utf8')
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一席花 · 静心插花五式</title><style>'+cssText+'</style></head><body><div id="root"></div><script type="application/json" id="assets">'+JSON.stringify(packed)+'</script><script>globalThis.flowerPreviewCatalog='+JSON.stringify(catalog).replace(/</g,'\\u003c')+';const node=document.getElementById("assets"),files=JSON.parse(node.textContent);node.remove();const library=new Map(flowerPreviewCatalog.assets.map(entry=>[entry.id,entry]));for(const asset of files){const entry=library.get(asset.id);entry.originalFile=entry.file;Object.defineProperty(entry,"file",{configurable:true,enumerable:true,get(){let bytes;if(typeof Uint8Array.fromBase64==="function"){bytes=Uint8Array.fromBase64(asset.base64)}else{const decoded=atob(asset.base64);bytes=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i)}const url=URL.createObjectURL(new Blob([bytes],{type:asset.mime}));asset.base64="";Object.defineProperty(entry,"file",{value:url,writable:true,configurable:true,enumerable:true});return url}})}</script><script type="module">'+scripts[0].code.replace(/<\/script/gi,'<\\/script')+'</script></body></html>'
await mkdir(output,{recursive:true})
await writeFile(resolve(output,'play.html'),html)
const sourcePaths=['src/core-main.tsx','src/app/CorePrototype.tsx','src/components/game/float-position.ts','src/state/core-store.ts','src/services/core-progress.ts','src/game/free-cut.ts','src/game/types.ts','src/game/rules.ts','src/game/reducer.ts','src/game/history.ts','src/scene/core/CoreCanvas.tsx','src/scene/core/CoreControls.tsx','src/scene/core/clip-geometry.ts','src/scene/core/botanical-geometry.ts','src/scene/core/core-transforms.ts','src/scene/NatureEnvironment.tsx','src/scene/SceneLighting.tsx','src/scene/PropGlass.tsx','src/services/scene-assets.ts','src/content/catalog.ts','src/content/scene-view.ts','src/styles/core.css','src/styles/theme.css','scripts/build-core-prototype.mjs']
if(final)sourcePaths.push('src/main.tsx','src/app/SceneEntry.tsx','src/styles/scene-entry.css','src/components/game/RitualGuide.tsx','src/scene/core/RitualControls.tsx','src/services/ritual-progress.ts','src/services/soundscape.ts','src/styles/ritual.css','src/content/ritual-source.json')
const bundledSources=scripts.flatMap(chunk=>chunk.moduleIds??Object.keys(chunk.modules??{}))
  .map(id=>relative(root,id.split('?')[0]).replaceAll('\\','/'))
  .filter(id=>id.startsWith('src/')&&!id.includes('\0'))
const sourceHashes=await Promise.all([...new Set([...sourcePaths,...bundledSources])].sort().map(async file=>({file,sha256:createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')})))
await writeFile(resolve(output,'build.json'),JSON.stringify({created:new Date().toISOString(),entry,bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),manifestSha256:createHash('sha256').update(manifestText).digest('hex'),assetHashes,sourceHashes,scope:final?'完整五式及竹林、溪畔两景':'核心交互原型'},null,2))
console.log('Core prototype:',Buffer.byteLength(html),'bytes')
