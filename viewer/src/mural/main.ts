import * as THREE from 'three'
import { createCinemaWorld, type CinemaWorld } from './cinema-world.ts'
import { chapters as chapterDefinitions, annotations as storyAnnotations, sources } from './story.ts'
import { fitMuralView, interpolateMuralViews, toMuralCamera, type MuralView } from './framing.ts'
import { buildPlaybackTimeline, locateMoment, type NarrationTrack } from './playback.ts'
import { getSceneBeat } from './scene-beats.ts'
import { subtitleText, timedSubtitleText, routePosition } from './presentation.ts'
import { advanceStoryClock, subtitleMediaSeconds } from './audio-clock.ts'
import { cueView, cueFocus, focusVisible, spatialFocusIds, goldenFigureRegions, type PresentationView } from './cue-presentation.ts'
import { advancePresentation, cueRouteProgress, presentationFrame, resetPresentation } from './presentation-state.ts'
import { englishSubtitles } from './subtitles.ts'
import './style.css'

const annotations = storyAnnotations.filter(annotation => annotation.id !== 'remembered-journey')
const muralSize = { width: 21.72, height: 18 }
const fov = 43
const app = document.querySelector<HTMLDivElement>('#app')!
const kindLabels = { mural: '壁画补充', history: '故事讲述', interpretation: '后世解读' }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
app.innerHTML = `
  <header><div class="identity"><strong>张骞出使西域图</strong></div><button id="source">壁画与史料</button></header>
  <main id="experience">
    <section id="presentation" aria-label="图像与当前讲述">
    <section id="stage" aria-label="壁画与立体场景">
      <canvas aria-label="张骞出使西域的故事与辅助图像"></canvas>
      <div id="scene-badge">原壁画 · 全画</div>
      <button id="asset-credit" hidden aria-label="查看Tripo 3D资产来源">人物与马：Tripo 3D生成 · 布景与动作：项目制作</button>
      <div id="detention-phase" hidden></div>
      <div id="view-controls"><button id="overview" disabled>定位全画</button><button id="view-toggle" disabled>查看对应3D场景</button></div>
      <div id="focus-highlights" aria-hidden="true"></div><div id="character-names" aria-label="人物身份"></div>
      <section id="route-stage" hidden aria-label="当前行进路线"><strong>沿路线看这段远行</strong><div id="large-route-map"><img src="/mural-assets/route-reference.png" alt="张骞出使西域路线参考图"><span id="large-route-marker" aria-hidden="true"></span></div><p id="large-route-location"></p></section>
      <div id="labels" aria-label="画中标注"></div>
      <div id="transition" aria-hidden="true"><span>从原画走进山道</span></div>
      <section id="intro"><p class="eyebrow">先讲一段远行，再看后人怎样记住它</p><h1>没有带回盟约，<br>却带回了一个新世界。</h1><p>从寻找盟友，到被扣十余年，再到十三年后归汉。<br>跟随张骞的经历，图片与3D帮助我们理解这段远行。</p><button id="start" class="primary" disabled>正在准备原画与场景…</button><small id="load-status">读取立体资产与逐句旁白</small></section>
      <section id="annotation-detail" hidden aria-label="标注详情"><button id="annotation-close" aria-label="关闭标注">×</button><span id="annotation-kind"></span><h3 id="annotation-title"></h3><p id="annotation-text"></p><small id="annotation-hint">点击「继续讲述」接着看。</small></section>
      <section id="ending" hidden><p class="eyebrow">回到原画</p><h2>一段远行，两种讲述。</h2><p>史书解释出使的目的与结果。<br>初唐壁画呈现后世的佛教记忆。</p><button id="replay" class="primary">重新讲述</button><button id="explore-end">留在画中回看标注</button></section>
      <div id="error" hidden role="alert"><p id="error-message"></p><button id="retry">重新加载</button><a href="/yuezhi.html">打开原绘本</a></div>
    </section>
    <section id="caption-row" aria-label="当前逐句讲述"><label id="caption-sizing">字幕区 <select id="caption-height" aria-label="字幕高度"><option value="120">紧凑</option><option value="156" selected>宽松</option></select></label><div id="caption" hidden><span id="cue-kind"></span><p id="narration" lang="zh-CN"></p><p id="narration-en" lang="en"></p></div></section>
    </section>
    <section id="reading" aria-label="故事讲解"><section id="story-context"><span id="story-location">汉朝 · 寻找盟友</span><h2 id="story-title">为什么向西出发</h2><p id="story-takeaway">汉武帝希望联合月氏对抗匈奴，张骞接下了寻找盟友的任务。</p></section>
      <section id="orientation" aria-label="原壁画辅助参照"><div><strong id="orientation-title">辅助参照 · 原壁画</strong><span id="map-location">全画</span></div><div id="mini-map"><img src="/yuezhi/murals/full.jpg" alt="原壁画位置图"><div id="mini-focus"></div></div></section>
      <section id="journey-map" aria-label="行进路线图"><strong>张骞的行进路线</strong><div id="route-map"><img src="/mural-assets/route-reference.png" alt="用户提供的张骞出使西域路线参考图"><span id="route-marker" aria-hidden="true"></span></div><p id="route-location"></p></section>
      <div id="chapter-annotations" aria-label="本段标注"></div>

    </section>
  </main>
  <footer>
    <nav id="chapters" aria-label="张骞故事的八个讲述环节"></nav>
    <div class="transport"><button id="previous" disabled aria-label="上一段">← 上一段</button><button id="pause" disabled>开始后可暂停</button><button id="next" disabled aria-label="下一段">下一段 →</button><button id="voice" disabled aria-pressed="true">旁白已开启</button><label>讲述速度 <select id="speed" aria-label="讲述速度"><option value="0.8">更慢 0.8×</option><option value="1" selected>舒缓 1×</option><option value="1.15">稍快 1.15×</option><option value="1.3">清快 1.3×</option><option value="1.5">快讲 1.5×</option></select></label><input id="story-progress" type="range" disabled aria-label="故事进度" min="0" max="1" step="0.05" value="0"><span id="clock">准备中</span></div>
  </footer>
  <section id="source-panel" hidden role="dialog" aria-modal="true" aria-labelledby="source-title"><button id="source-close" aria-label="关闭壁画与史料">×</button><p class="eyebrow">看画，也查证</p><h2 id="source-title">画面、史书和空间，各讲什么？</h2><p>初唐壁画有自己的佛教叙事。《史记》的外交经历帮助我们读懂背景，但不能把金人、僧人和佛塔当成首次出使的现场证据。</p><div id="source-links"></div><p>服饰与营地：第323窟是初唐壁画，画中服装不能直接证明汉代使者的真实穿着。现有汉使服装为艺术示意；匈奴人物使用考古资料作跨期参考。营地为原创布景，没有张骞扣留处的帐幕形制、布局或看守动作的逐项证据。<a href="https://www.metmuseum.org/art/collection/search/65231" target="_blank" rel="noopener">匈奴腰牌参考</a> · <a href="https://link.springer.com/article/10.1186/s43238-025-00191-2" target="_blank" rel="noopener">帐幕形制研究</a></p><p>配乐：At Rest — Kevin MacLeod (incompetech.com)。<a href="https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1100748" target="_blank" rel="noopener">原曲</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>；使用已有35秒节选，淡入淡出并转为MP3，循环播放。</p><p>地图包含副使及其他时期的路线；位置与连线用于空间示意。原画未改动。立体山道、人物面貌、尺度与背面是展示补全，不是考古复原。图像和生成资产的公开使用权利仍待负责人复核。</p></section>
  <audio id="narrator" preload="auto"></audio>
  <audio id="background-music" src="/yuezhi/murals/reflection.mp3" preload="metadata" loop></audio>`

