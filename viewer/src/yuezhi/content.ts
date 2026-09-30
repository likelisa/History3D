import type { Vec3 } from '../../../contracts/src/types.ts'

export const STORY_ID = 'zhang-qian-yuezhi'
export const REVISION = 1

export const chapters = [
  {
    title: '带着一个约定而来', subtitle: '汉廷的期待', number: '01',
    kicker: '抵达月氏',
    text: '汉廷希望联合月氏，共同对付匈奴。张骞带着这项任务出发，在匈奴被留十余年后逃离，经大宛、康居，终于抵达大月氏。',
    question: '共同的敌人，能让双方走到一起吗？',
    position: [-10, 4.6, 13] as Vec3, target: [-3, 1.1, 3] as Vec3,
    action: '去了解月氏的处境', sourceIds: ['shiji-mission', 'shiji-arrival'],
  },
  {
    title: '抵达了，目标却不同', subtitle: '月氏的处境', number: '02',
    kicker: '观察这片生活空间',
    text: '史书中的月氏已迁居新的土地。走近三个线索，看看张骞面对的是怎样的处境。这里的河谷、人物和布局是空间示意，讲述依据可以逐条查看。',
    question: '旧日的仇怨，还是现在的生活？',
    position: [12, 5, 10] as Vec3, target: [3, 1, -3] as Vec3,
    action: '看看你的判断', sourceIds: ['shiji-disposition'],
  },
  {
    title: '未得约定，带回见闻', subtitle: '出使的结果', number: '03',
    kicker: '这次出使留下了什么',
    text: '《史记》写张骞“竟不能得月氏要领”。按出使目标理解，他未能取得期望的联合约定。后来回到汉朝，他报告了亲历与传闻中的西域诸国。',
    question: '外交目标未成，认识却向西展开。',
    position: [2, 8.8, 18] as Vec3, target: [0, 1, 0] as Vec3,
    action: '回看完整故事', sourceIds: ['shiji-disposition', 'shiji-report'],
  },
]

export const clues = [
  { id: 'settled', title: '安居的生活', label: '土地与生活', position: [-9, 1.6, -4] as Vec3,
    text: '《史记》描述月氏“地肥饶，少寇，志安乐”。史书记述他们所处的生活环境与取向；画面里的水源和牧地帮助理解这层处境，并非会见地点的复原。',
    sourceIds: ['shiji-disposition'], camera: [-10, 3.4, 5] as Vec3, target: [-9, 0.7, -5] as Vec3 },
  { id: 'distance', title: '遥远的汉朝', label: '距离与承诺', position: [7, 1.9, -4] as Vec3,
    text: '史书同时记下“又自以远汉”。地理上的遥远也是当时处境的一部分。这里不把古籍中的里数换算成精确现代路线，也不把观点写成虚构谈判对白。',
    sourceIds: ['shiji-disposition'], camera: [10, 2.6, 3] as Vec3, target: [5, 1.2, -4] as Vec3 },
  { id: 'past', title: '共同的旧敌', label: '过去与现在', position: [-3, 2, 4] as Vec3,
    text: '汉廷听闻月氏与匈奴的旧仇，因此希望通使。但关于抵达后的月氏，《史记》写“殊无报胡之心”。这两处记述共同解释了原先期待与实际结果之间的落差。',
    sourceIds: ['shiji-mission', 'shiji-disposition'], camera: [-5, 2.6, 10] as Vec3, target: [-3, 1.2, 4] as Vec3 },
]

export const sources = [
  { id: 'shiji-mission', title: '出使缘起与途中被留', location: '《史记》卷123〈张骞〉第一段',
    excerpt: '月氏遁逃而常怨仇匈奴，無與共擊之。漢方欲事滅胡，聞此言，因欲通使。……留騫十餘歲，與妻，有子，然騫持漢節不失。',
    note: '同段记载张骞应募、与堂邑父出发、被留十余岁，并持汉节不失。', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫' },
  { id: 'shiji-arrival', title: '抵达的叙事顺序', location: '《史记》卷123〈张骞〉第二段',
    excerpt: '騫因與其屬亡鄉月氏，西走數十日至大宛。……抵康居，康居傳致大月氏。', note: '同段记载逃离匈奴后至大宛。省略号表示不连续摘录，路线图只呈现叙事顺序。', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫' },
  { id: 'shiji-disposition', title: '月氏处境与出使结果', location: '《史记》卷123〈张骞〉第二段',
    excerpt: '地肥饒，少寇，志安樂，又自以遠漢，殊無報胡之心。騫從月氏至大夏，竟不能得月氏要領。',
    note: '“未取得联合约定”是依出使目标作的限义释读。没有可据以重演具体谈判的对白。', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫' },
  { id: 'shiji-report', title: '返回与报告见闻', location: '《史记》卷123〈张骞〉第三段及下文',
    excerpt: '騫身所至者大宛、大月氏、大夏、康居，而傳聞其旁大國五六，具為天子言之。',
    note: '需区分张骞亲历与传闻；本段结束并非张骞全部生平的终点。', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫' },
]

export const boundary = '历史事件依据古籍数字文本；人物相貌、服饰、具体会面地点、河谷布局和尺寸为制作示意。月氏继位者在《史记》《汉书》中有太子／夫人异文，本场景不指定其身份。数字文本核对不能替代底本校勘与最终史料审核。'
