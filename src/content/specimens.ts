export type SpecimenForm = 'ray'|'pom'|'spray'|'bell'|'blade'|'compound'|'fern'|'lobed'|'plume'|'panicle'
export type Specimen = { label:string; category:string; form:SpecimenForm; accent:string; green:string; count:number; width:number; length:number }
// Reference names come from the practice sheet. Unlabelled wild samples retain photograph order.
export const SPECIMENS = {
  'meadow-daisy': {label:'雏菊',category:'花材',form:'ray',accent:'#fff8e3',green:'#6e834a',count:18,width:1,length:0.26},
  'painted-daisy': {label:'油画小菊',category:'花材',form:'ray',accent:'#e9ba35',green:'#718149',count:8,width:1.2,length:0.26},
  'calendula': {label:'金盏花',category:'花材',form:'ray',accent:'#ed9d27',green:'#7f8544',count:34,width:1.25,length:0.25},
  'button-yellow': {label:'小雏菊（黄）',category:'花材',form:'pom',accent:'#e6c54c',green:'#748449',count:22,width:1,length:0.23},
  'button-green': {label:'小雏菊（绿）',category:'花材',form:'pom',accent:'#9aaf53',green:'#618148',count:29,width:0.93,length:0.225},
  'bridal-spray': {label:'小手球',category:'花材',form:'spray',accent:'#f6eed7',green:'#748e59',count:6,width:0.88,length:0.265},
  'calamus': {label:'菖蒲',category:'线条花材',form:'blade',accent:'#9ca559',green:'#607e46',count:5,width:1.05,length:0.275},
  'orchid-blade': {label:'春兰叶',category:'线条花材',form:'blade',accent:'#728e5b',green:'#496d46',count:8,width:0.7,length:0.28},
  'snow-willow': {label:'雪柳',category:'线条花材',form:'spray',accent:'#fffbed',green:'#8a9258',count:12,width:0.65,length:0.31},
  'fountain-grass': {label:'喷泉草',category:'线条花材',form:'plume',accent:'#a6aa69',green:'#6f8b4e',count:25,width:1.12,length:0.29},
  'mexican-orange': {label:'墨西哥橘叶',category:'叶材',form:'compound',accent:'#849d60',green:'#4c724c',count:3,width:1.2,length:0.245},
  'hare-fern': {label:'狼尾蕨',category:'叶材',form:'fern',accent:'#779558',green:'#547443',count:14,width:0.8,length:0.29},
  'apo-fern': {label:'阿波蕨',category:'叶材',form:'lobed',accent:'#769a5b',green:'#487653',count:6,width:1.19,length:0.255},
  'alpine-fern': {label:'高山羊齿',category:'叶材',form:'fern',accent:'#8aa263',green:'#587948',count:10,width:1.19,length:0.27},
  'wild-ray': {label:'山野花枝一',category:'山野花材',form:'ray',accent:'#eec348',green:'#71854f',count:8,width:1.05,length:0.24},
  'wild-bell': {label:'山野花枝二',category:'山野花材',form:'bell',accent:'#ebe6cc',green:'#728353',count:4,width:0.84,length:0.25},
  'wild-amber': {label:'山野花枝三',category:'山野花材',form:'ray',accent:'#e78e38',green:'#67814a',count:12,width:0.8,length:0.24},
  'wild-oval': {label:'山野叶枝一',category:'山野花材',form:'compound',accent:'#84a16a',green:'#547855',count:4,width:1.05,length:0.235},
  'wild-vine': {label:'山野叶枝二',category:'山野花材',form:'compound',accent:'#899c64',green:'#5c8057',count:7,width:0.71,length:0.26},
  'wild-frond': {label:'山野叶枝三',category:'山野花材',form:'fern',accent:'#7e9e6e',green:'#4d7857',count:8,width:0.94,length:0.235},
  'wild-lance': {label:'山野叶枝四',category:'山野花材',form:'blade',accent:'#839a69',green:'#4c704d',count:3,width:1.13,length:0.24},
  'wild-meadow': {label:'山野草穗一',category:'山野花材',form:'panicle',accent:'#b6a688',green:'#748258',count:13,width:0.83,length:0.28},
  'wild-tail': {label:'山野草穗二',category:'山野花材',form:'plume',accent:'#bba67c',green:'#78844e',count:16,width:0.82,length:0.265},
} as const satisfies Record<string,Specimen>
export type SpecimenId=keyof typeof SPECIMENS
export function specimen(kind:string):Specimen|undefined{
  return Object.hasOwn(SPECIMENS,kind)?SPECIMENS[kind as SpecimenId]:undefined
}
