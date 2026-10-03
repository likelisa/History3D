export type SourceKind = 'mural' | 'history' | 'interpretation'
export type ChapterMode = 'overview' | 'mural' | 'spatial'
export type MuralFocus = { x: number; y: number; width: number; height: number }
export type CueDefinition = { id: string; text: string; sourceKind: SourceKind; sourceIds: string[] }
export type StoryCue = CueDefinition & { start: number; end: number; readingSeconds: number }
export type ChapterDefinition = {
  id: string
  title: string
  location: string
  cues: CueDefinition[]
  takeaway: string
  focus: MuralFocus
  mode: ChapterMode
}
export type StoryChapter = Omit<ChapterDefinition, 'cues'> & {
  start: number
  end: number
  text: string
  readingSeconds: number
  cues: StoryCue[]
}
export type MuralAnnotation = {
  id: string
  label: string
  x: number
  y: number
  chapterIndex: number
  detail: string
  sourceKind: SourceKind
  sourceIds: string[]
}

export const sources = [
  { id: 'dha-cave-323', title: '敦煌研究院 · 莫高窟第323窟', url: 'https://www.dha.ac.cn/info/1425/3576.htm', description: '洞窟年代、北壁史迹画、山间使者与僧塔构图，以及初唐佛教叙事的背景。' },
  { id: 'dha-323', title: '敦煌研究院 · 张骞出使西域图', url: 'https://www.dha.ac.cn/info/1266/2524.htm', description: '莫高窟第323窟的年代、三组画面、榜题及佛教史迹画的解读。' },
  { id: 'shiji-123', title: '《史记》卷123 · 大宛列传', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫', description: '首次出使的政治目的、拘留与西行、月氏拒盟原因、大夏见闻及后来使者往来。' },
  { id: 'shiji-111', title: '《史记》卷111 · 卫将军骠骑列传', url: 'https://zh.wikisource.org/wiki/史記/卷111#霍去病', description: '霍去病取得休屠祭天金人的记载；未将金人认作佛像。' },
  { id: 'weishu-114', title: '《魏书》卷114 · 释老志', url: 'https://zh.wikisource.org/wiki/魏書/卷114#釋', description: '后世将甘泉宫金人与张骞西行接入佛教传播史的文献叙事。' },
  { id: 'hanshu-61', title: '《汉书》· 张骞李广利传', url: 'https://ctext.org/han-shu/zhang-qian-li-guang-li-zhuan/zh', description: '交叉核对拘留、持汉节、传译和求盟未成；与《史记》对月氏继位者的记载有差异，画面不认定其肖像。' },
  { id: 'hanshu-96', title: '《汉书》· 西域传', url: 'https://ctext.org/han-shu/xi-yu-zhuan/zh', description: '月氏迁徙后在妫水北设王庭的背景；未载本次接见的具体建筑与礼仪，3D空间作示意。' },
]

// These are chapters of the image, not eight reconstructed stops of a first embassy.
// The picture supplies neither a Yuezhi audience nor a detention scene.
export const chapterDefinitions: ChapterDefinition[] = [
  {
    id: 'whole-picture', title: '一幅壁画，两层故事', location: '莫高窟第323窟 · 初唐壁画',
    mode: 'overview', focus: { x: 0, y: 0, width: 1, height: 1 },
    takeaway: '沿礼拜、辞行和抵达读画，再追问这段西行的来历。',
    cues: [
      { id: 'c0-0', text: '跟我走近这幅画。先认识张骞和他的使团，再沿着他们的脚步，看看这段远行。', sourceKind: 'interpretation', sourceIds: ['dha-323', 'dha-cave-323'] },
      { id: 'c0-1', text: '你看，右上角是宫殿，下方是辞行，左上角是城池。三个画面，把一次西行串了起来。', sourceKind: 'mural', sourceIds: ['dha-323', 'dha-cave-323'] },
      { id: 'c0-2', text: '我们先从宫殿里的两尊金人看起：皇帝为什么礼拜它们，又为什么派张骞去西域？', sourceKind: 'interpretation', sourceIds: ['dha-323', 'shiji-123'] },
    ],
  },
  {
    id: 'golden-figures', title: '宫殿中的金人之谜', location: '壁画右上 · 宫殿与礼拜',
    mode: 'mural', focus: { x: 0.635, y: 0.035, width: 0.355, height: 0.375 },
    takeaway: '画家把金人画成佛像，用“问名号”引出张骞西行。',
    cues: [
      { id: 'c1-0', text: '请看右上角的甘泉宫。殿里站着两尊金人，汉武帝带着群臣，正在向它们礼拜。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c1-1', text: '在这幅画里，金人被画成了佛像。皇帝还不知道它们的名号，便想派人到远方打听。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c1-2', text: '于是，宫殿里的这个疑问，成了张骞西行的开端。请记住：这是壁画讲述的出使缘由。', sourceKind: 'interpretation', sourceIds: ['shiji-111', 'weishu-114', 'dha-323'] },
    ],
  },
  {
    id: 'farewell', title: '张骞为何出发', location: '壁画下方 · 使者辞行',
    mode: 'mural', focus: { x: 0.04, y: 0.615, width: 0.79, height: 0.375 },
    takeaway: '汉武帝希望联合与匈奴有旧仇的月氏，改变北方的局势。',
    cues: [
      { id: 'c2-0', text: '往下看，骑马的是皇帝，对面持笏跪拜的是张骞。这一刻，他正准备领命出发。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c2-1', text: '张骞最初的任务，是寻找月氏，共同对抗匈奴。你眼前的壁画，却把西行讲成了寻问佛像。', sourceKind: 'history', sourceIds: ['shiji-123'] },
      { id: 'c2-2', text: '月氏曾被匈奴击败，国王也被杀。张骞带着求盟的任务出发；但画中，故事从金人的疑问开始。', sourceKind: 'history', sourceIds: ['shiji-123'] },
    ],
  },
  {
    id: 'westward', title: '受阻十余年，仍然向西', location: '壁画左侧 · 汉使在山间前行',
    mode: 'spatial', focus: { x: 0.005, y: 0.265, width: 0.29, height: 0.285 },
    takeaway: '被扣十余年耽误了行程，却没有让张骞放弃寻找月氏。',
    cues: [
      { id: 'c3-0', text: '现在回到原画左侧。山石间露出一队人马，这条曲折的山路，把辞行和抵达连在一起。', sourceKind: 'mural', sourceIds: ['dha-323', 'dha-cave-323'] },
      { id: 'c3-1', text: '不过，张骞的路并不顺利。途中他被匈奴拦下，扣留十余年；我们用营地场景看看这段受阻。', sourceKind: 'history', sourceIds: ['shiji-123'] },
      { id: 'c3-2', text: '终于脱身后，他没有就此回家，而是继续向西，经大宛、康居，去寻找大月氏。', sourceKind: 'history', sourceIds: ['shiji-123'] },
    ],
  },
  {
    id: 'credential-and-purpose', title: '汉节未失，求盟未成', location: '壁画左中 · 旌节与使团',
    mode: 'spatial', focus: { x: 0.015, y: 0.20, width: 0.28, height: 0.285 },
    takeaway: '张骞守住了使命，但月氏已有安定生活，不愿重启战争。',
    cues: [
      { id: 'c4-0', text: '看随从手中的旌节。这根长杆代表汉朝使者的身份，也代表张骞一直没有放下的使命。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c4-1', text: '被扣留十余年，这根汉节仍在。时间过去了，张骞心里惦记的，还是当年交给他的任务。', sourceKind: 'history', sourceIds: ['shiji-123'] },
      { id: 'c4-2', text: '可月氏已经在西方安居，不愿再为旧仇开战。张骞走到了这里，求盟的愿望却没有实现。', sourceKind: 'history', sourceIds: ['shiji-123'] },
    ],
  },
  {
    id: 'daxia', title: '在大夏看见远方的联系', location: '壁画左上 · 大夏城池',
    mode: 'spatial', focus: { x: 0.005, y: 0.005, width: 0.28, height: 0.285 },
    takeaway: '大夏市场里的蜀布与邛竹杖，揭示了远方已有的贸易联系。',
    cues: [
      { id: 'c5-0', text: '再看原画左上方。使者正走向大夏城门，门外有僧人，城内有佛塔；这就是画中的终点。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c5-1', text: '走进大夏的见闻场景，看看城屋和市场。商人来往、货物交换，远方的世界在这里变得具体。', sourceKind: 'history', sourceIds: ['shiji-123'] },
      { id: 'c5-2', text: '桌上是蜀布和邛竹杖，也就是四川的布和竹杖。它们经身毒转手，竟来到了遥远的大夏。', sourceKind: 'history', sourceIds: ['shiji-123'] },
    ],
  },
  {
    id: 'monks-and-tower', title: '僧人与佛塔从何而来', location: '壁画左上 · 城门与佛塔',
    mode: 'spatial', focus: { x: 0.01, y: 0.01, width: 0.26, height: 0.225 },
    takeaway: '僧塔呼应宫殿中的金人，讲出初唐佛教徒对这段远行的理解。',
    cues: [
      { id: 'c6-0', text: '请回到城门旁，看看这两位僧人，再看城里的佛塔。它们正回应着甘泉宫中金人的疑问。', sourceKind: 'mural', sourceIds: ['dha-323'] },
      { id: 'c6-1', text: '这样一来，金人的身份便揭晓了：在这幅画的故事里，它们是佛像，远行也成了寻问佛教的旅程。', sourceKind: 'interpretation', sourceIds: ['shiji-123', 'dha-323'] },
      { id: 'c6-2', text: '初唐画家借张骞的名声，把佛教的来历讲得更早。眼前的僧人与塔，留下的是后世的历史记忆。', sourceKind: 'interpretation', sourceIds: ['weishu-114', 'dha-323', 'dha-cave-323'] },
    ],
  },
  {
    id: 'return-to-picture', title: '远行留下了什么', location: '回到完整壁画',
    mode: 'overview', focus: { x: 0, y: 0, width: 1, height: 1 },
    takeaway: '求盟虽未成功，交往由此扩展；唐代壁画又留下了佛教的历史记忆。',
    cues: [
      { id: 'c7-0', text: '最后，让我们退回全画。宫殿、辞行、山路和城门，你现在能把这条故事线连起来了吗？', sourceKind: 'interpretation', sourceIds: ['dha-323'] },
      { id: 'c7-1', text: '张骞十三年后回到汉朝，带回了西域见闻。求盟虽未成功，这段远行却为后来的往来铺了路。', sourceKind: 'history', sourceIds: ['shiji-123'] },
      { id: 'c7-2', text: '再看一眼这幅壁画：它既记住了一位远行的使者，也让我们看见，后人怎样重新讲述他的故事。', sourceKind: 'interpretation', sourceIds: ['dha-323', 'weishu-114', 'shiji-123'] },
    ],
  },
]

// A cue has its own reading floor. Recorded audio can extend it, never shorten it.
export function readingSeconds(text: string): number {
  return Math.max(6, Math.ceil(Array.from(text.replace(/\s/g, '')).length / 4 + 1.5))
}

// Cue times are local to their chapter; chapter times are global to the story.
// Duration overrides are final cue lengths, including any audio tail pause.
export function compileChapters(cueDurations: Readonly<Record<string, number>> = {}): StoryChapter[] {
  let storyTime = 0
  return chapterDefinitions.map(definition => {
    let chapterTime = 0
    const cues = definition.cues.map(cue => {
      const floor = readingSeconds(cue.text), override = cueDurations[cue.id]
      if (override !== undefined && (!Number.isFinite(override) || override <= 0)) throw new Error(`Invalid cue duration: ${cue.id}`)
      const seconds = Math.max(floor, override ?? floor)
      const timed = { ...cue, readingSeconds: floor, start: chapterTime, end: chapterTime + seconds }
      chapterTime = timed.end
      return timed
    })
    const chapter: StoryChapter = {
      ...definition, cues, start: storyTime, end: storyTime + chapterTime,
      text: cues.map(cue => cue.text).join(''),
      readingSeconds: cues.reduce((seconds, cue) => seconds + cue.readingSeconds, 0),
    }
    storyTime = chapter.end
    return chapter
  })
}

export const chapters = compileChapters()
export const duration = chapters[chapters.length - 1]!.end

// full.jpg coordinates: x/y in [0, 1], origin at the image's top left.
// A history label anchors an explanation; it does not assert that the event was painted.
export const annotations: MuralAnnotation[] = [
  { id: 'overview-palace', label: '① 宫殿礼拜', x: 0.813, y: 0.167, chapterIndex: 0, detail: '先看右上角：宫殿内的金人与殿外的礼拜，提出了故事最初的疑问——这些金人究竟是谁？画旁题记把它们与皇帝派遣张骞西行联系起来。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'overview-farewell', label: '② 使者辞行', x: 0.514, y: 0.778, chapterIndex: 0, detail: '再看下方：皇帝骑马，张骞持笏跪拜。人物的朝向与礼仪把“领命出发”表现出来。画家把这次辞行接在拜金人之后，讲的是他理解的出使来由。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'overview-city', label: '③ 抵达城池', x: 0.102, y: 0.092, chapterIndex: 0, detail: '最后看左上：山路通向城门，门外有僧人，城内有佛塔。它们让西行有了终点，也回应了右上角金人身份的疑问。画面的顺序，需要沿人物和山路来寻找。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'palace', label: '甘泉宫', x: 0.808, y: 0.144, chapterIndex: 1, detail: '宫殿的匾额写着“甘泉宫”。殿内金人居中，皇帝和臣属在下方礼拜，把金人放在了故事的中心。随后派遣使者打听名号的情节，正是从这里展开。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'golden-figures', label: '金人被画成佛像', x: 0.805, y: 0.249, chapterIndex: 1, detail: '金人为何是佛像？《史记》记霍去病取得匈奴祭天金人，没有确认它们为佛像；后出的《魏书·释老志》把金人与佛教传播联系起来。初唐画家沿用这层解释，于是金人有了佛像的样貌。', sourceKind: 'interpretation', sourceIds: ['dha-323', 'shiji-111', 'weishu-114'] },
  { id: 'emperor', label: '骑马的帝王', x: 0.482, y: 0.739, chapterIndex: 2, detail: '骑马的人物按敦煌研究院解读为汉武帝，身旁有侍从和华盖。张骞在他面前持笏跪拜，画家借朝廷礼仪，把“奉命辞行”这一刻表现出来。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'envoy-farewell', label: '张骞辞行', x: 0.218, y: 0.892, chapterIndex: 2, detail: '请顺着骑马帝王的朝向，找到他面前左下方跪拜、持笏的使者。画旁题记说，皇帝获得金人却不知名号，便派张骞到大夏询问。这是画中的任务，不等同于史书所记的首次求盟。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'first-embassy', label: '史书背景：联络月氏', x: 0.34, y: 0.83, chapterIndex: 2, detail: '首次出使为何选月氏？《史记》说月氏曾遭匈奴攻击，国王被杀，部众西迁；汉武帝想利用这份共同的敌意寻找盟友。壁画却从获金人讲起；若依获金人的先后对应，敦煌研究院认为应涉及第二次出使。不能把画中的问名号直接当作首次出使的目的。', sourceKind: 'history', sourceIds: ['shiji-123', 'dha-323'] },
  { id: 'westward-party', label: '汉使一行', x: 0.099, y: 0.395, chapterIndex: 3, detail: '一位使者、两名持节随从，沿山间向城池前进。部分人马藏在山后，让行进显得曲折而遥远。3D借这一组形象表现走路，原画本身没有逐段画出他被扣留、逃出和求盟的经历。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'detention', label: '扣留营地 · 史书补充', x: 0.12, y: 0.42, chapterIndex: 3, detail: '《史记》记载张骞经匈奴被扣留十余年。动画用拦截、进入营地、出入受限解释任务为何中断；具体营地、守卫动作和路线均为展示示意，原壁画没有画出这一过程。', sourceKind: 'history', sourceIds: ['shiji-123'] },
  { id: 'guard', label: '匈奴守卫 · 出入受限', x: 0.15, y: 0.40, chapterIndex: 3, detail: '守卫使用已有Tripo人物模型及项目制作的装束变化。史书记载扣留，没有描述这一守卫的外貌、站位与动作；不据此虚构铁牢、刑罚或逃脱细节。', sourceKind: 'interpretation', sourceIds: ['shiji-123'] },
  { id: 'mountain-road', label: '连起两个画面的山路', x: 0.127, y: 0.507, chapterIndex: 3, detail: '山石把下方辞行与左上到达连接起来，又遮住部分人马，表现跋涉的艰辛。这里的山路是画家组织故事的办法，并非按实际里程绘制的西域地图。', sourceKind: 'interpretation', sourceIds: ['dha-323'] },
  { id: 'credential', label: '旌节：汉使的身份', x: 0.244, y: 0.244, chapterIndex: 4, detail: '旌节是使者身份的标志。画中随从持着长杆，让观者辨认出汉朝使团；《史记》另记张骞在匈奴十余年仍“持汉节不失”。多年受阻后继续西行，正说明他没有放弃受命的任务。', sourceKind: 'mural', sourceIds: ['dha-323', 'shiji-123'] },
  { id: 'alliance-result', label: '月氏为何不愿结盟', x: 0.197, y: 0.345, chapterIndex: 4, detail: '旧仇为何没能换来盟友？月氏西迁后土地肥沃、生活较安定，又认为汉朝太远，已不愿重新与匈奴开战。张骞带来的是汉朝的战争需要，月氏考虑的是眼前的安居；双方的处境已经不同。这来自史书，原画没有明确的月氏接见场景；3D王庭建筑与礼仪为示意。', sourceKind: 'history', sourceIds: ['shiji-123'] },
  { id: 'daxia-city', label: '画中的大夏城池', x: 0.087, y: 0.092, chapterIndex: 5, detail: '画旁残存榜题与敦煌研究院的解读，将左上城池认作大夏。《史记》记大夏有城屋和市场，却没有给出这座城的具体平面。城门与佛塔依画转译，不能视为大夏某座古城的实测复原。', sourceKind: 'mural', sourceIds: ['dha-323', 'shiji-123'] },
  { id: 'market-information', label: '蜀物为何出现在大夏', x: 0.175, y: 0.151, chapterIndex: 5, detail: '为什么蜀物值得留意？张骞在大夏见到蜀布与邛竹杖，当地人说商人从身毒买来。蜀指今四川一带，邛竹杖是当地竹材制成的手杖；身毒是古代对印度地区的称呼，读作“捐毒”。这些物品让张骞得知远方已有贸易联系。市场和货物是史书补充，原画没有画出这些摊位。', sourceKind: 'history', sourceIds: ['shiji-123'] },
  { id: 'monks', label: '城门旁的两位僧人', x: 0.208, y: 0.174, chapterIndex: 6, detail: '城门外的两个人，敦煌研究院解释为僧人。他们与城内佛塔共同回应甘泉宫的金人，把远行接到佛教故事中。原画没有交代他们的姓名；3D的迎接朝向帮助读画，并非张骞在汉代见僧的现场证据。', sourceKind: 'mural', sourceIds: ['dha-323'] },
  { id: 'buddhist-tower', label: '城内佛塔', x: 0.067, y: 0.088, chapterIndex: 6, detail: '佛塔为何会出现在张骞的故事里？敦煌研究院指出，初唐佛道之争中，佛教徒借张骞西行，把佛教传入汉地的时间讲得更早。塔与僧人表现的是这层历史记忆；《史记》没有记载张骞在大夏询问佛像名号。', sourceKind: 'interpretation', sourceIds: ['dha-323', 'weishu-114', 'shiji-123'] },
  { id: 'remembered-journey', label: '远行与后世的讲述', x: 0.456, y: 0.519, chapterIndex: 7, detail: '把宫殿、辞行、山路和城池连起来，就能看清画家的故事：从金人的疑问出发，以僧人与佛塔作回答。再读《史记》，另一条线索出现了——外交求盟虽未成，西域见闻却推动了后续往来。一幅壁画，同时容纳了远行的历史与后人对它的理解。', sourceKind: 'interpretation', sourceIds: ['dha-323', 'weishu-114', 'shiji-123'] },
]
