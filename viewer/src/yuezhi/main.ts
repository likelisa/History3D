import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SceneFile, SourcesFile, Vec3 } from '../../../contracts/src/types.ts'
import { validateScenePackage } from '../../../contracts/src/validate.ts'
import { createFetchReader } from '../reader.ts'
import { Walker } from '../walker.ts'
import { resolveMove } from '../../../contracts/src/geometry.ts'
import { boundary, chapters, clues, REVISION, STORY_ID } from './content.ts'
import { advance, freshProgress, readProgress } from './state.ts'
import type { Prediction, Progress } from './state.ts'
import './style.css'

const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
  <div id="world" aria-label="月氏空间场景"></div>
  <header class="masthead"><a class="brand" href="/yuezhi.html">HISTORY<span>3D</span></a><span class="mast-divider"></span><span class="series">第一次出使 · 一段历史现场</span>
    <div class="header-actions"><button id="source-button">史料与边界 ↗</button><button id="restart">重新开始</button></div></header>
  <div class="chapter-rail" aria-label="故事章节">${chapters.map((chapter, i) => `<button data-chapter="${i}"><span>${chapter.number}</span><span>${chapter.subtitle}</span></button>`).join('')}</div>
  <div class="scene-caption"><span class="caption-rule"></span><span>大月氏 · 会见地点未详</span><small>河谷、布局与人物外形为制作示意</small></div>
  <div id="markers"></div>
  <div class="view-tools" aria-label="观察方式"><button id="overview">全景</button><button id="walk">人尺度漫游</button><button id="route">出使路线</button><button id="sound" aria-pressed="false">朗读：关</button></div>
  <div class="walk-pad" hidden aria-label="漫游步进控制"><button data-step="left" aria-label="向左转">↶</button><button data-step="forward" aria-label="向前走一步">↑</button><button data-step="right" aria-label="向右转">↷</button></div>
  <section class="story-panel" aria-label="故事讲述" aria-live="polite"></section>
  <div class="controls-hint" id="controls-hint">拖动观察 · 滚轮靠近 · 点击线索了解处境</div>
  <div class="asset-note" id="asset-note">正在核对场景资产…</div>
  <div id="loading" class="loading"><span class="loading-brand">HISTORY3D</span><h1>张骞使月氏</h1><p id="load-text">正在读取故事与来源</p><div class="load-line"><span id="load-progress"></span></div></div>
  <dialog id="detail"><div class="dialog-body"></div><button class="dialog-close" aria-label="关闭面板">×</button></dialog>
  <div id="toast" role="status"></div>`
root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })

const STORAGE_KEY = `history3d:${STORY_ID}:r${REVISION}`
let progress: Progress = freshProgress()
try { progress = readProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { /* Corrupt or disabled storage starts a new local session. */ }
const panel = root.querySelector<HTMLElement>('.story-panel')!
const dialog = root.querySelector<HTMLDialogElement>('#detail')!
const dialogBody = dialog.querySelector<HTMLElement>('.dialog-body')!
const assetNote = root.querySelector<HTMLElement>('#asset-note')!
const markersElement = root.querySelector<HTMLElement>('#markers')!
const base = `/packages/${STORY_ID}`
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.25
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.domElement.setAttribute('aria-label', '可拖动观察的月氏场景')
renderer.domElement.setAttribute('tabindex', '0')
root.querySelector('#world')!.append(renderer.domElement)
const world = new THREE.Scene()
world.background = new THREE.Color('#bacad0')
world.fog = new THREE.Fog('#bacad0', 40, 115)
const camera = new THREE.PerspectiveCamera(47, 1, 0.08, 180)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.075
controls.maxPolarAngle = Math.PI / 2 - 0.045
controls.minDistance = 3
controls.maxDistance = 38
controls.enablePan = true
const sky = new THREE.HemisphereLight('#e1efff', '#938064', 2.0)
world.add(sky)
const sun = new THREE.DirectionalLight('#ffe7bd', 3.0)
sun.position.set(-18, 25, 12)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 0.5, far: 85 })
sun.shadow.normalBias = 0.035
world.add(sun)
let scene: SceneFile
let sourceFile: SourcesFile
let walker: Walker
let walking = false
let speaking = false
let ready = false
let animationFrames = 0
let loadMs = 0
const assetRecords: Array<{ id: string; bytes: number; sha256: string; dimensions: number[]; instances: number }> = []
let flight: { started: number; from: THREE.Vector3; fromTarget: THREE.Vector3; to: THREE.Vector3; toTarget: THREE.Vector3 } | null = null
const markers: Array<{ element: HTMLButtonElement; position: THREE.Vector3 }> = []
let toastTimer = 0

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)) } catch { /* Persistence is optional, never blocks the story. */ }
  Object.assign(window, { __yuezhi: { progress: structuredClone(progress), ready, loadMs, animationFrames, walking, assets: assetRecords } })
  root.dataset.ready = String(ready)
  root.dataset.chapter = String(progress.chapter)
  root.dataset.furthest = String(progress.furthest)
  root.dataset.seenClues = progress.clues.join(',')
  root.dataset.walking = String(walking)
  root.dataset.completed = String(progress.completed)
  root.dataset.loadedAssets = String(assetRecords.length)
  if (walker) root.dataset.feet = walker.feet.map((coordinate) => coordinate.toFixed(3)).join(',')
}
function toast(text: string) {
  root.querySelector('#toast')!.textContent = text
  root.querySelector('#toast')!.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => root.querySelector('#toast')!.classList.remove('visible'), 3500)
}
function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
function sourceHtml(ids: string[]) {
  return ids.map((id) => sourceFile.sources.find((source) => source.id === id)).filter((source) => !!source).map((source) => `<article class="source"><span class="eyebrow">古籍记载 · 数字文本</span><h3>${escape(source.title)}</h3><blockquote>${escape(source.excerpt)}</blockquote><p>${escape(source.location)}</p><a href="${escape(source.locator.url!)}" target="_blank" rel="noopener noreferrer">打开原文 ↗</a></article>`).join('')
}
function openDetail(html: string) {
  dialogBody.innerHTML = html
  if (!dialog.open) dialog.showModal()
  if (document.pointerLockElement) document.exitPointerLock()
  if (walker) { walker.clearInput(); walker.enabled = false }
}
function narrate(text: string) {
  if (!speaking || !('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'; utterance.rate = 0.93
  speechSynthesis.speak(utterance)
}
function lookAt(position: Vec3, target: Vec3) {
  exitWalk()
  flight = { started: performance.now(), from: camera.position.clone(), fromTarget: controls.target.clone(), to: new THREE.Vector3(...position), toTarget: new THREE.Vector3(...target) }
}
function showChapter(index: number, animate = true) {
  progress.chapter = index
  save(); renderStory()
  const chapter = chapters[index]!
  if (animate) lookAt(chapter.position, chapter.target)
  narrate(chapter.text)
}
function renderStory() {
  const chapter = chapters[progress.chapter]!
  panel.classList.remove('collapsed')
  panel.innerHTML = `<div class="chapter-heading"><span class="eyebrow">${chapter.number} / 03 · ${chapter.kicker}</span><button id="collapse-story" class="text-button" aria-expanded="true">收起讲述 −</button></div><h1>${chapter.title}</h1><p>${chapter.text}</p>
    ${progress.chapter === 1 ? `<div class="clue-list" aria-label="可探索线索">${clues.map((clue) => `<button data-clue="${clue.id}" class="${progress.clues.includes(clue.id) ? 'seen' : ''}"><span>${progress.clues.includes(clue.id) ? '✓' : '○'}</span> ${clue.title}</button>`).join('')}</div>` : `<div class="story-thought">${chapter.question}</div>`}
    <div class="panel-footer"><button id="chapter-source" class="text-button">查看本幕出处 ↗</button><button id="continue" class="primary">${progress.completed && progress.chapter === 2 ? '已完成 · 回看故事' : chapter.action}<span>→</span></button></div>`
  panel.querySelector('#continue')!.addEventListener('click', () => {
    if (progress.chapter === 0) { progress = advance(progress); showChapter(1) }
    else if (progress.chapter === 1) showPrediction()
    else { progress.completed = true; save(); showRecap() }
  })
  panel.querySelector('#chapter-source')!.addEventListener('click', () => openDetail(`<span class="eyebrow">${chapter.subtitle}</span><h2>本幕依据</h2>${sourceHtml(chapter.sourceIds)}`))
  panel.querySelector('#collapse-story')!.addEventListener('click', (event) => {
    const collapsed = panel.classList.toggle('collapsed')
    const button = event.currentTarget as HTMLButtonElement
    button.textContent = collapsed ? '展开讲述 +' : '收起讲述 −'
    button.setAttribute('aria-expanded', String(!collapsed))
  })
  panel.querySelectorAll<HTMLButtonElement>('[data-clue]').forEach((button) => button.addEventListener('click', () => visitClue(button.dataset.clue!)))
  root.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button) => {
    const index = Number(button.dataset.chapter)
    button.classList.toggle('active', index === progress.chapter)
    button.setAttribute('aria-current', index === progress.chapter ? 'step' : 'false')
    button.disabled = index > progress.furthest
  })
  markersElement.hidden = progress.chapter !== 1
}
function visitClue(id: string) {
  const clue = clues.find((candidate) => candidate.id === id)!
  if (!progress.clues.includes(id)) progress.clues.push(id)
  save(); renderStory(); lookAt(clue.camera, clue.target)
  openDetail(`<span class="eyebrow">空间线索 · ${clue.label}</span><h2>${clue.title}</h2><p class="detail-lead">${clue.text}</p><details><summary>展开史料依据</summary>${sourceHtml(clue.sourceIds)}</details><p class="annotation">你看到的场景是制作示意；古籍没有提供这里的具体布局。</p><button class="primary" id="back-explore">继续观察 →</button>`)
  dialogBody.querySelector('#back-explore')!.addEventListener('click', () => dialog.close())
  narrate(clue.text)
}
function showPrediction() {
  openDetail(`<span class="eyebrow">在结果揭晓之前</span><h2>月氏会接受联合请求吗？</h2><p class="detail-lead">结合你看到的线索，说说自己的判断。这里的选择不会改写历史。</p><div class="prediction-options"><button data-prediction="accept">有共同旧敌，可能愿意</button><button data-prediction="decline">更重视现状，未必愿意</button><button data-prediction="skip">直接看史书记载</button></div>`)
  dialogBody.querySelectorAll<HTMLButtonElement>('[data-prediction]').forEach((button) => button.addEventListener('click', () => {
    progress.prediction = button.dataset.prediction as Prediction
    save()
    dialogBody.innerHTML = `<span class="eyebrow">史书记载的结果</span><h2>张骞未取得期望的约定</h2><p class="detail-lead">${progress.prediction === 'accept' ? '共同的旧敌确实解释了汉廷的期待。但抵达后的月氏，已处在另一种生活与地理条件中。' : '《史记》将月氏安居、少受侵扰、认为与汉遥远的处境，与未得要领的结果放在同一段记述中。'}</p>${sourceHtml(['shiji-disposition'])}<button class="primary" id="reveal-outcome">进入最后一幕 →</button>`
    dialogBody.querySelector('#reveal-outcome')!.addEventListener('click', () => { dialog.close(); progress = advance(progress); showChapter(2) })
  }))
}
function showRecap() {
  openDetail(`<span class="eyebrow">三幕故事 · 回看</span><h2>一次目标未成的出使</h2><ol class="recap"><li><strong>汉廷希望什么？</strong><p>联系月氏，共同对付匈奴。</p></li><li><strong>月氏当时的处境是什么？</strong><p>史书描述其安居、少寇，倾向安乐，又认为与汉遥远。</p></li><li><strong>出使留下什么？</strong><p>未得期望的约定；张骞后来报告了西域诸国的亲历与传闻。</p></li></ol><p class="annotation">${boundary}</p><button class="primary" id="replay">重新走一遍 →</button>`)
  dialogBody.querySelector('#replay')!.addEventListener('click', reset)
}
function reset() {
  if (dialog.open) dialog.close()
  progress = freshProgress()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
  showChapter(0)
  toast('已回到故事起点；本地探索记录已重置。')
}
function exitWalk() {
  if (!walking) return
  walking = false; walker.clearInput(); walker.enabled = false
  if (document.pointerLockElement) document.exitPointerLock()
  controls.enabled = true
  root.querySelector('#walk')!.setAttribute('aria-pressed', 'false')
  root.querySelector<HTMLElement>('.walk-pad')!.hidden = true
  root.querySelector('#controls-hint')!.textContent = '拖动观察 · 滚轮靠近 · 点击线索了解处境'
  save()
}
function enterWalk() {
  if (walking) { exitWalk(); lookAt(chapters[progress.chapter]!.position, chapters[progress.chapter]!.target); return }
  walking = true; flight = null; controls.enabled = false
  walker.reset(); walker.enabled = true; walker.applyTo(camera)
  root.querySelector('#walk')!.setAttribute('aria-pressed', 'true')
  root.querySelector<HTMLElement>('.walk-pad')!.hidden = false
  root.querySelector('#controls-hint')!.textContent = 'WASD / 方向键移动 · 点击画面后鼠标转向 · Esc 释放鼠标'
  renderer.domElement.focus(); save()
}
root.querySelector('#overview')!.addEventListener('click', () => lookAt(scene.cameras.overview.position, scene.cameras.overview.target))
root.querySelector('#walk')!.addEventListener('click', enterWalk)
root.querySelector('#route')!.addEventListener('click', () => openDetail(`<span class="eyebrow">叙事顺序 · 非精确地理地图</span><h2>从任务到抵达</h2><div class="route-sequence">应募出使<span>↓</span>途中被匈奴留十余年<span>↓</span>逃离后至大宛<span>↓</span>康居<span>↓</span>大月氏 → 大夏</div><p class="annotation">此图不表示方位、距离或实际行进路线。</p>${sourceHtml(['shiji-mission', 'shiji-arrival'])}`))
root.querySelector('#source-button')!.addEventListener('click', () => openDetail(`<span class="eyebrow">史料与表达边界</span><h2>我们知道什么，哪些仍未知</h2><p class="detail-lead">${boundary}</p><p class="annotation">人物外形为生成示意。页面不重演未经史料支持的谈判对白；“月氏一侧”不指定某位王或继位者。数字文本来源仍待底本与史料负责人复核。</p>${sourceHtml(sourceFile.sources.map((source) => source.id))}`))
root.querySelector('#restart')!.addEventListener('click', reset)
root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) => button.addEventListener('click', () => {
  if (!walking) return
  if (button.dataset.step === 'left') walker.yawRad += Math.PI / 8
  else if (button.dataset.step === 'right') walker.yawRad -= Math.PI / 8
  else {
    const next = resolveMove(walker.feet, [-Math.sin(walker.yawRad) * 0.8, -Math.cos(walker.yawRad) * 0.8], walker.config.bounds, walker.config.blockers, walker.config.radiusM)
    walker.feet = [next.x, next.z]
  }
  save()
}))
root.querySelector('#sound')!.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { toast('此浏览器未提供朗读，故事文字仍可完整阅读。'); return }
  speaking = !speaking
  root.querySelector('#sound')!.textContent = `朗读：${speaking ? '开' : '关'}`
  root.querySelector('#sound')!.setAttribute('aria-pressed', String(speaking))
  if (speaking) narrate(chapters[progress.chapter]!.text); else speechSynthesis.cancel()
})
root.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button) => button.addEventListener('click', () => showChapter(Number(button.dataset.chapter))))
dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close())
dialog.addEventListener('close', () => { if (walking) walker.enabled = true })
dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close() } })
controls.addEventListener('start', () => { flight = null })
document.addEventListener('keydown', (event) => {
  if (!ready || dialog.open || !walking) return
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
  walker.handleKey(event, true)
})
document.addEventListener('keyup', (event) => walker?.handleKey(event, false))
window.addEventListener('blur', () => { if (walking) { walker.clearInput(); walker.enabled = false; toast('已暂停漫游；重新点击画面继续。') } })
document.addEventListener('mousemove', (event) => { if (document.pointerLockElement === renderer.domElement) walker.handleMouseMove(event.movementX, event.movementY) })
renderer.domElement.addEventListener('click', () => {
  if (walking && !dialog.open) {
    walker.enabled = true
    if (!renderer.domElement.requestPointerLock) { toast('鼠标锁定不可用；仍可用方向键或步进按钮移动。'); return }
    const request = renderer.domElement.requestPointerLock()
    if (request && typeof request.catch === 'function') void request.catch(() => toast('鼠标锁定不可用；仍可用方向键或步进按钮移动。'))
  }
})
window.addEventListener('resize', resize)
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix()
}
resize()

async function start() {
  const started = performance.now()
  const result = await validateScenePackage(createFetchReader(base))
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length || !result.scene || !result.story || !result.sources) throw new Error(`故事包校验失败：${errors.map((error) => error.message).join('；')}`)
  if (result.story.storyId !== STORY_ID || result.story.contentRevision !== REVISION) throw new Error('故事版本与交互版本不一致')
  scene = result.scene; sourceFile = result.sources
  const provenanceResponse = await fetch(`${base}/asset-provenance.json`)
  if (!provenanceResponse.ok) throw new Error('无法读取资产来源清单')
  const provenance = await provenanceResponse.json() as { realTripoAssetsReceived: boolean; assets: Array<{ assetId: string; sha256: string }> }
  const loader = new GLTFLoader()
  const templates = new Map<string, THREE.Group>()
  for (const [index, asset] of scene.assets.entries()) {
    root.querySelector('#load-text')!.textContent = `正在加载与核对资产 ${index + 1} / ${scene.assets.length}`
    const response = await fetch(`${base}/${asset.path}`)
    if (!response.ok) throw new Error(`模型加载失败：${asset.path} (${response.status})`)
    const bytes = await response.arrayBuffer()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    if (provenance.assets.find((item) => item.assetId === asset.id)?.sha256 !== hash) throw new Error(`模型哈希与来源清单不一致：${asset.path}`)
    const gltf = await loader.parseAsync(bytes, `${base}/assets/`)
    gltf.scene.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3())
    templates.set(asset.id, gltf.scene)
    assetRecords.push({ id: asset.id, bytes: bytes.byteLength, sha256: hash, dimensions: size.toArray(), instances: scene.objects.filter((object) => object.render.type === 'asset' && object.render.assetId === asset.id).length })
    root.querySelector<HTMLElement>('#load-progress')!.style.width = `${(index + 1) / scene.assets.length * 100}%`
  }
  for (const definition of scene.objects) {
    if (definition.render.type !== 'asset') throw new Error('本场景不允许静默替换主对象为灰盒')
    const instance = templates.get(definition.render.assetId)!.clone(true)
    instance.position.set(...definition.position)
    instance.rotation.set(...definition.rotation)
    instance.scale.set(...definition.scale)
    instance.name = definition.id
    instance.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = definition.id !== 'obj-environment'; object.receiveShadow = true } })
    world.add(instance)
  }
  walker = new Walker({ ...scene.cameras.firstPerson, bounds: scene.walkableBounds, blockers: scene.blockers, groundY: scene.ground.y })
  for (const clue of clues) {
    const button = document.createElement('button')
    button.className = 'world-marker'; button.dataset.clue = clue.id
    button.innerHTML = `<span class="marker-dot"></span><span>${clue.title}</span>`
    button.addEventListener('click', () => visitClue(clue.id))
    markersElement.append(button)
    markers.push({ element: button, position: new THREE.Vector3(...clue.position) })
  }
  const chapter = chapters[progress.chapter]!
  camera.position.set(...chapter.position); controls.target.set(...chapter.target); controls.update()
  loadMs = performance.now() - started
  ready = true
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false })
  assetNote.textContent = provenance.realTripoAssetsReceived ? '人物由 Tripo 制作 · 外形为示意' : '暂用人物示意 · 待真实主资产替换'
  root.querySelector('#loading')!.classList.add('loaded')
  root.querySelector('#loading')!.setAttribute('aria-hidden', 'true')
  showChapter(progress.chapter, false)
  save()
}
let previous = performance.now()
function animate(now: number) {
  const delta = Math.min((now - previous) / 1000, 0.05)
  previous = now
  if (flight) {
    const t = Math.min(1, (now - flight.started) / 1450)
    const eased = t * t * (3 - 2 * t)
    camera.position.lerpVectors(flight.from, flight.to, eased)
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
    if (t === 1) flight = null
  }
  if (walking) {
    walker.update(delta); walker.applyTo(camera)
    if (progress.chapter === 1 && !dialog.open) {
      const nearby = clues.find((clue) => !progress.clues.includes(clue.id) && Math.hypot(walker.feet[0] - clue.position[0], walker.feet[1] - clue.position[2]) < 2.1)
      if (nearby) visitClue(nearby.id)
    }
  } else controls.update()
  for (const marker of markers) {
    const projected = marker.position.clone().project(camera)
    marker.element.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 0.93 || Math.abs(projected.y) > 0.87
    marker.element.style.transform = `translate(-50%, -50%) translate(${(projected.x * 0.5 + 0.5) * window.innerWidth}px, ${(-projected.y * 0.5 + 0.5) * window.innerHeight}px)`
  }
  renderer.render(world, camera)
  animationFrames++
  if (ready && animationFrames % 90 === 0) save()
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)
void start().catch((error: unknown) => {
  root.querySelector('#load-text')!.textContent = error instanceof Error ? error.message : String(error)
  const retry = document.createElement('button'); retry.textContent = '重新加载'; retry.className = 'primary'
  retry.addEventListener('click', () => location.reload()); root.querySelector('#loading')!.append(retry)
  console.error('Yuezhi scene failed', error)
})
