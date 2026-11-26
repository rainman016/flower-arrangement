import {describe,it,expect} from 'vitest'
import {Box3,BoxGeometry,CylinderGeometry,Group,Mesh,MeshBasicMaterial,Ray,Vector3} from 'three'
import {beginTableCarry,moveOnTable} from '../../src/scene/core/desk-space'
import {DESK} from '../../src/game/desk-layout'
import {commit,undo,redo} from '../../src/game/history'
import {coreInitial,encodeCore,decodeCore,CORE_KEY} from '../../src/services/core-progress'
import {STORAGE_KEY} from '../../src/services/progress-storage'
import {sliceY} from '../../src/scene/core/clip-geometry'
import {createPlant,createPiece,disposeGeometry} from '../../src/scene/core/botanical-geometry'
import {floatPosition,overlap} from '../../src/components/game/float-position'
import type {PiecePlacement} from '../../src/game/types'
const placement:PiecePlacement={origin:[-.15,1,.1],landing:[-.15,.78,.1],rotation:[0,0,0,1],resting:[Math.SQRT1_2,0,0,Math.SQRT1_2]}
const scissors={tool:'scissors' as const}
const cut=(h:ReturnType<typeof coreInitial>,target:string,at:number)=>commit(h,{type:'free-cut',id:'f-1',target,at,placement},scissors)

