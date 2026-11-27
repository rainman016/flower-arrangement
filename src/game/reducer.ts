import { CUP_START, SHEARS_START, validRotation } from './desk-layout'
import { CUP_FLOWERS, FLOWERS, MAX_FLOWERS, MATERIAL_LIMITS, stockLength } from '../content/catalog'
import { fitDepth, availablePose, defaultPose, normalizePose, poseProblem, visibleParts } from './rules'
import type { Arrangement, Command, Context, FlowerState, Transition } from './types'
import { MIN_STEM, cutProblem, sectionEnd, TABLE_BOUNDS, validPlacement } from './free-cut'

export function reduceCommand(state: Arrangement, command: Command, context: Context = { tool: null }): Transition {
  const fail=(error:string):Transition=>({state,label:'',error})
  const done=(next:Arrangement,label:string):Transition=>JSON.stringify(next)===JSON.stringify(state)?{state,label:'没有改变'}:{state:next,label}
  const flower='id' in command?state.flowers.find((f)=>f.id===command.id):undefined
  const update=(f:FlowerState,label:string,extra:Partial<Arrangement>={})=>done({...state,...extra,flowers:state.flowers.map((item)=>item.id===f.id?f:item)},label)
  switch(command.type){
    case 'add':{
      if (!Object.hasOwn(FLOWERS,command.kind))return fail('未找到这种花材')
      if(state.flowers.length>=MAX_FLOWERS)return fail('手边花材已满，可以先移出一枝')
      let slot=0;while(state.flowers.some((f)=>f.slot===slot))slot++
      return done({...state,nextId:state.nextId+1,flowers:[...state.flowers,{id:'f-'+state.nextId,kind:command.kind,location:'table',length:FLOWERS[command.kind].length,removed:[],pose:defaultPose(),slot}]},'已补充一枝'+FLOWERS[command.kind].name)
    }
    case 'choose-cup-flowers': {
      const remaining = [...command.kinds]
      if (remaining.some(kind => !Object.hasOwn(CUP_FLOWERS, kind))) return fail('未找到这种花材')
      const outside = state.flowers.filter(f => f.location !== 'cup').length
      if (outside + remaining.length > MAX_FLOWERS || outside + remaining.length === 0) return fail('请为本席选 1 至 12 枝花草')
      const flowers = state.flowers.filter(f => {
        if (f.location !== 'cup') return true
        const index = remaining.indexOf(f.kind)
        if (index === -1) return false
        remaining.splice(index, 1)
        return true
      })
      let nextId = state.nextId
      for (const kind of remaining) {
        let slot = 0
        while (flowers.some(f => f.slot === slot)) slot++
        flowers.push({id:'f-'+nextId++,kind,slot,location:'cup',length:CUP_FLOWERS[kind].length,removed:[],pose:defaultPose()})
      }
      return done({...state,flowers,nextId},'本席花材已选好。')
    }
    case 'set-materials':{
      const {choices,destination}=command
      const original=destination==='cup'?state.flowers.filter(f=>f.location==='cup'):[]
      const keepCount=state.flowers.length-original.length
      if(keepCount+choices.length<1||keepCount+choices.length>MAX_FLOWERS)return fail('本席可选 1 至 12 枝花草')
      const edited=new Map<string,FlowerState>()
      const added:FlowerState[]=[]
      let nextId=state.nextId
      const reserved=new Set(state.flowers.filter(f=>!original.includes(f)||choices.some(c=>c.id===f.id)).map(f=>f.slot))
      for(const c of choices){
        if(!Object.hasOwn(CUP_FLOWERS,c.kind)||!Number.isFinite(c.length)||c.length<MATERIAL_LIMITS.minLength||c.length>MATERIAL_LIMITS.maxLength||
          !Number.isFinite(c.headScale)||c.headScale<MATERIAL_LIMITS.minHead||c.headScale>MATERIAL_LIMITS.maxHead)return fail('花材尺寸超出范围')
        const prior=c.id?original.find(f=>f.id===c.id):undefined
        if(c.id&&(!prior||prior.kind!==c.kind||edited.has(c.id)))return fail('花枝已发生变化，请重新选取')
        let stem:FlowerState
        if(prior)stem=prior
        else{
          let slot=0
          while(reserved.has(slot))slot++
          reserved.add(slot)
          stem={id:'f-'+nextId++,kind:c.kind,slot,location:destination,length:CUP_FLOWERS[c.kind].length,pose:defaultPose(),removed:[]}
        }
        if(c.length!==stem.length)stem={...stem,stockLength:stockLength(stem)*c.length/stem.length,length:c.length}
        if(c.headScale!==(stem.headScale??1))stem={...stem,headScale:c.headScale}
        if(prior)edited.set(prior.id,stem)
        else added.push(stem)
      }
      const flowers=state.flowers.flatMap(f=>!original.includes(f)?[f]:edited.has(f.id)?[edited.get(f.id)!]:[])
      return done({...state,flowers:[...flowers,...added],nextId},destination==='cup'?'杯中花材已备好。':'新花材已放到桌上。')
    }
    case 'empty-cup':return done({...state,flowers:state.flowers.map((f)=>f.location==='cup'?{...f,location:'table'}:f)},'已将杯中花草放到左侧')
    case 'pour':{
      if(context.tool!=='cup')return fail('先拿起玻璃杯')
      if(state.flowers.some((f)=>f.location==='cup'))return fail('杯中还有花草，请先取出再注水')
      if(!Number.isFinite(command.ml)||command.ml<=0)return fail('注水量无效')
      const amount=Math.min(command.ml,state.cupMl,130-state.vaseMl)
      const spill=command.spill??0
      if(!Number.isFinite(spill)||spill<0||spill>6.001||spill>0&&state.vaseMl+amount<129.999)return fail('溢水量无效')
      const lost=Math.min(spill,state.cupMl-amount)
      if(amount+lost<=0)return fail('花瓶已满')
      return done({...state,cupMl:state.cupMl-amount-lost,vaseMl:state.vaseMl+amount,...(lost?{spillMl:(state.spillMl??0)+lost}:{})},lost?'少量水已溢出，已停水。':'已缓缓注入清水')
    }
    case 'restore-water':{
      const {cupMl,vaseMl,spillMl}=command
      if(context.tool!=='cup'||![cupMl,vaseMl,spillMl].every(n=>Number.isFinite(n)&&n>=0)||vaseMl>130||Math.abs(cupMl+vaseMl+spillMl-180)>.001)return fail('水量无效')
      return done({...state,cupMl,vaseMl,spillMl},'已恢复本次倒水前的水量。')
    }
    case 'move-vase':{
      const v={...state.vase,...command.pose}
      if(!Object.values(v).every(Number.isFinite)||Math.abs(v.x)>.04||Math.abs(v.z)>.04)return fail('请将花瓶留在托盘中央范围内')
      v.yaw=((v.yaw%360)+360)%360
      return done({...state,vase:v},'已调整整件作品')
    }
    case 'set-prop': {
      const [x,y,z]=command.position
      if(!state.tools||!command.position.every(Number.isFinite)||Math.abs(x)>.6||z<-.51||z>TABLE_BOUNDS.front+.015||y<.74||y>1.18||(command.rotation&&!validRotation(command.rotation)))return fail('请把器物放在桌面内。')
      const tools={...state.tools,...(command.prop==='cup'?{}:{placed:{...state.tools.placed,[command.prop]:true as const}}),rotations:{...state.tools.rotations,...(command.rotation?{[command.prop]:command.rotation}:{})}}
      if(command.prop==='vase')return done({...state,vase:{...state.vase,x,z:z+.025},tools:{...tools,vaseY:y}},'花器已放好。')
      return done({...state,tools:{...tools,[command.prop]:[x,y,z]}},command.prop==='cup'?'玻璃杯已放好。':'花剪已放好。')
    }
    case 'clear-piece':return done({...state,debris:state.debris.filter(d=>d.id!==command.id)},'已拾起这片茎叶。')
    case 'clear-gathered':return done({...state,debris:state.debris.filter(d=>!d.gathered)},'已清理归拢的残枝，可以撤销。')
    case 'move-pieces':
    case 'tidy':{
      const placements=command.placements??[]
      const moves=new Map(placements.map(p=>[p.id,p]))
      if(moves.size!==placements.length||placements.some(p=>{
        const piece=state.debris.find(d=>d.id===p.id)
        return !piece?.shape||!validPlacement({...piece.shape,landing:p.landing,resting:p.resting})
      }))return fail('碎枝落点超出桌面。')
      const debris=state.debris.map(piece=>{
        const move=moves.get(piece.id)
        if(!move||!piece.shape)return piece
        const pose=piece.shape
        const sameSpot=move.landing.every((v,i)=>Math.abs(v-pose.landing[i])<1e-7)
        const alignment=move.resting.reduce((sum,v,i)=>sum+v*pose.resting[i],0)
        const gathered=command.type==='tidy'||command.gather===true
        if(sameSpot&&Math.abs(alignment)>1-1e-9&&Boolean(piece.gathered)===gathered)return piece
        return {...piece,gathered,shape:{...pose,landing:move.landing,resting:move.resting}}
      })
      if(command.type==='move-pieces')return done({...state,debris},placements.length===1?'已放好这片枝叶。':'碎枝已归到桌边。')
      if(state.tools)return done({...state,debris,tools:{layout:2,cup:[...CUP_START],scissors:[...SHEARS_START],vaseY:.759,...(state.tools.rotations?.vase?{rotations:{vase:state.tools.rotations.vase}}:{})},vase:{x:0,z:.30,yaw:state.vase.yaw}},'工具已收好，作品已移到身前。')
      return done({...state,debris:[],vase:{x:0,z:0,yaw:state.vase.yaw}},'已整理桌面，作品归中')
    }
  }
  if(!flower)return fail('未找到这枝花。')
  switch(command.type){
    case 'remove':return done({...state,flowers:state.flowers.filter((f)=>f.id!==flower.id)},'已移出这枝花，可以撤销')
    case 'place-flower':{
      const p=command.position,b=TABLE_BOUNDS
      if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)||p[0]<b.left||p[0]>b.right||p[2]<b.back||p[2]>b.front||p[1]<.74||p[1]>1.26||(command.rotation&&!validRotation(command.rotation)))return fail('请把花枝放在桌面范围内。')
      return update({...flower,location:'table',table:[...p],tableRotation:command.rotation??flower.tableRotation},'花枝已放回桌面。')
    }
    case 'free-cut':{
      if(context.tool!=='scissors')return fail('先拿起花剪。')
      const problem=cutProblem(flower,command.target,command.at)
      if(problem)return fail(problem)
      if(state.debris.length>=150)return fail('本席已保留 150 片碎枝，可以撤销一剪或继续插花。')
      if(!validPlacement(command.placement))return fail('剪落位置无效，请重新对准。')
      const stem=command.target==='stem',end=stem?flower.length:sectionEnd(flower,command.target)
      const at=Math.round(command.at*100000)/100000
      if(cutProblem(flower,command.target,at))return fail('请稍微调整剪口。')
      const length=Math.round((flower.length-at)*1e6)/1e6
      const next=stem?{...flower,length,pose:{...flower.pose,depth:fitDepth(flower.pose.depth,length)}}:{...flower,sections:{...flower.sections,[command.target]:at},removed:at===0?[...flower.removed,command.target]:flower.removed}
      const shape={flower:structuredClone(flower),target:command.target,from:stem?0:at,to:stem?at:end,...structuredClone(command.placement)}
      let serial=state.debris.length+1
      while(state.debris.some(d=>d.id===flower.id+'-free-'+serial))serial++
      return update(next,stem?'已按剪口剪短花茎。':'已剪下所选部位，剩余枝段保留。',{debris:[...state.debris,{id:flower.id+'-free-'+serial,flowerId:flower.id,part:command.target,shape}]})
    }
    case 'to-table':return update({...flower,location:'table'},'已将花材放到左侧')
    case 'insert':{
      if(context.tool)return fail('先放回手中的工具')
      const pose=command.pose?normalizePose(command.pose):command.position?normalizePose({...flower.pose,...command.position}):availablePose(state,flower)
      if(!pose)return fail('瓶口暂时没有合适的位置，可以取出或调整已有花枝')
      const problem=poseProblem(state,flower,pose)
      if(problem)return fail(problem)
      return update({...flower,location:'vase',pose},'已将花枝安放在瓶中')
    }
    case 'rotate':{
      if(!Number.isFinite(command.degrees))return fail('旋转角度无效')
      const pose=normalizePose({...flower.pose,yaw:flower.pose.yaw+command.degrees})
      const problem=flower.location==='vase'?poseProblem(state,flower,pose):undefined
      if(problem)return fail(problem)
      return update({...flower,pose},'已转动花枝')
    }
    case 'adjust':{
      if(flower.location!=='vase')return fail('先放入花瓶，再调整插点和深度')
      if(Object.keys(command.pose).some((k)=>!['yaw','tilt','depth','x','z'].includes(k)))return fail('调整属性无效')
      const pose=normalizePose({...flower.pose,...command.pose})
      const problem=poseProblem(state,flower,pose)
      if(problem)return fail(problem)
      return update({...flower,pose},'已调整花枝')
    }
    case 'cut-part':
    case 'cut-length':{
      if(context.tool!=='scissors')return fail('先拿起花剪')
      if(flower.location==='vase')return fail('先取出已插花枝，再进行修剪')
      if(state.debris.length>=150)return fail('本席已保留 150 片碎枝，可以撤销一剪或继续插花。')
      if(command.type==='cut-part'){
        if(!visibleParts(flower).some((p)=>p.id===command.part))return fail('这个部位已剪去或不在可剪范围')
        return update({...flower,removed:[...flower.removed,command.part]},'已剪去选中部位',{debris:[...state.debris,{id:flower.id+'-'+command.part,flowerId:flower.id,part:command.part}]})
      }
      if(!Number.isFinite(command.length)||command.length<MIN_STEM||command.length>=flower.length)return fail('请在当前花茎上选择剪口')
      const length=Math.round(command.length*1000)/1000
      if(length>=flower.length)return fail('剪短长度太小')
      return update({...flower,length,pose:{...flower.pose,depth:fitDepth(flower.pose.depth,length)}},'已剪短花茎',{debris:[...state.debris,{id:flower.id+'-stem-'+length,flowerId:flower.id,part:'stem'}]})
    }
  }
}