const query = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!
const stage = query<HTMLElement>('#stage')
const canvas = query<HTMLCanvasElement>('canvas')
const audio = query<HTMLAudioElement>('#narrator')
const music = query<HTMLAudioElement>('#background-music')
music.volume = 0.12
let musicWanted = true
const start = query<HTMLButtonElement>('#start')
const pause = query<HTMLButtonElement>('#pause')
const note = document.createElement('p')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping=THREE.ACESFilmicToneMapping
renderer.toneMappingExposure=.94
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(fov, 1, .1, 150)
scene.add(new THREE.HemisphereLight('#d6e4ed', '#57452f', .85))
// Broad reflected daylight keeps faces legible under the reception canopy.
const fill=new THREE.DirectionalLight('#e3e9ef',.65)
fill.position.set(4,6,8);fill.target.position.set(0,1,-2);scene.add(fill,fill.target)
const sun = new THREE.DirectionalLight('#fff1d5', 2.3)
sun.position.set(-8, 16, 9); sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 28, bottom: -28 })
sun.shadow.bias = -.001; scene.add(sun)
let mural: THREE.Mesh | null = null
let cinema: CinemaWorld | null = null
let timeline = buildPlaybackTimeline(chapterDefinitions, [])
let time = 0, playing = false, started = false, voice = true, speed = 1
let currentChapter = -1, currentCue = -1, currentAudio = '', lastFrame = performance.now()
let audioAttempt = 0
let activeView: PresentationView = 'mural', manualView = false, fullMural = false
let stageWidth = 1, stageHeight = 1, viewFrom: MuralView | null = null, viewTo: MuralView | null = null, viewNow: MuralView | null = null
let viewElapsed = 2
let renderedMode: PresentationView = 'mural'
let presentationState = resetPresentation({ key: 'mural', mode: 'mural' })
let returnFocus: HTMLElement | null = null
const labelButtons = new Map<string, HTMLButtonElement>()
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const worldLabelIds: Record<string, string> = { 'westward-party': 'party', credential: 'staff', 'daxia-city': 'gate', monks: 'monks', 'buddhist-tower': 'tower' }
const overviewAnnotationIds = new Set(['emperor', 'envoy-farewell', 'westward-party', 'credential', 'golden-figures', 'monks', 'buddhist-tower'])

function overviewView() {
  return fitMuralView({ mode: 'overview', muralWidth: muralSize.width, muralHeight: muralSize.height, viewportWidth: stageWidth, viewportHeight: stageHeight })
}
function focusView(index: number) {
  const chapter = timeline.chapters[index]!
  return fitMuralView({ mode: chapter.mode === 'overview' ? 'overview' : 'detail', focus: chapter.focus, muralWidth: muralSize.width, muralHeight: muralSize.height, viewportWidth: stageWidth, viewportHeight: stageHeight })
}
function setMuralTarget(target: MuralView, instant = false) {
  viewFrom = viewNow && Math.abs(viewNow.aspect - target.aspect) < 1e-6 ? viewNow : target
  viewTo = target; viewElapsed = instant ? 2 : 0
}
function resize() {
  stageWidth = stage.clientWidth; stageHeight = stage.clientHeight
  renderer.setSize(stageWidth, stageHeight, false)
  camera.aspect = stageWidth / stageHeight; camera.updateProjectionMatrix()
  const next = fullMural || !started ? overviewView() : focusView(Math.max(0, currentChapter))
  viewNow = next; setMuralTarget(next, true)
}
new ResizeObserver(resize).observe(stage)
resize()
const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

