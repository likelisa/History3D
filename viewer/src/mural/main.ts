import * as THREE from 'three'
import { createCinemaWorld, type CinemaWorld } from './cinema-world.ts'
import { chapters as chapterDefinitions, annotations, sources } from './story.ts'
import { fitMuralView, interpolateMuralViews, toMuralCamera, type MuralView } from './framing.ts'
import { buildPlaybackTimeline, locateMoment, type NarrationTrack } from './playback.ts'
import { sceneBeatProgress } from './scene-beats.ts'
import './style.css'

const muralSize = { width: 21.72, height: 18 }
const fov = 43
const app = document.querySelector<HTMLDivElement>('#app')!
const kindLabels = { mural: '画面解读', history: '史书记载', interpretation: '解读与推断' }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
app.innerHTML = `
  <header><a href="/yuezhi.html" class="brand">History<span>3D</span></a><div class="identity"><strong>张骞出使西域图</strong><span>莫高窟第323窟 · 初唐 · 图像来源：敦煌研究院</span></div><button id="source">壁画与史料</button></header>
  <main id="experience">
    <section id="presentation" aria-label="图像与当前讲述">
    <section id="stage" aria-label="壁画与立体场景">
      <canvas aria-label="沿壁画观察张骞故事"></canvas>
      <div id="scene-badge">原壁画 · 全画</div>
      <div id="view-controls"><button id="overview" disabled>定位全画</button><button id="view-toggle" disabled>查看对应3D场景</button></div>
      <div id="labels" aria-label="画中标注"></div>
      <div id="transition" aria-hidden="true"><span>从原画走进山道</span></div>
      <section id="intro"><p class="eyebrow">先看一幅画，再读一段历史</p><h1>一位使者，<br>两种历史记忆。</h1><p>沿画中标注，认识张骞为何出使、为何受阻，<br>再看初唐画家怎样把远行画成佛教故事。</p><button id="start" class="primary" disabled>正在准备原画与场景…</button><small id="load-status">读取立体资产与逐句旁白</small></section>
      <section id="annotation-detail" hidden aria-label="标注详情"><button id="annotation-close" aria-label="关闭标注">×</button><span id="annotation-kind"></span><h3 id="annotation-title"></h3><p id="annotation-text"></p><small>标注位置来自原画。点击「继续讲述」接着看。</small></section>
      <section id="ending" hidden><p class="eyebrow">回到原画</p><h2>一段远行，两种讲述。</h2><p>史书解释出使的目的与结果。<br>初唐壁画呈现后世的佛教记忆。</p><button id="replay" class="primary">重新讲述</button><button id="explore-end">留在画中回看标注</button></section>
      <div id="error" hidden role="alert"><p id="error-message"></p><button id="retry">重新加载</button><a href="/yuezhi.html">打开原绘本</a></div>
    </section>
    <section id="caption-row" aria-label="当前逐句讲述"><div id="caption" hidden><span id="cue-kind"></span><p id="narration"></p></div></section>
    </section>
    <section id="reading" aria-label="故事讲解">
      <div class="reading-top"><p class="eyebrow">读懂画中的远行</p><span id="chapter-number">序</span></div>
      <p id="place">从右上宫殿，到左上城门</p><h2 id="chapter-title">先找到画中的三组事件</h2>
      <p id="reading-intro">这幅画不是汉代现场记录。我们会一边看画，一边用《史记》解释出使的背景和结果。</p>
      <div id="cue-list" aria-label="本段逐句讲述"></div>
      <div id="chapter-annotations" aria-label="本段标注"></div>
      <div id="takeaway"><span>先记住这一点</span><p>画中的礼佛、辞行和僧塔，与史书中的外交任务，要放在不同的时代读。</p></div>
      <section id="orientation" aria-label="在原画中的位置"><div><strong>你正在看原画的这里</strong><span id="map-location">全画</span></div><div id="mini-map"><img src="/yuezhi/murals/full.jpg" alt="原壁画位置图"><div id="mini-focus"></div></div></section>
      <p id="status-note" role="status">自动讲述可暂停；点画中标注可仔细读。</p>
    </section>
  </main>
  <footer>
    <nav id="chapters" aria-label="沿壁画的八个讲述环节"></nav>
    <div class="transport"><button id="previous" disabled aria-label="上一段">← 上一段</button><button id="pause" disabled>开始后可暂停</button><button id="next" disabled aria-label="下一段">下一段 →</button><button id="voice" aria-pressed="true">旁白：开</button><label>讲述速度 <select id="speed" aria-label="讲述速度"><option value="0.8">更慢 0.8×</option><option value="1" selected>舒缓 1×</option><option value="1.15">稍快 1.15×</option></select></label><progress aria-label="故事进度" value="0" max="1"></progress><span id="clock">准备中</span></div>
  </footer>
  <section id="source-panel" hidden role="dialog" aria-modal="true" aria-labelledby="source-title"><button id="source-close" aria-label="关闭壁画与史料">×</button><p class="eyebrow">看画，也查证</p><h2 id="source-title">画面、史书和空间，各讲什么？</h2><p>初唐壁画有自己的佛教叙事。《史记》的外交经历帮助我们读懂背景，但不能把金人、僧人和佛塔当成首次出使的现场证据。</p><div id="source-links"></div><p>原画未改动。立体山道、人物面貌、尺度与背面是展示补全，不是考古复原。图像和生成资产的公开使用权利仍待负责人复核。</p></section>
  <audio id="narrator" preload="auto"></audio>`

