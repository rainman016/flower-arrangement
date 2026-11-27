export type SceneId = 'bamboo' | 'rain' | 'creek'
export type FlowerKind = 'yellow' | 'white' | 'grass' | 'daisy' | import('../content/specimens').SpecimenId
export type Chapter = 'opening' | 'prepare' | 'observe' | 'trim' | 'arrange' | 'tidy' | 'bless' | 'done'
export type Pose = { yaw: number; tilt: number; depth: number; x: number; z: number }
export type MaterialChoice = { id?:string; kind:FlowerKind; length:number; headScale:number }
export type FlowerState = { stockLength?: number; headScale?: number; id: string; kind: FlowerKind; location: 'cup' | 'table' | 'vase'; length: number; removed: string[]; pose: Pose; slot: number; sections?: Record<string,number>; table?: Vec3; tableRotation?: Quat }
export type Vec3 = [number,number,number]
export type Quat = [number,number,number,number]
export type PiecePlacement = { origin:Vec3; rotation:Quat; landing:Vec3; resting:Quat; contact?:Vec3 }
export type PieceMove = { id:string; landing:Vec3; resting:Quat }
export type CutShape = PiecePlacement & { flower:FlowerState; target:string; from:number; to:number }
export type Debris = { gathered?:boolean; id:string; flowerId:string; part:string; shape?:CutShape }
export type Arrangement = {
  flowers: FlowerState[]
  nextId: number
  spillMl?: number
  cupMl: number
  vaseMl: number
  vase: { x: number; z: number; yaw: number }
  tools?: { cup: Vec3; scissors: Vec3; vaseY: number; layout?: 2; placed?: Partial<Record<'vase'|'scissors',true>>; rotations?: Partial<Record<'vase'|'cup'|'scissors',Quat>> }
  debris: Debris[]
}
export type Session = { sceneId: SceneId; chapter: Chapter; wish: string }
export type Tool = 'cup' | 'scissors' | null
export type Context = { tool: Tool }
export type Command =
  | { type: 'add'; kind: FlowerKind }
  | { type: 'remove' | 'to-table'; id: string }
  | { type: 'insert'; id: string; position?: { x: number; z: number }; pose?: Pose }
  | { type: 'choose-cup-flowers'; kinds: FlowerKind[] }
  | { type: 'set-materials'; destination:'cup'|'table'; choices:MaterialChoice[] }
  | { type: 'empty-cup' }
  | { type: 'pour'; ml: number; spill?: number }
  | { type:'restore-water'; cupMl:number; vaseMl:number; spillMl:number }
  | { type: 'rotate'; id: string; degrees: number }
  | { type: 'adjust'; id: string; pose: Partial<Pose> }
  | { type: 'cut-part'; id: string; part: string }
  | { type: 'cut-length'; id: string; length: number }
  | { type: 'free-cut'; id: string; target:string; at:number; placement:PiecePlacement }
  | { type: 'place-flower'; id:string; position:Vec3; rotation?:Quat }
  | { type: 'move-vase'; pose: Partial<Arrangement['vase']> }
  | { type: 'set-prop'; prop: 'vase'|'scissors'|'cup'; position: Vec3; rotation?:Quat }
  | { type: 'clear-piece'; id: string }
  | { type: 'move-pieces'; placements:PieceMove[]; gather?:boolean }
  | { type: 'clear-gathered' }
  | { type: 'tidy'; placements?:PieceMove[] }
export type Entry = { state: Arrangement; label: string }
export type History = { present: Arrangement; past: Entry[]; future: Entry[] }
export type Transition = { state: Arrangement; label: string; error?: string }
export type CutPreview = { kind: 'part'; id: string; part: string } | { kind: 'length'; id: string; length: number }