function updateControls() {
  const voiceControl = query<HTMLButtonElement>('#voice')
  voiceControl.disabled = !started
  voiceControl.textContent = voice ? '旁白已开启' : '开启旁白'
  voiceControl.setAttribute('aria-pressed', String(voice))
  pause.disabled = !started || time >= timeline.duration
  pause.textContent = playing ? '暂停讲述' : '继续讲述'
  pause.setAttribute('aria-pressed', String(!playing))
  query<HTMLButtonElement>('#previous').disabled = !started || currentChapter <= 0
  query<HTMLButtonElement>('#next').disabled = !started || currentChapter >= timeline.chapters.length - 1
  query<HTMLButtonElement>('#overview').disabled = !started
  const moment = locateMoment(timeline, time)
  const storyView = cueView(moment.cue.id, moment.cueLocalSeconds, !!moment.cue.beat)
  query<HTMLButtonElement>('#view-toggle').disabled = !started || storyView === 'mural'
  query<HTMLButtonElement>('#view-toggle').textContent = activeView === 'mural' ? storyView === 'map' ? '返回路线图' : '查看对应3D场景' : storyView === 'map' ? '参考壁画' : '对应原画'
  query<HTMLInputElement>('#story-progress').max = String(timeline.duration)
  query<HTMLInputElement>('#story-progress').disabled = !started
}
function resetScenePresentation() {
  presentationState = resetPresentation(presentationFrame(locateMoment(timeline, time), started ? activeView : 'mural'))
  renderedMode = presentationState.displayed.mode
}
function stop(message?: string) {
  playing = false; audio.pause(); music.pause(); updateControls()
  if (message) note.textContent = message
}
function startMusic() {
  if (!musicWanted || !playing || document.hidden) return
  void music.play().catch(error => {
    if (error?.name === 'AbortError' || !playing || !musicWanted) return
    musicWanted = false; updateControls()
    note.textContent = '音乐暂未播放；点击音乐开关可重试。'
  })
}
function startAudio(restart = false) {
  const moment = locateMoment(timeline, time)
  const cue = moment.cue
  if (!voice || !playing || !cue.audioFile) return
  const localTime = time - (moment.chapter.start + cue.audioStart)
  if(localTime<0)return
  if (currentAudio === cue.id && !restart) {
    if (audio.ended || !audio.paused) return
  } else if (localTime >= cue.audioSeconds) return
  if (currentAudio !== cue.id || restart) {
    audio.pause(); currentAudio = cue.id
    audio.src = cue.audioFile
    audio.currentTime = Math.min(Math.max(0, localTime), Math.max(0, cue.audioSeconds - .03))
  }
  audio.playbackRate = speed
  const attempt = ++audioAttempt, requestedCue = cue.id, requestedSource = audio.src
  void audio.play().catch(error => {
    if (error?.name === 'AbortError' || attempt !== audioAttempt || currentAudio !== requestedCue || audio.src !== requestedSource || !playing || !voice) return
    voice = false; updateControls(); note.textContent = '旁白暂未播放，逐句文字仍会完整呈现；可点击旁白重新开启。'
  })
}
function resume() {
  if (!started || time >= timeline.duration) return
  query<HTMLElement>('#annotation-detail').hidden = true
  fullMural = false
  manualView = false
  const moment = locateMoment(timeline, time)
  activeView = cueView(moment.cue.id, moment.cueLocalSeconds, !!moment.cue.beat)
  if (activeView === 'mural') setMuralTarget(focusView(currentChapter))
  playing = true; lastFrame = performance.now(); note.textContent = '正在舒缓讲述；可暂停阅读，也可点击画中标注。'
  updateControls(); startAudio(); startMusic()
}
function begin() {
  started = true; time = 0; currentChapter = -1; currentCue = -1; currentAudio = ''
  canvas.dataset.complete = 'false'
  playing = true; lastFrame = performance.now(); manualView = false; fullMural = false
  query<HTMLElement>('#intro').hidden = true
  query<HTMLElement>('#ending').hidden = true
  query<HTMLElement>('#caption').hidden = false
  query<HTMLElement>('#annotation-detail').hidden = true
  updateMoment(); setMuralTarget(overviewView(), true)
  activeView = 'spatial'; resetScenePresentation()
  updateControls(); startAudio(); startMusic()
}
function seekChapter(index: number) {
  if (!started) return
  const chapter = timeline.chapters[THREE.MathUtils.clamp(index, 0, timeline.chapters.length - 1)]!
  stop('已定位这一段，先读这一段的故事；点击「继续讲述」可从这里接着听。')
  time = chapter.start; currentAudio = ''; manualView = false; fullMural = false
  canvas.dataset.complete = 'false'
  query<HTMLElement>('#ending').hidden = true
  query<HTMLElement>('#caption').hidden = false
  query<HTMLElement>('#annotation-detail').hidden = true
  currentChapter = -1; currentCue = -1; updateMoment(); updateControls(); resetScenePresentation()
}
function seekTime(value: number) {
  stop()
  time = THREE.MathUtils.clamp(value, 0, timeline.duration)
  currentAudio = ''; currentChapter = -1; currentCue = -1
  manualView = false; fullMural = false
  canvas.dataset.complete = String(time >= timeline.duration)
  query<HTMLElement>('#annotation-detail').hidden = true
  query<HTMLElement>('#ending').hidden = time < timeline.duration
  updateMoment(); updateControls(); resetScenePresentation()
}
function renderChapter(index: number) {
  const chapter = timeline.chapters[index]!
  query<HTMLElement>('#story-title').textContent = chapter.title
  query<HTMLElement>('#story-location').textContent = chapter.location
  query<HTMLElement>('#story-takeaway').textContent = chapter.takeaway
  query<HTMLElement>('#orientation-title').textContent = index === 7 ? '故事尾声 · 原壁画' : '辅助参照 · 原壁画'
  query<HTMLElement>('#mini-focus').style.cssText = `left:${chapter.focus.x * 100}%;top:${chapter.focus.y * 100}%;width:${chapter.focus.width * 100}%;height:${chapter.focus.height * 100}%`
  query<HTMLElement>('#map-location').textContent = chapter.mode === 'overview' ? '完整壁画' : chapter.location.split(' · ')[0]!
  const chapterAnnotations = annotations.filter(annotation => annotation.chapterIndex === index && annotation.id !== 'remembered-journey')
  query<HTMLElement>('#chapter-annotations').innerHTML = chapterAnnotations.map(annotation => `<button data-annotation="${annotation.id}" aria-label="查看本段标注：${escape(annotation.label)}">${escape(annotation.label)}</button>`).join('')
  query<HTMLElement>('#chapter-annotations').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.onclick = () => openAnnotation(button.dataset.annotation!) })
  query<HTMLElement>('#chapters').querySelectorAll<HTMLButtonElement>('button').forEach((button, buttonIndex) => {
    button.setAttribute('aria-current', buttonIndex === index ? 'step' : 'false')
    button.classList.toggle('visited', buttonIndex < index)
  })
  setMuralTarget(focusView(index))
  updateControls()
}
function updateMoment() {
  const moment = locateMoment(timeline, time)
  if (moment.chapterIndex !== currentChapter) {
    currentChapter = moment.chapterIndex; currentCue = -1
    manualView = false; fullMural = false; renderChapter(currentChapter)
  }
  if (moment.cueIndex !== currentCue) {
    currentCue = moment.cueIndex
    audio.pause();currentAudio=''
    // Every 3D beat has an explicit cue, rather than one shared walking shot.
    if (!manualView) { activeView = cueView(moment.cue.id, moment.cueLocalSeconds, !!moment.cue.beat); setMuralTarget(focusView(currentChapter)) }
    query<HTMLElement>('#cue-kind').textContent = kindLabels[moment.cue.sourceKind]
    if (playing && !moment.cue.beat) note.textContent = '正在讲述；可暂停阅读，或点击壁画标注。'
    if (playing) startAudio(true)
    updateControls()
  }
}
function openAnnotation(id: string) {
  const annotation = annotations.find(item => item.id === id)!
  stop('正在读画中标注，故事已暂停。')
  query<HTMLElement>('#annotation-detail').hidden = false
  query<HTMLElement>('#annotation-title').textContent = annotation.label
  query<HTMLElement>('#annotation-text').textContent = annotation.detail
  query<HTMLElement>('#annotation-kind').textContent = kindLabels[annotation.sourceKind]
  query<HTMLElement>('#annotation-hint').textContent = '位置参照原画；史书补充场景另作示意。点击「继续讲述」接着看。'
  query<HTMLButtonElement>('#annotation-close').focus()
}
function buildNavigation() {
  query<HTMLElement>('#chapters').innerHTML = timeline.chapters.map((chapter, index) => `<button disabled data-chapter="${index}" aria-label="第${index + 1}段：${escape(chapter.title)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escape(chapter.title)}</strong></button>`).join('')
  query<HTMLElement>('#chapters').querySelectorAll<HTMLButtonElement>('button').forEach((button, index) => { button.onclick = () => seekChapter(index) })
  for (const annotation of annotations) {
    const button = document.createElement('button')
    button.className = 'annotation'
    button.hidden = true
    button.dataset.annotation = annotation.id
    button.setAttribute('aria-label', `画中标注：${annotation.label}`)
    button.innerHTML = `<span class="pin"></span><span class="annotation-name">${escape(annotation.label)}</span>`
    button.onclick = () => openAnnotation(annotation.id)
    query<HTMLElement>('#labels').append(button); labelButtons.set(annotation.id, button)
    if (annotation.chapterIndex === 0 || annotations.find(item => item.chapterIndex === annotation.chapterIndex)!.id !== annotation.id) continue
    const dot = document.createElement('button')
    dot.className = 'map-dot'; dot.setAttribute('aria-label', `原画定位：${annotation.label}`)
    dot.style.left = `${annotation.x * 100}%`; dot.style.top = `${annotation.y * 100}%`
    dot.textContent = String(annotation.chapterIndex + 1)
    dot.onclick = () => { seekChapter(annotation.chapterIndex); activeView = 'mural'; manualView = true; setMuralTarget(focusView(annotation.chapterIndex)); updateControls() }
    query<HTMLElement>('#mini-map').append(dot)
  }
  query<HTMLElement>('#source-links').innerHTML = sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener">${escape(source.title)} ↗</a>`).join('')
}

