import { validateScenePackage } from '../../../contracts/src/validate.ts'
import type { SourcesFile } from '../../../contracts/src/types.ts'
import { createFetchReader } from '../reader.ts'
import { boundary, REVISION, STORY_ID } from './content.ts'
import { bookScenes, lineInScene, speakerNames } from './book-content.ts'
import { freshBook, nextLine, restoreBook, turnToScene } from './book-state.ts'
import type { BookProgress } from './book-state.ts'
import { installInspector } from './asset-inspector.ts'
import type { InspectAsset } from './asset-inspector.ts'
import { installSceneInspector } from './scene-inspector.ts'
import './style.css'

const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
  <header class="reader-header"><a href="/yuezhi.html" class="book-title">张骞使月氏</a><span class="reader-subtitle">一段可读、可玩的历史</span><div class="reader-actions"><button id="scene-view-button">查看 3D 场景</button><button id="atlas-button">打开书页</button><button id="notes-button">史料旁注</button><button id="music" aria-pressed="false">配乐：关</button><button id="voice" aria-pressed="false">朗读：关</button></div></header>
  <main class="reader" aria-label="张骞使月氏叙事书页">
    <div class="page-heading"><h1 id="scene-title"></h1><span id="scene-place"></span></div>
    <section class="stage" aria-label="敦煌壁画叙事场景"><div id="world"><img id="mural" src="/yuezhi/murals/full.jpg" alt="莫高窟第323窟张骞出使西域图"><div class="wind-dust" aria-hidden="true"></div><div id="image-caption"></div><div id="asset-hotspots"><button data-asset="asset-envoy">汉使 · 查看 3D</button><button data-asset="asset-representative">当地人物 · 查看 3D</button></div></div><div id="goods-label" hidden><span data-good="bamboo">邛竹杖</span><span data-good="cloth">蜀布</span></div><div class="stage-note">图像：敦煌研究院网站 · 莫高窟第323窟 · 初唐</div></section>
    <section class="dialogue-controls" aria-label="推进对话"><div id="speech" aria-live="polite"></div><div class="line-status"><span id="line-speaker"></span><button id="history-button">回看本页对话</button></div><div id="choices"></div><div class="dialogue-bottom"><span id="reading-progress"></span><button id="continue" class="advance-button"></button></div></section>
    <footer class="page-footer"><button id="previous-page">上一页</button><span id="folio"></span><button id="restart">从头读起</button></footer>
    <div id="page-turn" aria-hidden="true"><div class="turn-front"><span>张骞使月氏</span><h2 id="turn-title"></h2><p>翻过这一页，来到下一段故事。</p><div class="page-ink-rule"></div></div><div class="turn-back"></div></div>
    <div id="loading"><h2>打开这段历史</h2><p id="loading-text">正在读取史料与人物</p><progress id="loading-progress" max="6" value="0"></progress></div>
  </main>
  <aside id="notes" hidden aria-label="史料旁注"><div class="notes-header"><h2>史料旁注</h2><button id="close-notes" aria-label="关闭旁注">关闭</button></div><div id="notes-body"></div></aside>
  <dialog id="atlas" aria-label="章节书页"><button id="close-atlas" aria-label="合上书页">合上书页</button><div id="atlas-body" class="book-spread"></div></dialog>`
root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
const stage = root.querySelector<HTMLElement>('.stage')!
const reader = root.querySelector<HTMLElement>('.reader')!
const speech = root.querySelector<HTMLElement>('#speech')!
const continueButton = root.querySelector<HTMLButtonElement>('#continue')!
const notes = root.querySelector<HTMLElement>('#notes')!
const notesBody = root.querySelector<HTMLElement>('#notes-body')!
const atlas = root.querySelector<HTMLDialogElement>('#atlas')!
const turn = root.querySelector<HTMLElement>('#page-turn')!
const storageKey = `history3d:${STORY_ID}:book-r${REVISION}`
let progress: BookProgress = freshBook()
try { progress = restoreBook(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) } catch { /* An unavailable save does not prevent reading. */ }
let ready = false
let turning = false
let voice = false
let sourceFile: SourcesFile
let showingHistory = false
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const music = new Audio('/yuezhi/murals/reflection.mp3')
music.loop = true
music.volume = 0.28
let musicWanted = false
const visuals = [
  { image: 'full.jpg', caption: '行旅图像 · 初唐的历史记忆，非首次出使实景', mode: 'mural' },
  { image: 'full.jpg', caption: '接见地点与建筑未详 · 本页只呈现史料与改编对话', mode: 'text' },
  { image: 'journey.jpg', caption: '行旅画面复用 · 不推定一年多活动的季节与居所', mode: 'mural' },
  { image: 'full.jpg', caption: '大夏见蜀物有记载 · 不补造具体市场空间', mode: 'text' },
]

function escape(text: string) { return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!) }
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(progress)) } catch { /* Local progress is optional. */ }
  root.dataset.ready = String(ready)
  root.dataset.scene = String(progress.scene)
  root.dataset.line = progress.line
  root.dataset.turning = String(turning)
  root.dataset.complete = String(progress.complete)
  root.dataset.loadedImages = '3'
  root.dataset.furthest = String(progress.furthest)
}
function currentLine() { return lineInScene(progress.scene, progress.line)! }
function sourceHtml(ids: string[]) {
  return [...new Set(ids)].map((id) => sourceFile.sources.find((source) => source.id === id)).filter((source) => !!source).map((source) => `<article class="source-entry"><h3>${escape(source.title)}</h3><blockquote>${escape(source.excerpt)}</blockquote><p>${escape(source.location)}</p><a target="_blank" rel="noopener noreferrer" href="${escape(source.locator.url!)}">打开古籍原文</a></article>`).join('')
}
function showNotes(history = false) {
  if (!ready || turning) return
  showingHistory = history
  const scene = bookScenes[progress.scene]!
  if (history) {
    const ids = new Set([...progress.read, progress.line])
    notesBody.innerHTML = `<p class="notes-intro">本页已读对话 · ${escape(scene.title)}</p>${scene.lines.filter((line) => ids.has(line.id)).map((line) => `<article class="history-entry"><h3>${speakerNames[line.speaker]}</h3><p>${escape(line.text)}</p></article>`).join('')}`
  } else {
    notesBody.innerHTML = `<p class="notes-intro">${escape(scene.note)}</p><p class="notes-boundary">配乐：At Rest — Kevin MacLeod (incompetech.com)。<a href="https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1100748" target="_blank" rel="noopener noreferrer">原曲</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>；截取 15–50 秒，淡入淡出并转为 MP3。</p><p class="notes-boundary">壁画为初唐的后世叙述，含佛教改写，不作为首次出使的实景依据。<a href="https://www.dha.ac.cn/info/1266/2524.htm" target="_blank" rel="noopener noreferrer">敦煌研究院图像说明</a></p><p class="notes-boundary">人物发言是现代改编，不是史书记下的逐字谈话；“记述”呈现古籍内容的现代转述。</p>${sourceHtml([...currentLine().sourceIds, ...(scene.noteSourceIds ?? [])])}<details><summary>本页全部依据与制作边界</summary>${sourceHtml(scene.lines.flatMap((line) => line.sourceIds))}<p>${escape(boundary)}</p></details>`
  }
  notes.hidden = false
  root.querySelector('#close-notes')!.scrollIntoView({ block: 'nearest' })
}
function narrate(text: string) {
  if (!voice || !('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'; utterance.rate = 0.91
  speechSynthesis.speak(utterance)
}
function renderLine() {
  const scene = bookScenes[progress.scene]!
  const line = currentLine()
  const goodsLabel = root.querySelector<HTMLElement>('#goods-label')!
  goodsLabel.hidden = true
  goodsLabel.dataset.selected = line.id === 'market-cloth' ? 'cloth' : line.id === 'market-bamboo' ? 'bamboo' : ''
  const side = line.speaker === 'narrator' ? 'center' : 'left'
  speech.className = `speech ${side}`
  stage.dataset.speaker = line.speaker
  speech.innerHTML = `<div class="speaker-name">${speakerNames[line.speaker]}</div><p>${escape(line.text)}</p>`
  root.querySelector('#line-speaker')!.textContent = line.speaker === 'narrator' ? '记述 · 史料内容转述' : `${speakerNames[line.speaker]} · 据史料改编`
  root.querySelector('#scene-title')!.textContent = scene.title
  root.querySelector('#scene-place')!.textContent = visuals[progress.scene]!.mode === 'text' ? '史料书页 · 空间未详' : '行旅壁画 · 图像记忆'
  root.querySelector('#folio')!.textContent = `${scene.time} · 第 ${progress.scene + 1} 页 / ${bookScenes.length}`
  root.querySelector('#reading-progress')!.textContent = line.choices ? '选择你想问的话' : line.next ? '继续读这一页' : progress.scene < bookScenes.length - 1 ? '这一页读完了，翻页继续' : '这一段故事读完了'
  const choices = root.querySelector<HTMLElement>('#choices')!
  choices.innerHTML = line.choices?.map((choice, index) => `<button data-choice="${choice.id}" class="dialogue-choice"><span>${index + 1}</span>${escape(choice.text)}</button>`).join('') ?? ''
  choices.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    if (turning) return
    progress = nextLine(progress, button.dataset.choice); save(); renderLine()
  }))
  continueButton.hidden = !!line.choices
  continueButton.textContent = line.next ? '下一句' : progress.scene < bookScenes.length - 1 ? `翻页 · ${bookScenes[progress.scene + 1]!.title}` : progress.complete ? '回看这本书' : '读完这一段'
  root.querySelector<HTMLButtonElement>('#previous-page')!.disabled = progress.scene === 0 || turning
  save(); narrate(line.text)
  if (!notes.hidden) showNotes(showingHistory)
}
function setStage() {
  const visual = visuals[progress.scene]!
  root.querySelector<HTMLImageElement>('#mural')!.src = `/yuezhi/murals/${visual.image}`
  stage.dataset.mode = visual.mode
  root.querySelector('#image-caption')!.textContent = visual.caption
  notes.hidden = true
  renderLine()
}
function advance() {
  if (!ready || turning || atlas.open) return
  const line = currentLine()
  if (line.choices) return
  if (line.next) { progress = nextLine(progress); save(); renderLine(); return }
  if (progress.scene < bookScenes.length - 1) { void turnPage(progress.scene + 1); return }
  progress.complete = true; save(); renderLine(); showAtlas()
}
async function turnPage(index: number) {
  if (turning || !ready || index === progress.scene) return
  const next = turnToScene(progress, index)
  if (next === progress) return
  if (atlas.open) atlas.close()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
  turning = true; save()
  reader.setAttribute('aria-busy', 'true')
  root.querySelectorAll<HTMLButtonElement>('.reader button').forEach((button) => { button.disabled = true })
  root.querySelector('#turn-title')!.textContent = bookScenes[progress.scene]!.title
  turn.classList.toggle('backwards', index < progress.scene)
  turn.classList.add('turning')
  const duration = reducedMotion ? 0 : 850
  await new Promise((resolve) => setTimeout(resolve, duration * 0.45))
  progress = next; setStage()
  await new Promise((resolve) => setTimeout(resolve, duration * 0.55))
  turn.classList.remove('turning', 'backwards')
  turning = false
  root.querySelectorAll<HTMLButtonElement>('.reader button').forEach((button) => { button.disabled = false })
  reader.removeAttribute('aria-busy')
  renderLine(); save()
}
function showAtlas() {
  if (!ready || turning) return
  const pageButtons = bookScenes.map((scene, i) => `<button class="chapter-entry ${i === progress.scene ? 'current' : ''}" data-scene="${i}" ${i > progress.furthest ? 'disabled' : ''}><span>${['一', '二', '三', '四'][i]}</span><strong>${scene.title}</strong><small>${scene.place}</small></button>`).join('')
  root.querySelector('#atlas-body')!.innerHTML = `<section class="book-leaf"><h2>张骞使月氏</h2><p class="book-description">带着联盟的期待抵达，在异乡的生活与物品中，认识另一个世界。</p><div class="journey-line"><span>大宛</span><i></i><span>康居</span><i></i><span>大月氏</span><i></i><span>大夏</span></div><p class="book-small">史书记述的顺序示意，不代表实际路线、方位与距离。</p><div class="book-colophon"><p>《史记·大宛列传》《汉书·张骞李广利传》</p><p>人物发言据史料改编；初唐壁画为后世图像记忆，未补绘人物或复原交涉场所。</p></div></section><section class="book-leaf"><h2>这一段故事</h2><nav aria-label="章节目录">${pageButtons}</nav><p class="book-small">已读书页可以回看。新的场景在读完当前页后翻开。</p>${progress.complete ? '<p class="book-finished">故事读毕 · 联盟目标未成，新的认识在观察中展开。</p>' : ''}</section>`
  root.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.scene)
    if (index === progress.scene) atlas.close(); else void turnPage(index)
  }))
  atlas.showModal()
}
function reset() {
  if (!ready || turning) return
  if (atlas.open) atlas.close()
  progress = freshBook(); save(); setStage()
}
root.querySelector('#continue')!.addEventListener('click', advance)
root.querySelector('#atlas-button')!.addEventListener('click', showAtlas)
root.querySelector('#close-atlas')!.addEventListener('click', () => atlas.close())
root.querySelector('#notes-button')!.addEventListener('click', () => { if (notes.hidden) showNotes(); else notes.hidden = true })
root.querySelector('#history-button')!.addEventListener('click', () => showNotes(true))
root.querySelector('#close-notes')!.addEventListener('click', () => { notes.hidden = true })
root.querySelector('#restart')!.addEventListener('click', reset)
root.querySelector('#previous-page')!.addEventListener('click', () => { void turnPage(progress.scene - 1) })
root.querySelector('#voice')!.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) return
  voice = !voice
  root.querySelector('#voice')!.textContent = `朗读：${voice ? '开' : '关'}`
  root.querySelector('#voice')!.setAttribute('aria-pressed', String(voice))
  if (voice) narrate(currentLine().text); else speechSynthesis.cancel()
})
addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement
  if (target.closest('button,a,input,summary') || document.querySelector('dialog[open]')) return
  if (event.code === 'Space' || event.code === 'ArrowRight') { event.preventDefault(); advance() }
})
function showError(error: unknown) {
  root.querySelector('#loading-text')!.textContent = error instanceof Error ? error.message : String(error)
  const retry = document.createElement('button'); retry.textContent = '重新打开'; retry.addEventListener('click', () => location.reload())
  root.querySelector('#loading')!.append(retry)
  console.error('Story page unavailable', error)
}
async function start() {
  const base = `/packages/${STORY_ID}`
  const result = await validateScenePackage(createFetchReader(base))
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length || !result.scene || !result.sources || !result.story) throw new Error(`故事包校验失败：${errors.map((error) => error.message).join('；')}`)
  if (result.story.contentRevision !== REVISION) throw new Error('故事包与书页版本不一致')
  sourceFile = result.sources
  const bookResponse = await fetch(`${base}/book.json`)
  if (!bookResponse.ok) throw new Error('没有找到人物对话与场景书页')
  const book = await bookResponse.json()
  if (book.contentRevision !== REVISION || book.storyId !== STORY_ID || JSON.stringify(book.scenes) !== JSON.stringify(bookScenes)) throw new Error('对话书页版本不一致，请重新准备故事包')
  await Promise.all(['full.jpg', 'journey.jpg', 'farewell.jpg'].map((name) => new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`壁画无法加载：${name}`))
    image.src = `/yuezhi/murals/${name}`
  })))
  const provenanceResponse = await fetch(`${base}/asset-provenance.json`)
  if (!provenanceResponse.ok) throw new Error('无法读取 Tripo 资产来源')
  const provenance = await provenanceResponse.json() as { assets: Array<{ assetId: string; path: string; sha256: string; taskId: string; provider: string }> }
  const openScene = installSceneInspector({
    base, scene: result.scene, provenance,
    currentPage: () => ({ scene: progress.scene, line: progress.line }),
    onOpen: () => { if ('speechSynthesis' in window) speechSynthesis.cancel() },
  })
  root.querySelector('#scene-view-button')!.addEventListener('click', () => { if (!turning) openScene() })
  const extraResponse = await fetch('/yuezhi/murals/3d-assets.json')
  const extras: InspectAsset[] = extraResponse.ok ? await extraResponse.json() : []
  const openAsset = installInspector([...extras, ...provenance.assets.filter(a => a.provider.startsWith('Tripo')).map(a => ({
    id: a.assetId, label: a.assetId === 'asset-envoy' ? '汉使人物 · Tripo 3D' : '当地人物 · Tripo 3D',
    path: `${base}/${a.path}`, hash: a.sha256, taskId: a.taskId,
    note: '已有 Tripo 文生模型，供人物形体与服饰示意；并非据此壁画生成，不是张骞或月氏人物的确定肖像。',
  }))])
  const hotspots = root.querySelector('#asset-hotspots')!
  for (const asset of extras) {
    const button = document.createElement('button')
    button.dataset.asset = asset.id; button.textContent = '壁画中的马 · 查看 3D'
    hotspots.append(button)
  }
  root.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach(button => button.addEventListener('click', () => {
    if (!turning) openAsset(button.dataset.asset!)
  }))
  ready = true
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false })
  root.querySelector<HTMLElement>('#loading')!.hidden = true
  setStage(); save()
}
root.querySelector('#music')!.addEventListener('click', async () => {
  const button = root.querySelector<HTMLButtonElement>('#music')!
  musicWanted = !musicWanted
  if (musicWanted) {
    try { await music.play() } catch { musicWanted = false; button.textContent = '配乐未能播放 · 点击重试'; button.setAttribute('aria-pressed', 'false'); return }
  } else music.pause()
  button.textContent = `配乐：${musicWanted ? '开' : '关'}`
  button.setAttribute('aria-pressed', String(musicWanted))
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { music.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel() }
  else if (musicWanted) void music.play().catch(() => {
    musicWanted = false
    root.querySelector('#music')!.textContent = '配乐暂停 · 点击重试'
    root.querySelector('#music')!.setAttribute('aria-pressed', 'false')
  })
})
void start().catch(showError)