describe('连续剪口与真实碎屑',()=>{
  it('剪白花的小苞保留邻叶和同枝花头，剪母枝后不会再剪下同一个苞',()=>{
    const start=coreInitial(),white=start.present.flowers.find(f=>f.kind==='white')!
    const snip=(history:typeof start,target:string)=>commit(history,{type:'free-cut',id:white.id,target,at:0,placement},scissors)
    const one=snip(start,'side-bud')
    expect(one.changed).toBe(true)
    expect(one.history.present.flowers.find(f=>f.id===white.id)).toMatchObject({length:white.length,removed:['side-bud']})
    expect(snip(one.history,'side-bud').changed).toBe(false)
    expect(snip(one.history,'side-leaf-2').changed).toBe(true)
    expect(snip(one.history,'side-bloom').changed).toBe(true)
    const branch=snip(one.history,'branch-0').history
    expect(snip(branch,'side-bloom').changed).toBe(false)
    expect(decodeCore(encodeCore(branch))?.present).toEqual(branch.present)
    expect(undo(branch).present).toBe(one.history.present)
    expect(undo(one.history).present).toBe(start.present)
  })
  it('两条白花侧枝分别脱落，主茎长度与另一侧枝可恢复',()=>{
    const start=coreInitial(),white=start.present.flowers.find(f=>f.kind==='white')!
    const snip=(history:typeof start,target:string)=>commit(history,{type:'free-cut',id:white.id,target,at:0,placement},scissors)
    const lower=snip(start,'branch-0'),upper=snip(lower.history,'crown-branch')
    expect(lower.changed&&upper.changed).toBe(true)
    const saved=decodeCore(encodeCore(upper.history))!
    expect(saved.present.flowers.find(f=>f.id===white.id)).toMatchObject({length:white.length,removed:['branch-0','crown-branch']})
    expect(saved.present.debris.map(d=>d.shape!.target)).toEqual(['branch-0','crown-branch'])
    expect(undo(saved).present).toEqual(lower.history.present)
  })
  it('不同主茎剪口累计剪短，保留每次切除前的形态，其他实例不变',()=>{
    const before=coreInitial(),first=cut(before,'stem',.0237),second=cut(first.history,'stem',.0161)
    expect(first.changed&&second.changed).toBe(true)
    expect(second.history.present.flowers[0].length).toBeCloseTo(before.present.flowers[0].length-.0398)
    expect(second.history.present.flowers[1]).toBe(before.present.flowers[1])
    expect(second.history.present.debris.map(d=>d.shape?.to)).toEqual([.0237,.0161])
    expect(second.history.present.debris[1].shape?.flower.length).toBe(first.history.present.flowers[0].length)
    expect(before.present.debris).toEqual([])
    expect(second.history.past).toHaveLength(2)
    expect(undo(second.history).present).toEqual(first.history.present)
    expect(redo(undo(second.history)).present).toEqual(second.history.present)
  })
  it('侧枝在连续位置截断，第二次只剪掉剩余段，不误删整枝',()=>{
    const first=cut(coreInitial(),'branch-0',.618).history,second=cut(first,'branch-0',.307).history
    expect(second.present.flowers[0].sections).toEqual({'branch-0':.307})
    expect(second.present.flowers[0].removed).not.toContain('branch-0')
    expect(second.present.debris.map(d=>[d.shape?.from,d.shape?.to])).toEqual([[.618,1],[.307,.618]])
    expect(cut(second,'branch-0',.5).changed).toBe(false)
    expect(cut(second,'branch-0',0).history.present.flowers[0].removed).toContain('branch-0')
  })
  it('两段碎枝归拢仍保留原形，整组一次撤销或恢复',()=>{
    const first=cut(coreInitial(),'branch-0',.618).history
    const second=cut(first,'branch-0',.307).history
    const placements=second.present.debris.map((piece,index)=>({
      id:piece.id,resting:piece.shape!.resting,landing:[.38+index*.025,.755,.14] as [number,number,number]
    }))
    const grouped=commit(second,{type:'move-pieces',placements}).history
    expect(grouped.past.length).toBe(second.past.length+1)
    expect(grouped.present.debris.map(d=>d.id)).toEqual(second.present.debris.map(d=>d.id))
    expect(grouped.present.debris.map(d=>[d.shape!.from,d.shape!.to])).toEqual([[.618,1],[.307,.618]])
    expect(grouped.present.debris.map(d=>d.shape!.landing)).toEqual(placements.map(p=>p.landing))
    expect(undo(grouped).present).toEqual(second.present)
    expect(decodeCore(encodeCore(grouped))?.present).toEqual(grouped.present)
    expect(commit(second,{type:'move-pieces',placements:[placements[0],{...placements[1],landing:[9,.75,0]}]}).history).toBe(second)
  })
  it('上部主茎可以剪至近花托，剩余短枝仍可保存和安放',()=>{
    const start=coreInitial(),at=start.present.flowers[0].length-.008
    const cutTop=cut(start,'stem',at)
    expect(cutTop.changed).toBe(true)
    expect(cutTop.history.present.flowers[0].length).toBeCloseTo(.008,6)
    const inserted=commit(cutTop.history,{type:'insert',id:'f-1'})
    expect(inserted.changed).toBe(true)
    expect(inserted.history.present.flowers[0].pose.depth).toBeLessThan(.008)
    expect(decodeCore(encodeCore(inserted.history))).toEqual(inserted.history)
  })
  it('一键清理只移走已经归拢的残枝，并可撤销',()=>{
    const first=cut(coreInitial(),'leaf-0',.5).history
    const d=first.present.debris[0]
    const gathered=commit(first,{type:'move-pieces',gather:true,placements:[{id:d.id,landing:d.shape!.landing,resting:d.shape!.resting}]}).history
    const more=cut(gathered,'stem',.025).history
    const cleaned=commit(more,{type:'clear-gathered'}).history
    expect(cleaned.present.debris.map(x=>x.id)).toEqual([more.present.debris[1].id])
    expect(undo(cleaned).present).toEqual(more.present)
    expect(decodeCore(encodeCore(more))?.present.debris[0].gathered).toBe(true)
  })
  it('非法剪口、工具和落点不写入历史',()=>{
    const h=coreInitial()
    for(const at of [-1,NaN,Infinity,h.present.flowers[0].length,0])expect(cut(h,'stem',at).history).toBe(h)
    expect(commit(h,{type:'free-cut',id:'f-1',target:'stem',at:.02,placement}).history).toBe(h)
    expect(commit(h,{type:'free-cut',id:'f-1',target:'stem',at:.02,placement:{...placement,landing:[3,.8,0]}},scissors).history).toBe(h)
    const planted=commit(h,{type:'insert',id:'f-1'}).history
    expect(cut(planted,'stem',.02).changed).toBe(false)
  })
  it('存档恢复全部碎屑形状、方向、落点及撤销链，独立于旧作品',()=>{
    let h=cut(coreInitial(),'branch-0',.55).history
    h=cut(h,'stem',.041).history
    h=commit(h,{type:'place-flower',id:'f-2',position:[.52,.77,.3]}).history
    expect(decodeCore(encodeCore(h))).toEqual(h)
    expect(decodeCore(encodeCore(undo(h)))).toEqual(undo(h))
    expect(CORE_KEY).not.toBe(STORAGE_KEY)
    const corrupt=JSON.parse(encodeCore(h))
    corrupt.history.present.debris[0].shape.rotation=[1,1,1,1]
    expect(decodeCore(JSON.stringify(corrupt))).toBeUndefined()
    const impossible=JSON.parse(encodeCore(h))
    impossible.history.present.debris[1].shape.to=.5
    expect(decodeCore(JSON.stringify(impossible))).toBeUndefined()
    expect(decodeCore('{"schemaVersion":1}')).toBeUndefined()
  })
})
describe('真实网格截断',()=>{
  it('剪口靠近叶柄时叶片只能归属于保留花枝或剪落物，不能消失或重复',()=>{
    const kit=new Group(),material=new MeshBasicMaterial()
    for(const name of ['flower_leaf','flower_yellow_head']){
      const mesh=new Mesh(new BoxGeometry(.008,.06,.002),material);mesh.name=name;kit.add(mesh)
    }
    const f=coreInitial().present.flowers[0]
    for(const amount of [.0957,.1,.1057]){
      const next=cut(coreInitial(),'stem',amount).history.present.flowers[0]
      const retained=createPlant(kit,next),removed=createPiece(kit,f,'stem',0,amount)
      const keep=Boolean(retained.getObjectByName('part-leaf-0')),drop=Boolean(removed.getObjectByName('part-leaf-0'))
      expect(Number(keep)+Number(drop)).toBe(1)
      expect(keep).toBe(amount<=.1)
      disposeGeometry(retained);disposeGeometry(removed)
    }
    disposeGeometry(kit);material.dispose()
  })
  it('截断圆柱保留截面、法线和 UV，体积符合实际剩余长度',()=>{
    const source=new CylinderGeometry(.01,.01,.12,48,2)
    source.translate(0,.06,0)
    const original=source.getAttribute('position').array.slice()
    const geometry=sliceY(source,.031,.083),box=new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never)
    expect(box.min.y).toBeCloseTo(.031,6);expect(box.max.y).toBeCloseTo(.083,6)
    const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv')
    expect(n.count).toBe(p.count);expect(uv.count).toBe(p.count)
    let volume=0,up=0,down=0
    for(let i=0;i<p.count;i+=3){
      const a=new Vector3().fromBufferAttribute(p,i),b=new Vector3().fromBufferAttribute(p,i+1),c=new Vector3().fromBufferAttribute(p,i+2)
      volume+=a.dot(b.clone().cross(c))/6
      if(Math.abs(a.y-.031)<1e-6&&n.getY(i)<-.99)down++
      if(Math.abs(a.y-.083)<1e-6&&n.getY(i)>.99)up++
    }
    expect(volume).toBeCloseTo(Math.PI*.01*.01*.052,6)
    expect(up).toBeGreaterThan(8);expect(down).toBeGreaterThan(8)
    expect(geometry.groups.reduce((sum,g)=>sum+g.count,0)).toBe(p.count)
    expect(source.getAttribute('position').array).toEqual(original)
    source.dispose();geometry.dispose()
  })
})
describe('桌面定高搬动',()=>{
  it('跟随桌面落点，在桌沿向内滚动一格立即离开边缘',()=>{
    const root=new Group(),height=.854
    root.position.set(0,.774,-.215)
    const bounds=new Box3(new Vector3(-.035,0,-.035),new Vector3(.035,.105,.035))
    const ray=(x:number,z:number)=>new Ray(new Vector3(x,2,z),new Vector3(0,-1,0))
    const carry=beginTableCarry(root,new Vector3(),ray(0,-.215),height,.815)
    const inside=ray(-.2,.18),pastEdge=ray(.3,-.8)
    moveOnTable(root,bounds,carry,inside)
    const first=root.position.clone()
    moveOnTable(root,bounds,carry,pastEdge)
    expect(root.position.z).toBeCloseTo(DESK.back-bounds.min.z)
    moveOnTable(root,bounds,carry,inside)
    expect(root.position.toArray()).toEqual(first.toArray())
    moveOnTable(root,bounds,carry,pastEdge)
    moveOnTable(root,bounds,carry,pastEdge,.07)
    expect(root.position.z).toBeCloseTo(DESK.back-bounds.min.z+.07)
    expect(root.position.y).toBe(height)
  })
})

describe('物体附近控件避让',()=>{
  it('桌面与窄屏的控件保持可见并避开瓶口及花枝',()=>{
    for(const width of [1440,390]){
      const panel={width:width<600?235:320,height:90},view={width,height:844}
      const avoid=[{left:width/2-55,right:width/2+55,top:420,bottom:630},{left:20,right:120,top:180,bottom:470},{left:15,right:width-15,top:12,bottom:125}]
      const p=floatPosition(view,panel,{x:width/2,y:490},avoid),rect={left:p.x-panel.width/2,right:p.x+panel.width/2,top:p.y,bottom:p.y+panel.height}
      expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(width)
      expect(rect.top).toBeGreaterThanOrEqual(0);expect(rect.bottom).toBeLessThanOrEqual(view.height)
      expect(avoid.map(r=>overlap(rect,r))).toEqual([0,0,0])
    }
  })
})