start.onclick = begin
query<HTMLButtonElement>('#replay').onclick = begin
pause.onclick = () => playing ? stop('已暂停，可以读完这句话再继续。') : resume()
query<HTMLButtonElement>('#previous').onclick = () => seekChapter(currentChapter - 1)
query<HTMLButtonElement>('#next').onclick = () => seekChapter(currentChapter + 1)
let scrubbing = false, resumeAfterSeek = false
const progressControl = query<HTMLInputElement>('#story-progress')
progressControl.onpointerdown = () => { scrubbing = true; resumeAfterSeek = playing; stop() }
progressControl.oninput = () => {
  if (!scrubbing) { scrubbing = true; resumeAfterSeek = playing }
  seekTime(Number(progressControl.value))
  note.textContent = '正在定位；松开进度条后从这里继续。'
}
function finishScrub() {
  if (!scrubbing) return
  scrubbing = false
  if (resumeAfterSeek) resume()
  else note.textContent = '已定位到这里，点击「继续讲述」可接着听。'
  resumeAfterSeek = false
}
progressControl.onchange = finishScrub
progressControl.onpointerup = finishScrub
progressControl.onpointercancel = finishScrub
query<HTMLSelectElement>('#caption-height').onchange = event => {
  query<HTMLElement>('#presentation').style.setProperty('--caption-height', `${(event.target as HTMLSelectElement).value}px`)
}
query<HTMLButtonElement>('#asset-credit').onclick = () => {
  stop('正在查看Tripo资产来源，讲述已暂停。')
  query<HTMLElement>('#annotation-detail').hidden = false
  query<HTMLElement>('#annotation-kind').textContent = '资产生成来源'
  query<HTMLElement>('#annotation-hint').textContent = '展示使用已有生成资产。点击「继续讲述」接着看。'
  query<HTMLElement>('#annotation-title').textContent = 'Tripo 3D生成资产'
  query<HTMLElement>('#annotation-text').textContent = '人物、马、细竹杖杖身、城门、僧人与佛塔使用Tripo生成模型；张骞、甘父和细竹杖是r9独立生成资产，城门来自提示词实验B版。营地、王庭和动作由项目制作。细竹杖用于市场货物，并按当前展示选择作为持节道具的艺术载体；这不表示汉节与大夏邛竹杖器制相同，也不是汉节的考古复原。汉使服饰没有逐项复原依据，匈奴服装也包含跨时期的参考。它们是艺术示意，不代表汉代人物肖像、标准制服或考古复原。'
  query<HTMLButtonElement>('#annotation-close').focus()
}
query<HTMLSelectElement>('#speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); audio.playbackRate = speed; note.textContent = `讲述速度已改为 ${speed}×，文字与旁白一起调整。` }
query<HTMLButtonElement>('#voice').onclick = () => {
  voice = !voice; audioAttempt++
  if (voice) { currentAudio = ''; startAudio(true); note.textContent = '旁白已开启，字幕跟随实际播放位置。' }
  else { audio.pause(); note.textContent = '旁白已暂停，可按文字继续阅读。' }
  updateControls()
}
query<HTMLButtonElement>('#overview').onclick = () => {
  stop('全画中的数字与标签对应讲述环节；点原画位置图可以回到相应段落。')
  activeView = 'mural'; manualView = true; fullMural = true
  setMuralTarget(overviewView()); updateControls()
}
query<HTMLButtonElement>('#view-toggle').onclick = () => {
  stop('已切换对应视图；原画位置图一直保留，可对照人物和城门的位置。')
  const moment = locateMoment(timeline, time)
  const storyView = cueView(moment.cue.id, moment.cueLocalSeconds, !!moment.cue.beat)
  activeView = activeView === 'mural' ? storyView : 'mural'
  manualView = true; fullMural = false
  if (activeView === 'mural') setMuralTarget(focusView(currentChapter))
  updateControls()
}
query<HTMLButtonElement>('#annotation-close').onclick = () => { query<HTMLElement>('#annotation-detail').hidden = true; pause.focus() }
query<HTMLButtonElement>('#source').onclick = () => {
  returnFocus = document.activeElement as HTMLElement
  if (started) stop('正在查看来源，故事已暂停。')
  query<HTMLElement>('#source-panel').hidden = false
  query<HTMLButtonElement>('#source-close').focus()
}
function closeSources() { query<HTMLElement>('#source-panel').hidden = true; returnFocus?.focus() }
query<HTMLButtonElement>('#source-close').onclick = closeSources
query<HTMLButtonElement>('#explore-end').onclick = () => {
  query<HTMLElement>('#ending').hidden = true; query<HTMLElement>('#caption').hidden = true
  fullMural = true; manualView = true; activeView = 'mural'; setMuralTarget(overviewView())
  note.textContent = '现在可以回看画中标注，或点击底部章节重新听某一段。'
}
query<HTMLButtonElement>('#retry').onclick = () => location.reload()
addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeSources(); query<HTMLElement>('#annotation-detail').hidden = true }
  if (event.code === 'Space' && started && !(event.target as HTMLElement).closest('button,a,select,input')) { event.preventDefault(); pause.click() }
  if (event.key === 'Tab' && !query<HTMLElement>('#source-panel').hidden) {
    const focusable = [...query<HTMLElement>('#source-panel').querySelectorAll<HTMLElement>('button,a')]
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)!.focus() }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]!.focus() }
  }
})
addEventListener('pagehide', () => { audio.pause(); music.pause() })
document.addEventListener('visibilitychange', () => { if (document.hidden && started) stop('页面切到后台，故事已暂停；回来后可以继续。') })
audio.addEventListener('error', () => {
  if (!started || !currentAudio || !audio.error) return
  voice = false; updateControls(); note.textContent = '这一句音频暂不可用，文字仍可完整阅读；旁白可重新开启。'
})

