import type { Chapter } from '../game/types'
export const CHAPTERS: { id: Chapter; number: string; name: string; title: string; hint: string; source: string }[] = [
  { id: 'opening', number: '起', name: '调心', title: '在花与自然之间，慢下来。', hint: '先环顾四周。准备好时，回到桌前，开始这一席插花。', source: '原文 P002—P007 的简短转译' },
  { id: 'prepare', number: '一', name: '静心备席', title: '让手边的一切，慢慢就位。', hint: '把杯中花草取到左侧，再用杯中清水注入花瓶。花剪留在右手边。', source: '原文 P008—P018；玻璃杯代替水壶为产品转译' },
  { id: 'observe', number: '二', name: '缘起赏花', title: '先看见，再安放。', hint: '拿起一枝，转动看看花、叶和茎的姿态。不必急着判断好不好看。', source: '原文 P019—P029 的简短转译' },
  { id: 'trim', number: '三', name: '慈心修剪', title: '有所取舍，也可以保留原样。', hint: '拿起花剪，预览要剪去的叶片或茎长。无需为了修剪而修剪。', source: '原文 P030—P038；茎长剪短为产品补充' },
  { id: 'arrange', number: '四', name: '正念插花', title: '顺着花的方向，找到自己的节奏。', hint: '把花枝拖到瓶口，轻轻调整深浅和朝向。少用几枝，也可以。', source: '原文 P039—P050 的简短转译' },
  { id: 'tidy', number: '四 · 收', name: '整理桌面', title: '将作品留在眼前。', hint: '收好工具、清理实际产生的碎屑。整理属于第四式的收尾。', source: '原文 P051 的简短转译' },
  { id: 'bless', number: '五', name: '无限祝愿', title: '把这份心意，轻轻送出。', hint: '想起一位你想感谢的人。可以写一句祝愿，也可以只在心中完成。', source: '原文 P052—P063 的简短转译' },
  { id: 'done', number: '终', name: '完成', title: '一席花，一段自己的时光。', hint: '保存眼前的作品，或回到桌前继续调整。没有唯一正确的样子。', source: '产品收尾界面' },
]
