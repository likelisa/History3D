/** Reveal by story time so pause, speed changes and seeking remain deterministic. */
export function subtitleText(text: string, seconds: number, duration: number, reducedMotion = false): string {
  if (reducedMotion) return text
  const characters = Array.from(text)
  const revealSeconds = Math.max(1, duration - 1)
  const count = Math.min(characters.length, Math.max(0, Math.ceil(characters.length * seconds / revealSeconds)))
  return characters.slice(0, count).join('')
}

export type SubtitlePoint = { seconds: number; textEnd: number }

/** Timings refer to code points in the unchanged display text, including punctuation. */
export function validateSubtitlePoints(text: string, value: unknown, audioSeconds: number): asserts value is SubtitlePoint[] {
  if (!Array.isArray(value) || !value.length) throw new Error('字幕时间戳缺失')
  const length = Array.from(text).length
  let previousTime = -1, previousEnd = 0
  for (const point of value) {
    if (!point || typeof point !== 'object' || !Number.isFinite(point.seconds) || point.seconds < 0 || point.seconds < previousTime || point.seconds > audioSeconds || !Number.isInteger(point.textEnd) || point.textEnd <= previousEnd || point.textEnd > length) throw new Error('字幕时间戳与音轨不匹配')
    previousTime = point.seconds; previousEnd = point.textEnd
  }
  if (previousEnd !== length) throw new Error('字幕时间戳未覆盖全文')
}

export function timedSubtitleText(text: string, seconds: number, points: readonly SubtitlePoint[], reducedMotion = false): string {
  if (seconds < 0) return ''
  if (reducedMotion) return text
  let end = 0
  for (const point of points) {
    if (point.seconds > seconds) break
    end = point.textEnd
  }
  return Array.from(text).slice(0, end).join('')
}

export type RoutePosition = { x: number; y: number; label: string; note: string }
const start = { x: 92.5, y: 71.5 }
const captivity = { x: 71, y: 45 }
const dayuan = { x: 34.4, y: 48.9 }
// This reference image labels Kangju as a region, without a documented city point.
const kangju = { x: 28, y: 25 }
const yuezhi = { x: 27, y: 63 }
const daxia = { x: 34, y: 79 }
const notes = {
  start: '长安出发；地图仅辅助理解空间。',
  captivity: '匈奴控制区 · 大致区域，不代表已知扣留地点。',
  westward: '经大宛、康居到大月氏；精确路线不明，连线为国家之间的示意。康居只定位大致区域，不代表已知城址。参考图还含副使及其他时期路线。',
  daxia: '大夏见闻；图中还含副使及其他时期路线。',
}
function between(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  const u = Math.max(0, Math.min(1, t))
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}
/** Positions express the current event, not an archaeologically measured track. */
export function routePosition(chapter: number, cue: number, progress: number): RoutePosition {
  if (chapter === 0) return { ...start, label: '汉朝 · 寻找共同对抗匈奴的盟友', note: notes.start }
  if (chapter === 1 && cue === 0) return { ...between(start, captivity, progress), label: '从陇西出发 · 西行途中', note: notes.captivity }
  if (chapter === 1) return { ...captivity, label: cue === 1 ? '匈奴控制区 · 首次被扣留' : '被扣留十余年 · 汉节未失', note: notes.captivity }
  if (chapter === 2 && cue === 0) return { ...captivity, label: '脱身后，继续向西', note: notes.westward }
  if (chapter === 2 && cue === 1) return {
    ...between(captivity, dayuan, progress),
    label: progress >= 1 ? '大宛 · 继续西行' : '匈奴控制区 → 大宛 · 继续赶路', note: notes.westward,
  }
  if (chapter === 2) {
    const u = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress))
    if (u < .5) return {
      ...between(dayuan, kangju, u * 2),
      label: u === 0 ? '大宛 · 转送康居' : '大宛 → 康居', note: notes.westward,
    }
    return {
      ...between(kangju, yuezhi, (u - .5) * 2),
      label: u === 1 ? '大月氏 · 抵达' : u === .5 ? '康居区域 · 转送大月氏' : '康居 → 大月氏', note: notes.westward,
    }
  }
  if (chapter === 3 && cue < 2) return { ...yuezhi, label: '大月氏 · 求盟未成', note: notes.westward }
  if (chapter === 3) return { ...between(yuezhi, daxia, progress), label: '从大月氏到大夏 · 留一年多', note: notes.daxia }
  if (chapter === 4) return { ...daxia, label: '大夏 · 城市、市场与贸易见闻', note: notes.daxia }
  if (chapter === 5 && cue === 0) return { ...between(daxia, captivity, progress), label: '归途再次被扣留 · 一年多', note: '尝试沿南山、经羌中归汉，未能避开匈奴；线条不表示确切路线。' }
  if (chapter === 5 && cue === 1) return { ...between(captivity, start, progress), label: '再度脱身，十三年后归汉', note: '妻子与甘父同行；连线仅作归途示意。' }
  if (chapter === 5) return { ...start, label: '回到汉朝 · 带回西域见闻', note: '原使团中仅张骞、甘父得还；妻子也同行。' }
  if (chapter === 6) return { ...start, label: cue === 0 ? '西域报告 · 朝廷有了新的判断' : '后续出使与副使往来', note: '这张参考图还包含副使及其他时期路线，不能全部算作首次出使或张骞本人行程。' }
  return { ...start, label: '初唐敦煌 · 后人对远行的记忆', note: '壁画与汉代出使相隔数百年；问金人、迎僧等不能直接当作首次出使的现场。' }
}
