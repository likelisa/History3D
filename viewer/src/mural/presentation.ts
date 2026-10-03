/** Reveal by story time so pause, speed changes and seeking remain deterministic. */
export function subtitleText(text: string, seconds: number, duration: number, reducedMotion = false): string {
  if (reducedMotion) return text
  const characters = Array.from(text)
  const revealSeconds = Math.max(1, duration - 1)
  const count = Math.min(characters.length, Math.max(0, Math.ceil(characters.length * seconds / revealSeconds)))
  return characters.slice(0, count).join('')
}

export type RoutePosition = { x: number; y: number; label: string; note: string }
const start = { x: 92.5, y: 71.5 }
const captivity = { x: 71, y: 45 }
const yuezhi = { x: 27, y: 63 }
const daxia = { x: 34, y: 79 }
const notes = {
  start: '长安出发；地图仅辅助理解空间。',
  captivity: '匈奴控制区 · 大致区域，不代表已知扣留地点。',
  westward: '经大宛、康居到大月氏；连线为路线示意。',
  daxia: '大夏见闻；图中还含副使及其他时期路线。',
}
function between(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  const u = Math.max(0, Math.min(1, t))
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}
export function routePosition(chapter: number, cue: number, progress: number): RoutePosition {
  if (chapter < 3) return { ...start, label: '长安 · 出发前', note: notes.start }
  if (chapter === 3 && cue === 0) return { ...between(start, captivity, progress), label: '西行途中 · 穿过匈奴控制区', note: notes.captivity }
  if (chapter === 3 && cue === 1) return { ...captivity, label: '匈奴控制区 · 被扣留', note: notes.captivity }
  if (chapter === 3) return { ...between(captivity, yuezhi, progress), label: '大宛 → 康居 → 大月氏', note: notes.westward }
  if (chapter === 4 && cue < 2) return { ...captivity, label: cue === 1 ? '被扣留十余年 · 汉节未失' : '使者身份 · 西行途中', note: notes.captivity }
  if (chapter === 4) return { ...yuezhi, label: '大月氏 · 求盟未成', note: notes.westward }
  if (chapter < 7) return { ...daxia, label: '大夏 · 见闻与图像记忆', note: notes.daxia }
  if (cue === 0) return { ...daxia, label: '回看旅途', note: notes.daxia }
  if (cue === 2) return { ...start, label: '回到汉朝 · 后世记忆', note: '初唐壁画与汉代出使相隔七八百年。' }
  return { ...between(daxia, start, progress), label: '返回汉朝 · 归途示意', note: '回程再次被扣留；此连线不表示确切返程路线。' }
}
