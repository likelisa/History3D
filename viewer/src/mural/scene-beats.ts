import type { SourceKind } from './story.ts'

export type SceneBeatId =
  | 'opening' | 'departure' | 'mountain' | 'detention' | 'westward'
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
  "c0-0": {
    "id": "opening",
    "title": "张骞接下求盟的使命",
    "visualSeconds": 1,
    "sourceKind": "history",
    "boundaryNote": "史书补充：求盟为首次出使的任务，非原画直接画出的缘由。人物与马为Tripo资产，长杖、服装及布景为艺术示意。"
  },
  "c1-0": {
    "id": "departure",
    "title": "陇西出发：使团走向旷野",
    "visualSeconds": 6,
    "sourceKind": "history",
    "boundaryNote": "史书补充：从陇西出发，非原画直接画出的路线。新增出发环境为项目制作；土墙、木质出入口和道路为示意，不认定具体出塞地点。少量Tripo人物代表百余人的使团。"
  },
  "c1-1": {
    "id": "detention",
    "title": "匈奴拦截：任务中断",
    "visualSeconds": 12,
    "sourceKind": "history",
    "boundaryNote": "史书补充：使团被匈奴拦截和扣留，非原画直接画出的事件。营地、匿名守卫和护送动作是展示补全。"
  },
  "c1-2": {
    "id": "retained-credential",
    "title": "被扣多年，仍保留汉节",
    "visualSeconds": 6,
    "sourceKind": "history",
    "boundaryNote": "史书补充：十余年扣留中持汉节不失，非原画直接画出的事件。长杖仅示意使者身份，非汉节考古复原。"
  },
  "c2-0": {
    "id": "westward",
    "title": "脱身后继续寻找月氏",
    "visualSeconds": 7,
    "sourceKind": "history",
    "boundaryNote": "史书补充：张骞脱身后继续西行，非原画直接画出的逃出过程。此处只表现继续赶路，不虚构追逐或具体脱身动作。"
  },
  "c3-0": {
    "id": "audience",
    "title": "月氏接见：安居之后不愿开战",
    "visualSeconds": 7,
    "sourceKind": "history",
    "boundaryNote": "史书补充：月氏不愿为旧仇开战，非原画直接画出的接见。王庭与礼仪为示意，接待者匿名，不断定统治者性别。"
  },
  "c3-1": {
    "id": "audience",
    "title": "求盟未成：双方处境不同",
    "visualSeconds": 1,
    "sourceKind": "history",
    "boundaryNote": "史书补充：月氏以汉远而无意复仇，非原画直接画出的外交过程。镜头不表现签约、欢庆或达成盟约。"
  },
  "c4-0": {
    "id": "market",
    "title": "大夏城邑与商人往来",
    "visualSeconds": 6,
    "sourceKind": "history",
    "boundaryNote": "史书补充：大夏有城屋和市场，非原画直接画出的市场细节。建筑、摊位、货物和人物为展示示意。"
  },
  "c4-1": {
    "id": "goods",
    "title": "熟悉的蜀布和邛竹杖",
    "visualSeconds": 6,
    "sourceKind": "history",
    "boundaryNote": "史书补充：张骞在大夏见四川货物，非原画直接画出的物品。布与竹杖为示意，不用使团长杖替代市场货物。"
  },
  "c4-2": {
    "id": "goods",
    "title": "追问货物来源：身毒",
    "visualSeconds": 1,
    "sourceKind": "history",
    "boundaryNote": "史书补充：身毒信息来自大夏人的转述及张骞推测，非原画直接画出的问答。没有表示张骞亲自到印度。"
  },
  "c7-2": {
    "id": "tower",
    "title": "后世以僧塔记住远行",
    "visualSeconds": 5,
    "sourceKind": "interpretation",
    "boundaryNote": "壁画叙事：僧人与佛塔属于后世佛教叙事；3D为图像转译，不能当作汉代问佛现场，也不是汉代现场实录。"
  }
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