const query = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!
const stage = query<HTMLElement>('#stage')
const canvas = query<HTMLCanvasElement>('canvas')
const audio = query<HTMLAudioElement>('#narrator')
const start = query<HTMLButtonElement>('#start')
const pause = query<HTMLButtonElement>('#pause')
const note = query<HTMLElement>('#status-note')
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
let activeView: 'mural' | 'spatial' = 'mural', manualView = false, fullMural = false
let stageWidth = 1, stageHeight = 1, viewFrom: MuralView | null = null, viewTo: MuralView | null = null, viewNow: MuralView | null = null
let viewElapsed = 2, switchElapsed = 2
let renderedMode: 'mural' | 'spatial' = 'mural', pendingMode: 'mural' | 'spatial' | null = null
let returnFocus: HTMLElement | null = null
const labelButtons = new Map<string, HTMLButtonElement>()
const worldLabelIds: Record<string, string> = { 'westward-party': 'party', credential: 'staff', 'daxia-city': 'gate', monks: 'monks', 'buddhist-tower': 'tower' }
const overviewAnnotationIds = new Set(['overview-palace', 'overview-farewell', 'overview-city', 'westward-party', 'credential'])

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
  pause.disabled = !started || time >= timeline.duration
  pause.textContent = playing ? '暂停讲述' : '继续讲述'
  pause.setAttribute('aria-pressed', String(!playing))
  query<HTMLButtonElement>('#previous').disabled = !started || currentChapter <= 0
  query<HTMLButtonElement>('#next').disabled = !started || currentChapter >= timeline.chapters.length - 1
  query<HTMLButtonElement>('#overview').disabled = !started
  query<HTMLButtonElement>('#view-toggle').disabled = !started || !locateMoment(timeline,time).cue.beat
  query<HTMLButtonElement>('#view-toggle').textContent = activeView === 'spatial' ? '对应原画' : '查看对应3D场景'
  query<HTMLButtonElement>('#voice').textContent = voice ? '旁白：开' : '旁白：关'
  query<HTMLButtonElement>('#voice').setAttribute('aria-pressed', String(voice))
  query<HTMLProgressElement>('progress').max = timeline.duration
}
function stop(message?: string) {
  playing = false; audio.pause(); updateControls()
  if (message) note.textContent = message
}
function startAudio(restart = false) {
  const moment = locateMoment(timeline, time)
  const cue = moment.cue
  if (!voice || !playing || !cue.audioFile) return
  const localTime = time - moment.chapter.start - cue.audioStart
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
  void audio.play().catch(error => {
    if (error?.name === 'AbortError') return
    voice = false; updateControls(); note.textContent = '旁白暂未播放，逐句文字仍会完整呈现；可点击旁白重新开启。'
  })
}
function resume() {
  if (!started || time >= timeline.duration) return
  query<HTMLElement>('#annotation-detail').hidden = true
  fullMural = false
  if (activeView === 'mural') setMuralTarget(focusView(currentChapter))
  playing = true; note.textContent = '正在舒缓讲述；可暂停阅读，也可点击画中标注。'
  updateControls(); startAudio()
}
function begin() {
  started = true; time = 0; currentChapter = -1; currentCue = -1; currentAudio = ''
  canvas.dataset.complete = 'false'
  playing = true; manualView = false; fullMural = false
  query<HTMLElement>('#intro').hidden = true
  query<HTMLElement>('#ending').hidden = true
  query<HTMLElement>('#caption').hidden = false
  query<HTMLElement>('#reading-intro').hidden = true
  query<HTMLElement>('#annotation-detail').hidden = true
  updateMoment(); setMuralTarget(overviewView(), true); updateControls(); startAudio()
}
function seekChapter(index: number) {
  if (!started) return
  const chapter = timeline.chapters[THREE.MathUtils.clamp(index, 0, timeline.chapters.length - 1)]!
  stop('已定位这一段，先读画中标注；点击「继续讲述」可从这里接着听。')
  time = chapter.start; currentAudio = ''; manualView = false; fullMural = false
  canvas.dataset.complete = 'false'
  query<HTMLElement>('#ending').hidden = true
  query<HTMLElement>('#caption').hidden = false
  query<HTMLElement>('#annotation-detail').hidden = true
  currentChapter = -1; currentCue = -1; updateMoment(); updateControls()
}
function seekCue(index: number) {
  if (!started) return
  const chapter = timeline.chapters[currentChapter]!
  stop('已回到这句话；点击「继续讲述」可重新听。')
  time = chapter.start + chapter.cues[index]!.start
  canvas.dataset.complete = 'false'
  query<HTMLElement>('#ending').hidden = true
  query<HTMLElement>('#caption').hidden = false
  query<HTMLElement>('#annotation-detail').hidden = true
  currentAudio = ''; currentCue = -1; updateMoment()
}
function renderChapter(index: number) {
  const chapter = timeline.chapters[index]!
  query<HTMLElement>('#chapter-number').textContent = `${String(index + 1).padStart(2, '0')} / 08`
  query<HTMLElement>('#place').textContent = chapter.location
  query<HTMLElement>('#chapter-title').textContent = chapter.title
  query<HTMLElement>('#takeaway p').textContent = chapter.takeaway
  query<HTMLElement>('#mini-focus').style.cssText = `left:${chapter.focus.x * 100}%;top:${chapter.focus.y * 100}%;width:${chapter.focus.width * 100}%;height:${chapter.focus.height * 100}%`
  query<HTMLElement>('#map-location').textContent = chapter.mode === 'overview' ? '完整壁画' : chapter.location.split(' · ')[0]!
  query<HTMLElement>('#cue-list').innerHTML = chapter.cues.map((cue, cueIndex) => `<button class="cue" data-cue="${cueIndex}" aria-label="回看第${cueIndex + 1}句"><span>${kindLabels[cue.sourceKind]}</span><p>${escape(cue.text)}</p></button>`).join('')
  query<HTMLElement>('#cue-list').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.onclick = () => seekCue(Number(button.dataset.cue)) })
  const chapterAnnotations = annotations.filter(annotation => annotation.chapterIndex === index)
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
    if (!manualView) activeView = moment.cue.beat ? 'spatial' : 'mural'
    query<HTMLElement>('#narration').textContent = moment.cue.text
    query<HTMLElement>('#cue-kind').textContent = kindLabels[moment.cue.sourceKind]
    query<HTMLElement>('#cue-list').querySelectorAll<HTMLButtonElement>('.cue').forEach((button, index) => {
      button.classList.toggle('active', index === currentCue)
      button.setAttribute('aria-current', index === currentCue ? 'true' : 'false')
      if (index === currentCue) button.scrollIntoView({ block: 'nearest' })
    })
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
query<HTMLButtonElement>('#voice').onclick = () => {
  voice = !voice; audio.pause(); currentAudio = ''; updateControls()
  if (voice && playing) startAudio(true)
}
query<HTMLSelectElement>('#speed').onchange = event => { speed = Number((event.target as HTMLSelectElement).value); audio.playbackRate = speed; note.textContent = `讲述速度已改为 ${speed}×，文字与旁白一起调整。` }
query<HTMLButtonElement>('#overview').onclick = () => {
  stop('全画中的数字与标签对应讲述环节；点原画位置图可以回到相应段落。')
  activeView = 'mural'; manualView = true; fullMural = true
  setMuralTarget(overviewView()); updateControls()
}
query<HTMLButtonElement>('#view-toggle').onclick = () => {
  stop('已切换对应视图；原画位置图一直保留，可对照人物和城门的位置。')
  activeView = activeView === 'mural' ? 'spatial' : 'mural'
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
addEventListener('pagehide', () => audio.pause())
document.addEventListener('visibilitychange', () => { if (document.hidden && started) stop('页面切到后台，故事已暂停；回来后可以继续。') })
audio.addEventListener('error', () => {
  if (!started) return
  voice = false; updateControls(); note.textContent = '这一句音频暂不可用，文字仍可完整阅读；旁白可重新开启。'
})

async function loadScene() {
  try {
    const [texture, world, narrationResponse] = await Promise.all([
      new THREE.TextureLoader().loadAsync('/yuezhi/murals/full.jpg'),
      createCinemaWorld(), fetch('/mural-assets/narration-v4/manifest.json'),
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
    canvas.dataset.audioTracks = String(narration.tracks.length)
    canvas.dataset.audioVerified = String(recordedUrls.size)
    canvas.dataset.audioVersion = narration.formatVersion
    canvas.dataset.audioVoice = narration.voice
    canvas.dataset.audioSynthesis = narration.synthesis
    buildNavigation(); start.disabled = false; start.textContent = '沿壁画开始讲述'
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
  const anchors = cinema.anchors(travel)
  for (const annotation of annotations) {
    const button = labelButtons.get(annotation.id)!
    let point: THREE.Vector3 | undefined
    if (renderedMode === 'mural') point = new THREE.Vector3((annotation.x - .5) * muralSize.width, (.5 - annotation.y) * muralSize.height, .02)
    else point = anchors[worldLabelIds[annotation.id] ?? annotation.id]
    const relevant = renderedMode === 'mural' ? (fullMural || chapter.mode === 'overview' ? overviewAnnotationIds.has(annotation.id) : chapter.annotationIds.includes(annotation.id)) : !!point && chapter.annotationIds.includes(annotation.id)
    if (!point || !relevant) { button.hidden = true; continue }
    const projected = point.clone().project(camera)
    const x = (projected.x + 1) / 2 * stageWidth, y = (1 - projected.y) / 2 * stageHeight
    button.hidden = projected.z > 1 || projected.z < -1 || x < 24 || x > stageWidth - 24 || y < 26 || y > stageHeight - (currentChapter === 2 ? 20 : 76)
    if (button.hidden) continue
    button.style.left = `${x}px`; button.style.top = `${y}px`
    button.classList.toggle('current', chapter.annotationIds.includes(annotation.id))
    button.classList.toggle('flip', x > stageWidth * .67)
  }
}
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min((now - lastFrame) / 1000, .1); lastFrame = now
  if (playing) {
    const moment = locateMoment(timeline, time)
    const boundary = moment.chapter.start + moment.cue.end
    let proposed = Math.min(timeline.duration, time + dt * speed)
    // Never cut off a real spoken sentence just to satisfy a fixed chapter clock.
    if (voice && currentAudio === moment.cue.id && !audio.ended && !audio.paused && proposed >= boundary) proposed = Math.max(time, boundary - .005)
    time = proposed; updateMoment();startAudio()
  }
  viewElapsed = Math.min(2, viewElapsed + dt)
  if (viewFrom && viewTo) viewNow = interpolateMuralViews(viewFrom, viewTo, viewElapsed / 2)
  const desiredMode = started && activeView === 'spatial' ? 'spatial' : 'mural'
  if (desiredMode !== renderedMode && pendingMode !== desiredMode) { pendingMode = desiredMode; switchElapsed = 0 }
  if (pendingMode && desiredMode === renderedMode) pendingMode = null
  switchElapsed = Math.min(1.1, switchElapsed + dt)
  if (pendingMode && switchElapsed >= .55) { renderedMode = pendingMode; pendingMode = null }
  const spatial = renderedMode === 'spatial'
  const mode = spatial ? 'spatial' : 'mural'
  query<HTMLElement>('#transition').style.opacity = String(switchElapsed < 1.1 ? Math.sin(switchElapsed / 1.1 * Math.PI) : 0)
  query<HTMLElement>('#transition span').textContent = desiredMode === 'spatial' ? '进入这一句对应的立体场景' : '回到原画，对照这一处'
  if (mural) mural.visible = !spatial
  if (cinema) cinema.group.visible = spatial
  stage.classList.toggle('spatial', spatial)
  stage.dataset.chapter = String(Math.max(0, currentChapter))
  scene.background = new THREE.Color(spatial ? '#c9bba0' : '#b8a98c')
  scene.fog = spatial ? new THREE.Fog('#c9bba0', 28, 80) : null
  const moment=locateMoment(timeline,time)
  const travel=moment.cue.beat?sceneBeatProgress(moment.cueLocalSeconds,moment.cue.beat):0
  const spatialShot=cinema?.present(moment.cue.beat?.id??'mountain',travel)
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
  if (cinema) canvas.dataset.walking = JSON.stringify(cinema.motion())
  const beat=moment.cue.beat
  query<HTMLElement>('#scene-badge').textContent = spatial&&beat ? `${beat.sourceKind==='mural'?'壁画转译':beat.sourceKind==='history'?'史书补充':'解读与推断'} · ${beat.title}` : fullMural || !started || currentChapter === 0 || currentChapter === 7 ? '原壁画 · 全画标注' : '原壁画 · 局部观察'
  query<HTMLElement>('#caption').hidden=!started||query<HTMLElement>('#ending').hidden===false||(playing&&moment.phase==='visual')
  if(playing&&beat)note.textContent=moment.phase==='visual'?`先看：${beat.title}。镜头与动作完成后讲述这一句。`:beat.boundaryNote
  Object.assign(canvas.dataset,{beat:beat?.id??'',phase:moment.phase,visualProgress:travel.toFixed(3),audioReady:String(moment.phase==='narration')})
  query<HTMLProgressElement>('progress').value = time
  query<HTMLElement>('#clock').textContent = `${formatTime(time)} / ${formatTime(timeline.duration)}`
  Object.assign(canvas.dataset, { time: time.toFixed(2), chapter: String(Math.max(0, currentChapter)), cue: String(Math.max(0, currentCue)), audioCue: currentAudio, playing: String(playing), mode, travel: travel.toFixed(3), view: viewNow ? JSON.stringify({ x: viewNow.x, y: viewNow.y, width: viewNow.width, height: viewNow.height }) : '', speed: String(speed) })
  if (time >= timeline.duration && playing) {
    stop('完整讲述结束。可以回到原画，读标注或重新听某一段。')
    query<HTMLElement>('#ending').hidden = false; query<HTMLElement>('#caption').hidden = true
    canvas.dataset.complete = 'true'
  }
  if (started) query<HTMLElement>('#chapters').querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false })
  renderer.render(scene, camera)
})
