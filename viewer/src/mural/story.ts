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

// Tell the embassy in chronological order; image interpretation is the epilogue.
export const chapterDefinitions: ChapterDefinition[] = [
  {
    "id": "mission",
    "title": "为什么向西出发",
    "location": "汉朝 · 寻找盟友",
    "mode": "overview",
    "focus": {
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1
    },
    "takeaway": "汉武帝希望联合月氏对抗匈奴，张骞接下了寻找盟友的任务。",
    "cues": [
      {
        "id": "c0-0",
        "text": "西汉时，汉武帝想找到一个盟友，共同对抗匈奴。张骞的故事，就从这项任务开始。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c0-1",
        "text": "这个盟友是月氏。它曾被匈奴击败，国王被杀，部众向西迁走；汉武帝希望双方能一起对付共同的敌人。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c0-2",
        "text": "可是，要找到月氏，先得穿过匈奴控制的地区。这是一趟前路不明的远行，张骞应募，接下了出使的使命。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "first-captivity",
    "title": "出发后，却被扣留",
    "location": "西行途中 · 匈奴控制区",
    "mode": "spatial",
    "focus": {
      "x": 0.005,
      "y": 0.2,
      "width": 0.29,
      "height": 0.35
    },
    "takeaway": "使团被匈奴拦截，任务中断；十余年的扣留没有让张骞放弃使命。",
    "cues": [
      {
        "id": "c1-0",
        "text": "张骞带着百余人，从陇西向西出发。同行的甘父是一位善射的胡人，也是这场远行的重要伙伴。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c1-1",
        "text": "使团还没见到月氏，就被匈奴截住。匈奴不肯放行，张骞被带到单于面前，求盟的任务就此中断。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c1-2",
        "text": "张骞被留在匈奴十余年，娶妻生子。远行变成漫长的等待，但他一直保留汉节，没有放下使者的使命。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "escape-westward",
    "title": "脱身后，仍然向西",
    "location": "匈奴 → 大宛 → 康居 → 大月氏",
    "mode": "spatial",
    "focus": {
      "x": 0.005,
      "y": 0.2,
      "width": 0.29,
      "height": 0.35
    },
    "takeaway": "张骞脱身后继续执行任务，经大宛和康居抵达大月氏。",
    "cues": [
      {
        "id": "c2-0",
        "text": "十余年后，监守渐渐松弛，张骞与同伴终于逃出。他没有就此回汉朝，而是继续向西寻找月氏。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c2-1",
        "text": "旅途困乏时，善射的甘父猎取禽兽，帮助众人解决食物。向西赶路，还要设法跨过不同国家的边界。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c2-2",
        "text": "大宛人希望与汉朝交往，便送他们到康居。经康居转送，张骞终于见到了他找寻多年的大月氏。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "alliance-refused",
    "title": "找到月氏，为何没能结盟",
    "location": "大月氏 · 求盟未成",
    "mode": "spatial",
    "focus": {
      "x": 0.005,
      "y": 0.2,
      "width": 0.29,
      "height": 0.35
    },
    "takeaway": "汉朝需要盟友，月氏却已安居；共同的旧仇没有变成共同的行动。",
    "cues": [
      {
        "id": "c3-0",
        "text": "可大月氏已经在新的土地上安居。那里土地肥沃，也少受侵扰；他们不愿再为旧仇，重新与匈奴开战。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c3-1",
        "text": "汉朝盼着两面夹击匈奴，月氏却觉得汉朝太远，开战会打破眼前的安稳。双方的处境，早已不同。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c3-2",
        "text": "张骞从月氏来到大夏，停留一年多，仍没能促成结盟。他准备返回，把一路的见闻带给汉武帝。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "daxia-discovery",
    "title": "没带回盟约，却有新发现",
    "location": "大夏 · 城市与市场",
    "mode": "spatial",
    "focus": {
      "x": 0.005,
      "y": 0.005,
      "width": 0.28,
      "height": 0.285
    },
    "takeaway": "大夏市场中的四川货物，让张骞发现远方已有贸易联系。",
    "cues": [
      {
        "id": "c4-0",
        "text": "求盟没有成功，远行却让他看见了另一个世界。大夏有城邑和市场，各方商人在这里交换货物。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c4-1",
        "text": "市场里，张骞竟认出蜀布和邛竹杖，也就是四川的布和竹杖：熟悉的东西，怎么会出现在这么远的地方？",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c4-2",
        "text": "大夏人说，商人从身毒买来这些货物。身毒指印度地区；张骞由此推想，四川也许另有通向西方的路。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "return-home",
    "title": "回家的路，又被截断",
    "location": "归途 · 再次扣留与归汉",
    "mode": "overview",
    "focus": {
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1
    },
    "takeaway": "回程再次被扣留，脱身后终于归汉；第一次出使前后十三年。",
    "cues": [
      {
        "id": "c5-0",
        "text": "返程时，张骞想沿南山、经羌人地区避开匈奴，却还是再次被扣留。回家的路，又停了一年多。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c5-1",
        "text": "趁匈奴发生内乱，他才再次脱身，与妻子和甘父回到汉朝。第一次出使，前后已经过去十三年。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c5-2",
        "text": "原来出发的百余人中，只有张骞和甘父回到汉朝。没有带回盟约，他带回的西域见闻，却让朝廷有了新的判断。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "later-contacts",
    "title": "一趟未成的求盟，改变了什么",
    "location": "汉朝与西域 · 后续出使",
    "mode": "overview",
    "focus": {
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1
    },
    "takeaway": "张骞的报告和后续出使，推动了汉朝与西方诸国更直接的往来。",
    "cues": [
      {
        "id": "c6-0",
        "text": "汉武帝由此了解大宛、康居、大月氏和大夏。匈奴以西，还有许多国家；汉朝可以设法与它们直接往来。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c6-1",
        "text": "后来，张骞再次出使，联络乌孙，并派副使前往各国。乌孙没有立即答应联汉行动，各地的使者往来却逐步增多。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      },
      {
        "id": "c6-2",
        "text": "商路早已存在。张骞没有凭一人走出整条丝绸之路；他的远行，帮助汉朝与西方诸国建立了更直接的联系。",
        "sourceKind": "history",
        "sourceIds": [
          "shiji-123",
          "hanshu-61"
        ]
      }
    ]
  },
  {
    "id": "mural-memory",
    "title": "后人怎样记住这段远行",
    "location": "初唐敦煌 · 壁画中的历史记忆",
    "mode": "overview",
    "focus": {
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1
    },
    "takeaway": "史书中的求盟经历，与初唐壁画中的佛教讲述，需要分清。",
    "cues": [
      {
        "id": "c7-0",
        "text": "到了初唐，敦煌画家把张骞画进壁画。下方辞行、山间赶路和城门迎接，让我们看见后人记住的远行。",
        "sourceKind": "mural",
        "sourceIds": [
          "dha-323",
          "dha-cave-323"
        ]
      },
      {
        "id": "c7-1",
        "text": "但画里的缘由变了：皇帝礼拜金人，派张骞西去问名号，僧人与佛塔成了答案。这是后世佛教对远行的讲述。",
        "sourceKind": "mural",
        "sourceIds": [
          "dha-323",
          "dha-cave-323"
        ]
      },
      {
        "id": "c7-2",
        "text": "张骞为求盟出发，后人又借他的远行讲佛教来历。读过这段经历，再看壁画，就能分清历史与后世的记忆。",
        "sourceKind": "interpretation",
        "sourceIds": [
          "dha-323",
          "dha-cave-323",
          "shiji-123",
          "weishu-114"
        ]
      }
    ]
  }
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
  {
    "id": "first-embassy",
    "label": "为何联络月氏",
    "x": 0.34,
    "y": 0.83,
    "chapterIndex": 0,
    "detail": "匈奴击败月氏，月氏西迁，汉武帝希望利用双方与匈奴的敌对关系寻找盟友。这是首次出使的政治目的。标注借辞行画面定位，不表示画中也讲求盟；壁画另有问金人名号的叙事。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "emperor",
    "label": "汉武帝",
    "x": 0.482,
    "y": 0.739,
    "chapterIndex": 0,
    "detail": "汉武帝派张骞寻找月氏。画中骑马的帝王按敦煌研究院解读为汉武帝，侍从与华盖表现朝廷礼仪；初唐画面的具体装束不能作为汉代现场实录。",
    "sourceKind": "mural",
    "sourceIds": [
      "dha-323",
      "dha-cave-323"
    ]
  },
  {
    "id": "envoy-farewell",
    "label": "张骞领命",
    "x": 0.218,
    "y": 0.892,
    "chapterIndex": 0,
    "detail": "画中持笏跪拜的使者被解释为张骞。画旁题记以问金人名号解释出使，史书以联络月氏解释首次出使。这里借辞行的形象帮助认识人物，不把两种缘由混为一谈。",
    "sourceKind": "mural",
    "sourceIds": [
      "dha-323",
      "dha-cave-323",
      "shiji-123"
    ]
  },
  {
    "id": "detention",
    "label": "首次扣留十余年",
    "x": 0.12,
    "y": 0.42,
    "chapterIndex": 1,
    "detail": "张骞经匈奴被扣留十余年，娶妻生子，仍持汉节不失。动画表现拦截与出入受限；营地布局、守卫、具体动作均为展示补全，原画没有画出这个事件。十余年是首次扣留，十三年是整个首次往返。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "guard",
    "label": "匈奴为何不放行",
    "x": 0.15,
    "y": 0.4,
    "chapterIndex": 1,
    "detail": "汉朝使者要穿过匈奴控制区，联络匈奴的敌人。单于以匈奴若借汉地出使南方，汉朝是否同意作反问，拒绝放行。守卫不具名，装束和站位为示意；史书没有描述这两个守卫。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "credential",
    "label": "汉节：使者身份",
    "x": 0.244,
    "y": 0.244,
    "chapterIndex": 2,
    "detail": "汉节是受命出使的身份凭证。《史记》记张骞在匈奴中持汉节不失。壁画使团与3D长杖帮助观众辨认使者；现用Tripo艺术长杖，不宣称精确还原汉节材质和形制。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61",
      "dha-323"
    ]
  },
  {
    "id": "westward-party",
    "label": "脱身后继续西行",
    "x": 0.099,
    "y": 0.395,
    "chapterIndex": 2,
    "detail": "张骞没有在脱身后就回汉朝，而是继续完成寻找月氏的任务。大宛送其至康居，康居转送至大月氏。3D小队以少量人物代表使团，不表示史书中的使团只有三人。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "mountain-road",
    "label": "甘父帮助渡过困境",
    "x": 0.127,
    "y": 0.507,
    "chapterIndex": 2,
    "detail": "史书称甘父为胡人，善射，困乏时射取禽兽供食，帮助张骞等人渡过饥饿；此处不把胡人直接等同某个具体族属。山道用于表现艰难远行，不是实际路线的地形测绘；没有虚构逃亡对白和具体追逐。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "alliance-result",
    "label": "月氏为何拒绝结盟",
    "x": 0.197,
    "y": 0.345,
    "chapterIndex": 3,
    "detail": "月氏迁居后土地肥沃、生活较安定，又认为汉朝太远，不再愿为旧仇开战。共同敌人不等于共同利益。张骞从月氏至大夏，留一年多，仍未能促成盟约。原画没有明确的月氏接见场景；3D空间和礼仪为示意，接待方匿名，不认定统治者性别。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61",
      "hanshu-96"
    ]
  },
  {
    "id": "daxia-city",
    "label": "大夏的城邑与市场",
    "x": 0.087,
    "y": 0.092,
    "chapterIndex": 4,
    "detail": "史书记大夏有城屋与市场，商人贩卖各方货物。城门取自壁画并转译为3D，市场按记载补充；这不是某座大夏城市的实测复原。壁画中的僧塔属于后世图像叙事，历史市场镜头不混入迎僧情节。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61",
      "dha-323"
    ]
  },
  {
    "id": "market-information",
    "label": "四川货物为何在这里",
    "x": 0.175,
    "y": 0.151,
    "chapterIndex": 4,
    "detail": "张骞在大夏见到蜀布与邛竹杖。大夏人说商人从身毒买来；身毒指印度地区，读作捐毒。由此张骞推想蜀地可能另有通路。这是当地人的转述和他的推测，不表示他亲自到过印度，或已经验证了一条完整新路线。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "return-journey",
    "label": "十三年后，终于归汉",
    "x": 0.456,
    "y": 0.519,
    "chapterIndex": 5,
    "detail": "张骞想并南山、从羌人地区归汉，途中再次被匈奴扣留，一年多后趁内乱脱身，带妻与甘父归汉。原百余人使团中仅张骞、甘父得还；妻子同行，不能理解为整个归国队伍总共只有两人。地图线仅示意，未确定具体归途。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "later-envoys",
    "label": "后续出使与使者往来",
    "x": 0.456,
    "y": 0.519,
    "chapterIndex": 6,
    "detail": "首次求盟未成，报告却使朝廷了解西域。后来张骞出使乌孙，另遣副使到大宛、康居、大月氏、大夏等国；乌孙没有立即作出联汉行动的承诺，后续使节往来逐渐增多。地图还包含副使与其他时期路线，不能全算作张骞本人走过的路。",
    "sourceKind": "history",
    "sourceIds": [
      "shiji-123",
      "hanshu-61"
    ]
  },
  {
    "id": "golden-figures",
    "label": "壁画为何画金人",
    "x": 0.805,
    "y": 0.249,
    "chapterIndex": 7,
    "detail": "壁画把皇帝礼拜金人与派遣张骞问名号联系起来，属于后世佛教叙事。《史记》所记霍去病获得祭天金人发生在首次出使之后；不能把获金人或问佛写成首次求盟的原因。《魏书·释老志》提供后世将金人与佛教联系的叙述。",
    "sourceKind": "interpretation",
    "sourceIds": [
      "dha-323",
      "dha-cave-323",
      "shiji-111",
      "weishu-114",
      "shiji-123"
    ]
  },
  {
    "id": "monks",
    "label": "城门外的两位僧人",
    "x": 0.208,
    "y": 0.174,
    "chapterIndex": 7,
    "detail": "两个人物按敦煌研究院解读为僧人。画家以迎接使者的形象把远行接入佛教故事。原画没有姓名，3D迎接动作是图像转译；它不能独立证明张骞在汉代曾见僧问佛。",
    "sourceKind": "mural",
    "sourceIds": [
      "dha-323",
      "dha-cave-323"
    ]
  },
  {
    "id": "buddhist-tower",
    "label": "佛塔与后世的记忆",
    "x": 0.067,
    "y": 0.088,
    "chapterIndex": 7,
    "detail": "僧人与佛塔呼应宫殿金人。敦煌研究院结合初唐佛道之争解释，佛教徒借张骞西行把佛教来历讲得更早。《史记》未记这次问佛；缺载不能推成对所有佛教接触的绝对否定。故事主体是外交经历，壁画是后人对远行的讲述。",
    "sourceKind": "interpretation",
    "sourceIds": [
      "dha-323",
      "dha-cave-323",
      "shiji-123",
      "weishu-114"
    ]
  }
]