async function loadScene() {
  try {
    const [texture, world, narrationResponse] = await Promise.all([
      new THREE.TextureLoader().loadAsync('/yuezhi/murals/full.jpg'),
      createCinemaWorld(), fetch('/mural-assets/narration-v12/manifest.json'),
    ])
    if (!narrationResponse.ok) throw new Error('逐句旁白清单无法读取')
    const narration = await narrationResponse.json() as { tracks: NarrationTrack[]; formatVersion: string; voice: string; synthesis: string }
    timeline = buildPlaybackTimeline(chapterDefinitions, narration.tracks)
    // Verify the recordings we will actually play, not only their manifest text.
    const recordedUrls = new Map<string, string>()
    let audioCursor = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (audioCursor < narration.tracks.length) {
        const track = narration.tracks[audioCursor++]!
        const response = await fetch(track.file)
        if (!response.ok) throw new Error(`旁白读取失败：${track.id}`)
        const bytes = await response.arrayBuffer()
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
        if (bytes.byteLength !== track.bytes || hash !== track.sha256) throw new Error(`旁白校验失败：${track.id}`)
        recordedUrls.set(track.id, URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })))
      }
    }))
    for (const chapter of timeline.chapters) for (const cue of chapter.cues) cue.audioFile = recordedUrls.get(cue.id)!
    texture.colorSpace = THREE.SRGBColorSpace
    mural = new THREE.Mesh(new THREE.PlaneGeometry(muralSize.width, muralSize.height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide,toneMapped:false }))
    scene.add(mural); cinema = world; scene.add(cinema.group)
    const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy())
    cinema.group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!(material instanceof THREE.MeshStandardMaterial))continue
        for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap])if(texture){texture.anisotropy=anisotropy;texture.needsUpdate=true}
      }
    })
    canvas.dataset.ready = 'true'; canvas.dataset.assets = String(world.assetCount)
    canvas.dataset.generatedAssets = 'gate-b,zhangqian-r9,ganfu-r9,qiong-bamboo-r9'
    canvas.dataset.audioTracks = String(narration.tracks.length)
    canvas.dataset.audioVerified = String(recordedUrls.size)
    canvas.dataset.audioVersion = narration.formatVersion
    canvas.dataset.audioVoice = narration.voice
    canvas.dataset.audioSynthesis = narration.synthesis
    buildNavigation(); start.disabled = false; start.textContent = '开始张骞的故事'
    query<HTMLElement>('#load-status').textContent = `约 ${Math.ceil(timeline.duration / 60)} 分钟 · 逐句旁白与标注 · 可随时暂停`
    updateControls(); query<HTMLElement>('#clock').textContent = `0:00 / ${formatTime(timeline.duration)}`
  } catch (error) {
    query<HTMLElement>('#error').hidden = false
    query<HTMLElement>('#error-message').textContent = error instanceof Error ? error.message : '壁画场景读取失败'
    start.textContent = '场景暂不可用'; query<HTMLElement>('#load-status').textContent = '请重试，原绘本仍可使用。'
  }
}
void loadScene()

