export const STORY_ID = 'zhang-qian-yuezhi'
export const REVISION = 4

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
  { id: 'shiji-stay', title: '一年多的区域活动', location: '《史记》卷123〈张骞〉第二、三段',
    excerpt: '騫從月氏至大夏，竟不能得月氏要領。留歲餘，還。',
    note: '支持在这一区域活动一年多，不能推定整年住在同一王庭、具体日程或交涉次数。', url: 'https://zh.wikisource.org/wiki/史記/卷123#張騫' },
  { id: 'shiji-region', title: '月氏迁居、与大夏的关系及不同生活背景', location: '《史记》卷123：大月氏条（迁居、臣属与生活），大夏条（城屋与市场）',
    excerpt: '大月氏……其南則大夏……行國也，隨畜移徙，與匈奴同俗。……始月氏居敦煌、祁連閒，及為匈奴所敗，乃遠去，過宛，西擊大夏而臣之，遂都媯水北，為王庭。……大夏……其俗土著，有城屋。……其都曰藍市城，有市販賈諸物。',
    note: '省略号表示不同段落摘录。月氏战败远迁、击败并使大夏臣属及两地生活背景有记载；不据此确定接引人物的亲历、此次会见或市场的具体城市。', url: 'https://zh.wikisource.org/wiki/史記/卷123' },
  { id: 'shiji-market', title: '邛竹杖、蜀布与身毒来源', location: '《史记》卷123：张骞报告大夏见闻段',
    excerpt: '臣在大夏時，見邛竹杖、蜀布。問曰：「安得此？」大夏國人曰：「吾賈人往市之身毒。」',
    note: '同段记张骞推想蜀地与身毒、大夏的交通关系。见物、答问与推想有记载；摊位、人物外形及现代对白为改编。', url: 'https://zh.wikisource.org/wiki/史記/卷123' },
  { id: 'shiji-shendu', title: '大夏国人所述身毒方位与风土', location: '《史记》卷123：张骞报告大夏见闻段，大夏国人答问接“吾贾人往市之身毒”',
    excerpt: '吾賈人往市之身毒。身毒在大夏東南可數千里。其俗土著，大與大夏同，而卑溼暑熱云。',
    note: '身毒方位、距离和风土是大夏国人答问中的传闻，不是张骞亲至身毒的记录。“可数千里”保留约数，不换算成精确坐标或指定商路；张骞据所见和所闻作道路推想。', url: 'https://zh.wikisource.org/wiki/史記/卷123' },
  { id: 'hanshu-variant', title: '月氏继位者的文本分歧', location: '《汉书》卷61〈张骞〉第二段，与《史记》对读',
    excerpt: '大月氏王已爲胡所殺，立其夫人爲王。',
    note: '《史记》相应段落记“立其太子为王”。本书保留异文，不据任一数字文本确定此次接见者身份；底本校勘待做。', url: 'https://zh.wikisource.org/wiki/漢書/卷061' },
]

export const boundary = '历史事件依据古籍数字文本；人物相貌、服饰、具体会面地点、河谷布局和尺寸为制作示意。月氏继位者在《史记》《汉书》中有太子／夫人异文，本场景不指定其身份。数字文本核对不能替代底本校勘与最终史料审核。'
