import {describe,it,expect} from 'vitest'
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Object3D,Vector3} from 'three'
import {bambooSurround,seatBambooGroves,seatBambooRocks} from '../../src/scene/BambooSurround'

describe('bamboo grove around the player',()=>{
  it('plants all three surrounding directions on uneven soil while retaining front root contact',()=>{
    const root=new Group(),ground=(x:number,z:number)=>.10*Math.sin(x*.4)+z*.015
    const fern=new Object3D();fern.userData.prototype='fern';fern.position.set(-1.8,ground(-1.8,-3),-3);root.add(fern)
    root.updateMatrixWorld(true)
    bambooSurround(root,ground)
    const directions={left:0,right:0,back:0}
    root.traverse(p=>{
      if(!p.name.startsWith('bamboo_surround_'))return
      const {x,y,z}=p.position,r=Math.hypot(x,z)
      expect(r).toBeGreaterThan(1.9)
      expect(y).toBeCloseTo(ground(x,z)-.028,7)
      if(Math.abs(x)>Math.abs(z))directions[x>0?'right':'left']++
      else if(z>0)directions.back++
    })
    for(const count of Object.values(directions))expect(count).toBeGreaterThan(70)
    expect(fern.position.toArray()).toEqual([-1.8,ground(-1.8,-3),-3])
    expect(fern.scale.y).toBeGreaterThan(.6)
    expect(fern.scale.y).toBeLessThan(1)
    expect(root.userData.bambooSurround.planted).toBeLessThan(1800)
  })
  it('seats an offset scan under a transformed parent into the actual sloping surface',()=>{
    const root=new Group(),kit=new Group(),prototype=new Group()
    prototype.name='forest_rock_0';prototype.position.set(.4,.8,-.2)
    const mesh=new Mesh(new BoxGeometry(1,.6,.8),new MeshBasicMaterial());prototype.add(mesh);kit.add(prototype)
    const parent=new Group();parent.rotation.y=.8;parent.position.set(2,0,1);root.add(parent)
    const rock=new Object3D();rock.userData.prototype='rock';rock.position.set(1,1.3,2);rock.scale.set(.8,.6,.9);parent.add(rock)
    const ground=(x:number,z:number)=>.1*x-.07*z
    root.updateMatrixWorld(true);kit.updateMatrixWorld(true)
    seatBambooRocks(root,kit,ground)
    const matrix=rock.matrixWorld.clone().multiply(mesh.matrixWorld),p=new Vector3(),v=mesh.geometry.attributes.position
    const gaps=Array.from({length:v.count},(_,i)=>{p.fromBufferAttribute(v,i).applyMatrix4(matrix);return p.y-ground(p.x,p.z)})
    expect(Math.min(...gaps)).toBeLessThan(-.018)
    expect(Math.max(...gaps)).toBeGreaterThan(.15)
    expect(root.userData.bambooStoneContact[0].before).toBeGreaterThan(1)
    expect(root.userData.bambooStoneContact[0].after).toBeCloseTo(-.018,8)
    mesh.geometry.dispose();mesh.material.dispose()
  })
  it('buries both culm feet of a wide clump on a slope without moving its planting site',()=>{
    const root=new Group(),prototype=new Group();prototype.userData.gardenPrototype='grove_0';root.add(prototype)
    const geometry=new BoxGeometry(.1,2,.1).translate(0,1,0),material=new MeshBasicMaterial()
    for(const x of [-.55,.55]){const mesh=new Mesh(geometry,material);mesh.name='grove_0_culm';mesh.position.x=x;prototype.add(mesh)}
    const ground=(x:number,z:number)=>x*.3+z*.05
    const plant=new Object3D();plant.name='bamboo_surround_0';plant.userData.prototype='grove_0'
    plant.position.set(4,ground(4,2),2);root.add(plant);root.updateMatrixWorld(true)
    seatBambooGroves(root,ground)
    for(const child of prototype.children){
      const mesh=child as Mesh,m=plant.matrixWorld.clone().multiply(mesh.matrixWorld),v=geometry.attributes.position,p=new Vector3()
      for(let i=0;i<v.count;i++)if(v.getY(i)<.01){p.fromBufferAttribute(v,i).applyMatrix4(m);expect(p.y-ground(p.x,p.z)).toBeLessThanOrEqual(-.0249)}
    }
    expect(plant.position.x).toBe(4);expect(plant.position.z).toBe(2)
    expect(root.userData.bambooSeatedGroves).toBe(1)
    geometry.dispose();material.dispose()
  })
})
