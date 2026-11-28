import {describe,expect,it} from 'vitest'
import {BoxGeometry,Color,Group,InstancedMesh,MeshDepthMaterial,MeshStandardMaterial,Scene} from 'three'
import {warmupMesh} from '../../src/scene/core/warmup-mesh'
import {shadowPrograms} from '../../src/scene/core/shadow-programs'

describe('forest program preparation',()=>{
  it('shares instance storage and preserves the actual scene hierarchy',()=>{
    const material=new MeshStandardMaterial(),source=new InstancedMesh(new BoxGeometry(),material,10000),root=new Group()
    source.setColorAt(0,new Color('green'));root.add(source)
    const proxy=warmupMesh(source) as InstancedMesh
    expect(proxy).not.toBe(source);expect(proxy.instanceMatrix).toBe(source.instanceMatrix)
    expect(proxy.instanceColor).toBe(source.instanceColor);expect(proxy.geometry).toBe(source.geometry)
    expect(proxy.count).toBe(source.count);expect(proxy.material).toBe(material)
    expect(source.parent).toBe(root);expect(root.children).toEqual([source])
  })
  it('shares instance buffers for shadow preparation without changing the source material',()=>{
    const scene=new Scene(),source=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),50)
    source.castShadow=true;scene.add(source);const original=source.material,shadows=shadowPrograms(scene)
    const proxy=shadows.group.children[0] as InstancedMesh
    expect(proxy.instanceMatrix).toBe(source.instanceMatrix);expect(proxy.material).toBeInstanceOf(MeshDepthMaterial)
    shadows.dispose();expect(source.material).toBe(original);expect(source.parent).toBe(scene)
  })
})
