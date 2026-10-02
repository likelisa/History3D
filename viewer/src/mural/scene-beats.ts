import type { SourceKind } from './story.ts'

export type SceneBeatId =
  | 'mountain' | 'detention' | 'westward'
  | 'credential' | 'retained-credential' | 'audience'
  | 'city' | 'market' | 'goods' | 'greeting' | 'tower'

export type SceneBeat = {
  id: SceneBeatId
  title: string
  visualSeconds: number
  sourceKind: SourceKind
  boundaryNote: string
}

// Each cue completes its own visual action and camera move before narration.
// These durations belong inside the cue; the playback timeline must also reserve
// narration and its tail, rather than advancing at the end of this visual beat.
const sceneBeats: Readonly<Record<string, SceneBeat>> = {
  'c3-0': {
    id: 'mountain', title: '使团沿山路前行', visualSeconds: 6, sourceKind: 'mural',
    boundaryNote: '依壁画山间汉使转译为3D；山道地形、人物背面与步行动作属于展示补全。',
  },
  'c3-1': {
    id: 'detention', title: '匈奴营地：使团受阻驻足', visualSeconds: 7, sourceKind: 'history',
    boundaryNote: '史书补充：张骞被匈奴扣留十余年，非原画直接画出的事件；营地布局与匿名守卫是展示补全。',
  },
  'c3-2': {
    id: 'westward', title: '逃出后继续西行', visualSeconds: 7, sourceKind: 'history',
    boundaryNote: '史书补充：逃出后经大宛、康居到达大月氏，非原画直接画出的事件；行进路线作示意。',
  },
  'c4-0': {
    id: 'credential', title: '近看使团的旌节', visualSeconds: 5, sourceKind: 'mural',
    boundaryNote: '依壁画中长杆旌节作近景转译；材质与持握动作属于展示补全。',
  },
  'c4-1': {
    id: 'retained-credential', title: '被扣多年，仍保留汉节', visualSeconds: 6, sourceKind: 'history',
    boundaryNote: '史书补充：张骞留匈奴中持汉节不失，非原画直接画出的事件；近景强调使者身份。',
  },
  'c4-2': {
    id: 'audience', title: '月氏王庭接见：求盟未成', visualSeconds: 7, sourceKind: 'history',
    boundaryNote: '史书补充：月氏安居且远离汉朝，不愿为旧仇开战；非原画直接画出的接见。王庭有记载，建筑与礼仪为示意；主位为接待方示意，不断定统治者性别。',
  },
  'c5-0': {
    id: 'city', title: '使者走向大夏城门', visualSeconds: 7, sourceKind: 'mural',
    boundaryNote: '依壁画左上城池与大夏榜题转译；3D城门形制、尺度与进城动作属于展示补全。',
  },
  'c5-1': {
    id: 'market', title: '城屋与市场，各方商人往来', visualSeconds: 6, sourceKind: 'history',
    boundaryNote: '史书补充：大夏有城屋与市场、商人贩卖各方货物，非原画直接画出的市场细节。',
  },
  'c5-2': {
    id: 'goods', title: '近看蜀布与邛竹杖', visualSeconds: 6, sourceKind: 'history',
    boundaryNote: '史书补充：张骞在大夏见蜀布、邛竹杖，听闻由身毒购得；非原画直接画出的货物，形制作示意。',
  },
  'c6-0': {
    id: 'greeting', title: '城门前的僧人迎接使者', visualSeconds: 6, sourceKind: 'mural',
    boundaryNote: '依壁画城门边两位僧人的构图转译；它属于初唐佛教图像叙事，迎接动作不是汉代现场实录。',
  },
  'c6-1': {
    id: 'goods', title: '对照史书：蜀物与身毒见闻', visualSeconds: 5, sourceKind: 'interpretation',
    boundaryNote: '史书补充：所载是蜀物与身毒见闻，未载在大夏询问佛像名号；非原画直接画出的货物，不能当作问佛现场。',
  },
  'c6-2': {
    id: 'tower', title: '僧人与佛塔，后世的佛教讲述', visualSeconds: 6, sourceKind: 'interpretation',
    boundaryNote: '后世佛教叙事把汉使西行连接到佛教传入；僧塔依壁画转译，不能据此认定汉代出使时已问佛。',
  },
}

/** Unknown and non-spatial cues keep the mural presentation. */
export function getSceneBeat(cueId: string): SceneBeat | undefined {
  return Object.hasOwn(sceneBeats, cueId) ? sceneBeats[cueId] : undefined
}

/** Cue-local time, reset on every cue/seek; progress never runs into narration. */
export function sceneBeatProgress(localSeconds: number, beat: SceneBeat): number {
  if (Number.isNaN(localSeconds)) return 0
  return Math.max(0, Math.min(1, localSeconds / beat.visualSeconds))
}

/** Narration starts only after this cue's visual action and camera finish. */
export function isNarrationReady(localSeconds: number, beat: SceneBeat): boolean {
  return localSeconds >= beat.visualSeconds
}