function projectLabels(travel: number) {
  if (!started || !viewNow || !cinema) return
  const chapter = timeline.chapters[currentChapter]!
  const anchors = renderedMode === 'spatial' ? cinema.anchors(travel) : {}
  const narrated = new Set(cueFocus(locateMoment(timeline, time).cue.id))
  for (const annotation of annotations) {
    const button = labelButtons.get(annotation.id)!
    let point: THREE.Vector3 | undefined
    if (renderedMode === 'mural') point = new THREE.Vector3((annotation.x - .5) * muralSize.width, (.5 - annotation.y) * muralSize.height, .02)
    else point = anchors[worldLabelIds[annotation.id] ?? spatialFocusIds[annotation.id] ?? annotation.id]
    const relevant = annotation.id === 'remembered-journey' || renderedMode === 'map' ? false : renderedMode === 'mural' ? (narrated.has(annotation.id) || (fullMural || chapter.mode === 'overview' ? overviewAnnotationIds.has(annotation.id) : chapter.annotationIds.includes(annotation.id))) : !!point && (narrated.has(annotation.id) || chapter.annotationIds.includes(annotation.id))
    if (!point || !relevant) { button.hidden = true; continue }
    const projected = point.clone().project(camera)
    const x = (projected.x + 1) / 2 * stageWidth, y = (1 - projected.y) / 2 * stageHeight
    button.hidden = projected.z > 1 || projected.z < -1 || x < 24 || x > stageWidth - 24 || y < 26 || y > stageHeight - (currentChapter === 0 ? 20 : 76)
    if (button.hidden) continue
    button.style.left = `${x}px`; button.style.top = `${y}px`
    button.classList.toggle('current', chapter.annotationIds.includes(annotation.id))
    button.classList.toggle('narrated', narrated.has(annotation.id))
    button.classList.toggle('flip', x > stageWidth * .67)
  }
}
function renderCharacterNames() {
  const overlay = query<HTMLElement>('#character-names')
  const names: { name: string; point: THREE.Vector3 }[] = []
  if (started && renderedMode === 'spatial' && cinema) names.push(...cinema.characterNames())
  if (started && renderedMode === 'mural' && currentChapter === 0) {
    for (const [id, name] of [['emperor', '汉武帝'], ['envoy-farewell', '张骞']] as const) {
      const anchor = annotations.find(item => item.id === id)!
      names.push({ name, point: new THREE.Vector3((anchor.x - .5) * muralSize.width, (.5 - anchor.y) * muralSize.height, .02) })
    }
  }
  while (overlay.children.length < names.length) {
    const label = document.createElement('span'); label.className = 'character-name'; overlay.append(label)
  }
  for (let i = 0; i < overlay.children.length; i++) {
    const label = overlay.children[i] as HTMLElement, entry = names[i]
    label.hidden = !entry
    if (!entry) continue
    const p = entry.point.clone().project(camera)
    const x = (p.x + 1) / 2 * stageWidth, y = (1 - p.y) / 2 * stageHeight - 22
    label.hidden = p.z < -1 || p.z > 1 || x < 42 || x > stageWidth - 42 || y < 55 || y > stageHeight - 35
    label.textContent = entry.name
    label.style.left = `${x}px`; label.style.top = `${y}px`
  }
}
function renderFocus(cueId: string, visible: boolean) {
  const overlay = query<HTMLElement>('#focus-highlights')
  const ids = visible ? cueFocus(cueId) : []
  const boxes: THREE.Box3[] = []
  if (renderedMode === 'mural') {
    for (const id of ids) {
      const annotation = annotations.find(item => item.id === id)
      if (!annotation) continue
      const regions = id === 'golden-figures' ? goldenFigureRegions : [{ x: annotation.x - .025, y: annotation.y - .05, width: .05, height: .10 }]
      for (const region of regions) boxes.push(new THREE.Box3(
        new THREE.Vector3((region.x - .5) * muralSize.width, (.5 - region.y - region.height) * muralSize.height, 0),
        new THREE.Vector3((region.x + region.width - .5) * muralSize.width, (.5 - region.y) * muralSize.height, .01),
      ))
    }
  } else if (renderedMode === 'spatial' && cinema) boxes.push(...cinema.focusBounds(visible && cueId === 'c4-0' ? ['market-people'] : [...new Set(ids.map(id => spatialFocusIds[id]).filter((id): id is string => !!id))]))
  while (overlay.children.length < boxes.length) { const region = document.createElement('div'); region.className = 'focus-region'; overlay.append(region) }
  for (let index = 0; index < overlay.children.length; index++) {
    const region = overlay.children[index] as HTMLElement, box = boxes[index]
    region.hidden = !box
    if (!box) continue
    const points = []
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera))
    if (points.some(p => p.z < -1 || p.z > 1)) { region.hidden = true; continue }
    const left = Math.max(0, Math.min(...points.map(p => (p.x + 1) / 2 * stageWidth)))
    const top = Math.max(0, Math.min(...points.map(p => (1 - p.y) / 2 * stageHeight)))
    const right = Math.min(stageWidth, Math.max(...points.map(p => (p.x + 1) / 2 * stageWidth)))
    const bottom = Math.min(stageHeight, Math.max(...points.map(p => (1 - p.y) / 2 * stageHeight)))
    region.hidden = right <= left || bottom <= top
    region.style.cssText = `left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px`
  }
}
renderer.setAnimationLoop(() => {
  if (document.hidden) { lastFrame = performance.now(); return }
  // Paused scenes still settle camera transitions, without redrawing heavy GLBs at 60fps.
  if (!playing && performance.now() - lastFrame < 100) return
  const now = performance.now(), elapsed = Math.max(0, (now - lastFrame) / 1000), dt = Math.min(elapsed, .1); lastFrame = now
  if (playing) {
    const moment = locateMoment(timeline, time)
    const cueClock = { id: moment.cue.id, audioStart: moment.chapter.start + moment.cue.audioStart, audioSeconds: moment.cue.audioSeconds, end: moment.chapter.start + moment.cue.end }
    time = advanceStoryClock(time, elapsed, speed, cueClock, { cueId: currentAudio, currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused, ended: audio.ended, ready: audio.readyState >= 2 }, voice && !!moment.cue.audioFile)
    updateMoment();startAudio()
  }
  viewElapsed = Math.min(2, viewElapsed + dt)
  if (viewFrom && viewTo) viewNow = interpolateMuralViews(viewFrom, viewTo, viewElapsed / 2)
  const currentMoment = locateMoment(timeline, time)
  if (started && !manualView) activeView = cueView(currentMoment.cue.id, currentMoment.cueLocalSeconds, !!currentMoment.cue.beat)
  const desiredMode: PresentationView = started ? activeView : 'mural'
  presentationState = advancePresentation(presentationState, presentationFrame(currentMoment, desiredMode), dt)
  const displayedFrame = presentationState.displayed
  renderedMode = displayedFrame.mode
  const spatial = renderedMode === 'spatial'
  query<HTMLElement>('#route-stage').hidden = renderedMode !== 'map'
  query<HTMLElement>('#transition').style.opacity = String(presentationState.opacity)
  query<HTMLElement>('#transition span').textContent = desiredMode === 'spatial' ? '走进这段经历' : desiredMode === 'map' ? '沿路线继续这段远行' : '看后人怎样画这段故事'
  if (mural) mural.visible = !spatial
  if (cinema) cinema.group.visible = spatial
  stage.classList.toggle('spatial', spatial)
  stage.dataset.chapter = String(Math.max(0, currentChapter))
  scene.background = new THREE.Color(spatial ? '#c9bba0' : '#b8a98c')
  scene.fog = spatial ? new THREE.Fog('#c9bba0', 28, 80) : null
  const moment=locateMoment(timeline,time)
  const spatialFrame=displayedFrame.spatial
  const travel=spatialFrame?.progress??0
  const spatialShot=spatialFrame ? cinema?.present(spatialFrame.beat.id,spatialFrame.progress,spatialFrame.ambientSeconds) : undefined
  if (spatial && cinema) {
    const shot=spatialShot!
    camera.fov = 48; camera.updateProjectionMatrix()
    camera.position.copy(shot.position); camera.lookAt(shot.target)
  } else if (viewNow) {
    const shot = toMuralCamera(viewNow, { muralWidth: muralSize.width, muralHeight: muralSize.height, fovDegrees: fov })
    camera.fov = fov; camera.updateProjectionMatrix()
    camera.position.set(shot.targetX, shot.targetY, shot.z); camera.lookAt(shot.targetX, shot.targetY, 0)
  }
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true)
  projectLabels(travel)
  renderCharacterNames()
  renderFocus(moment.cue.id, focusVisible(moment.cue.id, moment.cueLocalSeconds, moment.cue.visualSeconds))
  if (cinema && spatial) canvas.dataset.walking = JSON.stringify(cinema.motion())
  const beat=moment.cue.beat
  const displayBeat=spatialFrame ? getSceneBeat(spatialFrame.cueId) ?? spatialFrame.beat : undefined
  const narrationSeconds = subtitleMediaSeconds({ id: moment.cue.id, audioStart: moment.chapter.start + moment.cue.audioStart, audioSeconds: moment.cue.audioSeconds, end: moment.chapter.start + moment.cue.end }, time, { cueId: currentAudio, currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused, ended: audio.ended, ready: audio.readyState >= 2 }, voice)
  const text = !playing && narrationSeconds < 0 ? moment.cue.text : moment.cue.subtitlePoints ? timedSubtitleText(moment.cue.text, narrationSeconds, moment.cue.subtitlePoints, reducedMotion) : subtitleText(moment.cue.text, narrationSeconds, voice && moment.cue.audioSeconds > 0 ? moment.cue.audioSeconds : moment.cue.readingSeconds, reducedMotion)
  const narration = query<HTMLElement>('#narration')
  if (narration.textContent !== text) narration.textContent = text
  const english = englishSubtitles[moment.cue.id] ?? ''
  // Translation is a readable whole-sentence reference for this spoken cue.
  const englishText = !playing || narrationSeconds >= 0 ? english : ''
  query<HTMLElement>('#narration-en').textContent = englishText
  const route = routePosition(moment.chapterIndex, moment.cueIndex, cueRouteProgress(moment))
  query<HTMLElement>('#route-marker').style.left = `${route.x}%`
  query<HTMLElement>('#route-marker').style.top = `${route.y}%`
  query<HTMLElement>('#large-route-marker').style.left = `${route.x}%`
  query<HTMLElement>('#large-route-marker').style.top = `${route.y}%`
  query<HTMLElement>('#large-route-location').textContent = (route.label === '回看旅途' ? '' : route.label)
  query<HTMLElement>('#route-location').textContent = (route.label === '回看旅途' ? '' : route.label)
  query<HTMLElement>('#asset-credit').hidden = !spatial
  query<HTMLElement>('#asset-credit').textContent = displayBeat?.id === 'city' ? '人物、马、细竹杖杖身与城门：Tripo 3D生成 · 布景与动作：项目制作' : displayBeat?.id === 'tower' || displayBeat?.id === 'greeting' ? '人物、细竹杖杖身、城门、僧人与佛塔：Tripo 3D生成 · 布景与动作：项目制作' : ['market', 'goods'].includes(displayBeat?.id ?? '') ? '人物与细竹杖：Tripo 3D生成 · 布景与动作：项目制作' : ['detention', 'retained-credential', 'audience'].includes(displayBeat?.id ?? '') ? '人物与持节道具杖身：Tripo 3D生成 · 布景与动作：项目制作' : '人物、马与持节道具杖身：Tripo 3D生成 · 布景与动作：项目制作'
  const detentionPhase = query<HTMLElement>('#detention-phase')
  detentionPhase.hidden = !spatial || (displayBeat?.id !== 'detention' && displayBeat?.id !== 'retained-credential')
  detentionPhase.textContent = displayBeat?.id === 'retained-credential' ? '被扣留十余年 · 持汉节不失' : travel < .28 ? '① 西行途中，接近守卫' : travel < .60 ? '② 守卫拦截，使团停下；转身后再护送' : travel < .92 ? '③ 被带入营地，出入受限' : '④ 扣留十余年 · 过程示意'
  query<HTMLElement>('#scene-badge').textContent = spatial&&displayBeat ? `${displayBeat.sourceKind==='mural'?'壁画转译':displayBeat.sourceKind==='history'?'史书补充':'解读与推断'} · ${displayBeat.title}` : renderedMode === 'map' ? '行进路线 · 路线示意' : fullMural || !started || currentChapter === 0 || currentChapter === 7 ? '原壁画 · 全画标注' : '原壁画 · 局部观察'
  query<HTMLElement>('#caption').hidden=!started||query<HTMLElement>('#ending').hidden===false||(playing&&moment.phase==='visual')
  if(playing&&beat)note.textContent=moment.phase==='visual'?`先看：${beat.title}。镜头与动作完成后讲述这一句。`:'本段立体场景为展示示意；点击高亮标注可查看说明。'
  Object.assign(canvas.dataset,{beat:beat?.id??'',displayBeat:spatialFrame?.beat.id??'',transitionOpacity:presentationState.opacity.toFixed(3),phase:moment.phase,visualProgress:travel.toFixed(3),audioReady:String(moment.phase==='narration')})
  query<HTMLInputElement>('#story-progress').value = String(time)
  query<HTMLElement>('#clock').textContent = `${formatTime(time)} / ${formatTime(timeline.duration)}`
  Object.assign(canvas.dataset, { time: time.toFixed(2), chapter: String(Math.max(0, currentChapter)), cue: String(Math.max(0, currentCue)), audioCue: currentAudio, playing: String(playing), mode: renderedMode, travel: travel.toFixed(3), view: viewNow ? JSON.stringify({ x: viewNow.x, y: viewNow.y, width: viewNow.width, height: viewNow.height }) : '', speed: String(speed), mediaTime: audio.currentTime.toFixed(3), subtitleTime: narrationSeconds.toFixed(3), subtitleSource: moment.cue.subtitlePoints ? 'word-timestamps' : 'media-clock', mediaPaused: String(audio.paused), mediaEnded: String(audio.ended) })
  if (time >= timeline.duration && playing) {
    stop('完整讲述结束。可以回到原画，读标注或重新听某一段。')
    query<HTMLElement>('#ending').hidden = false; query<HTMLElement>('#caption').hidden = true
    canvas.dataset.complete = 'true'
  }
  if (started) query<HTMLElement>('#chapters').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false })
  renderer.render(scene, camera)
})
