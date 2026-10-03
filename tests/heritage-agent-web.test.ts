import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext, Script } from 'node:vm'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createHash, webcrypto } from 'node:crypto'

class Element {
  id = ''; className = ''; textContent = ''; value = ''; hidden = false; disabled = false; checked = false
  type = ''; src = ''; currentSrc = ''; alt = ''; open = false; complete = true; naturalWidth = 1000; naturalHeight = 500
  currentTime = 0; duration = NaN; readyState = 0; paused = true; ended = false; playbackRate = 1
  playCalls = 0; pauseCalls = 0; loadCalls = 0; onloadedmetadata: null | (() => unknown) = null; onended: null | (() => unknown) = null; onerror: null | (() => unknown) = null
  playResult: null | (() => Promise<void>) = null
  dataset: Record<string, string> = {}; style: Record<string, string> = {}; children: Element[] = []
  attributes: Record<string, string> = {}; listeners = new Map<string, ((event: any) => unknown)[]>()
  rectangle = { left: 0, top: 0, width: 300, height: 150 }
  constructor(public tagName: string) {}
  append(...children: Element[]) { for (const child of children) this.children.push(...(child.tagName === '#fragment' ? child.children : [child])) }
  replaceChildren(...children: Element[]) { this.children = []; this.append(...children) }
  setAttribute(key: string, value: string) { this.attributes[key] = value }
  removeAttribute(key: string) { delete this.attributes[key] }
  addEventListener(type: string, callback: (event: any) => unknown) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]) }
  async dispatch(type: string, detail: Record<string, unknown> = {}) { if (type === 'ended') this.ended = true; for (const callback of this.listeners.get(type) || []) await callback({ preventDefault() {}, ...detail }); const callback = (this as any)[`on${type}`]; if (typeof callback === 'function') await callback() }
  pause() { this.pauseCalls++; this.paused = true }
  play() { this.playCalls++; this.paused = false; return this.playResult ? this.playResult() : Promise.resolve() }
  load() { this.loadCalls++; this.currentSrc = this.src; this.currentTime = 0; this.paused = true; this.readyState = 0; this.ended = false }
  reportValidity() { return true }
  getBoundingClientRect() { return this.rectangle }
  showModal() { this.open = true }
  close() { this.open = false }
  setPointerCapture() {}
  querySelectorAll(selector: string): Element[] {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
    return selector === '[data-field]' ? descendants.filter(child => child.dataset.field) : descendants
  }
  get classList() {
    const self = this
    return { add(value: string) { self.className += ` ${value}` }, toggle(value: string, enabled: boolean) { const classes = new Set(self.className.split(' ').filter(Boolean)); enabled ? classes.add(value) : classes.delete(value); self.className = [...classes].join(' ') } }
  }
}

async function harness(file: 'app' | 'viewer', fetchImpl?: (url: string, options: any) => Promise<any>, globals: Record<string, unknown> = {}) {
  const html = await readFile(new URL(`../agent/web/${file === 'app' ? 'index' : 'viewer'}.html`, import.meta.url), 'utf8')
  const elements = new Map<string, Element>(), created: Element[] = []
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1]); element.id = match[2]; element.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || ''
    element.hidden = /\bhidden\b/.test(match[0]); elements.set(element.id, element)
  }
  elements.get('subject-type') && (elements.get('subject-type')!.value = 'mural')
  const document = {
    title: '', hidden: false, getElementById: (id: string) => elements.get(id) || null,
    createElement: (tag: string) => { const element = new Element(tag); created.push(element); return element },
    createDocumentFragment: () => new Element('#fragment'),
    querySelectorAll: (selector: string) => selector === '.viewer-story .cue-card' ? created.filter(item => item.className.split(' ').includes('cue-card')) : [],
    addEventListener() {},
  }
  const context = createContext({ document, THREE, window: { addEventListener() {} }, location: new URL('http://127.0.0.1:5261/runs/run-one/viewer.html'),
    URL, AbortController, TextDecoder, DataView, Uint8Array, Blob, crypto: webcrypto, performance: { now: () => 1000 }, console,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ ok: true }) })),
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {}, ResizeObserver: class { observe() {} },
    ...globals,
  })
  let source = await readFile(new URL(`../agent/web/${file}.js`, import.meta.url), 'utf8')
  if (file === 'viewer') source = source.replace(/^import .*;\n/gm, '').replace(/^start\(\)\.catch.*$/m, '')
  new Script(source).runInContext(context)
  return { elements, context, eval: (code: string) => runInContext(code, context), get: (id: string) => { const item = elements.get(id); if (!item) throw new Error(`Missing HTML element: ${id}`); return item } }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function texturedGlbFixture() {
  const positions = Buffer.alloc(36)
  ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZcAAAAASUVORK5CYII=', 'base64')
  const binary = Buffer.concat([positions, png, Buffer.alloc((4 - png.length % 4) % 4)])
  const content = { asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: png.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }
  const json = Buffer.from(JSON.stringify(content)), paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8), bytes = 20 + paddedJson.length + 8 + binary.length
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(bytes, 8)
  header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4)
  const buffer = Buffer.concat([header, paddedJson, binaryHeader, binary])
  const item = { id: 'small-object', url: './assets/small-object.glb', bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }
  return { buffer, item }
}
function narrationFixture() {
  const buffer = Buffer.alloc(44 + 2 * 8000 * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const cues = [{ id: 'cue-one', text: '甲🪞乙丁', kind: 'illustrative', sourceIds: [], evidence: [], imageRelation: 'context-only' }, { id: 'cue-two', text: '器物用途', kind: 'illustrative', sourceIds: [], evidence: [], imageRelation: 'not-depicted' }]
  const narration = { formatVersion: '1.0.0', voiceId: 'history3d-public-uncle-fu-r13', referenceSha256: 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37', sourceCommit: 'd7c2210da8c013e81a94bfc7b811a477c99fd506', complete: true, humanAudioReviewed: false,
    tracks: cues.map(cue => ({ id: cue.id, text: cue.text, file: `narration/${cue.id}.wav`, sha256, bytes: buffer.length, seconds: 2, subtitleAudioSha256: sha256, subtitlePoints: [{ seconds: .2, textEnd: 2 }, { seconds: 1.8, textEnd: Array.from(cue.text).length }] })), }
  const story = { subjectType: 'artifact', sources: [], chapters: [{ id: 'chapter-one', title: '器物故事', cues }], narration }
  return { buffer, story, narration }
}
async function audioHarness() {
  const fixture = narrationFixture(), calls: string[] = []
  const viewer = await harness('viewer', async url => {
    calls.push(String(url)); return { ok: true, arrayBuffer: async () => fixture.buffer.buffer.slice(fixture.buffer.byteOffset, fixture.buffer.byteOffset + fixture.buffer.byteLength) }
  })
  viewer.eval(`runtime.story=${JSON.stringify(fixture.story)};runtime.sceneData={scenes:[],assets:[],animation:{complete:false}};`)
  await viewer.eval('loadNarration()'); viewer.eval('buildTimeline();showMoment(0,true)')
  const audio = viewer.get('narration-audio')
  async function ready() { audio.duration = 2; audio.readyState = 1; await audio.dispatch('loadedmetadata'); await flush() }
  return { ...viewer, fixture, calls, audio, ready }
}

describe('heritage agent web behavior without paid services', () => {
  it('generates a separate quality candidate without a fee confirmation, defaults to no credit stop, and keeps unknown submissions blocked', async () => {
    const calls: { url: string; body: any }[] = []
    const run: any = { id: 'run-test', subjectType: 'artifact', status: 'preview_ready', credentialsReady: true, planSha256: 'b'.repeat(64), budget: { maxAssets: 1, maxCredits: 60 }, creditsReservedOrConsumed: 60, sources: [], events: [], errors: [], assets: [], assetCandidates: [], plan: { title: '器物', summary: '故事', chapters: [], assets: [{ id: 'object', label: '主资产', kind: 'prop', heightM: .35, prompt: 'Artifact display', sourceIds: [], generationMode: 'image-to-model' }], scenes: [] } }
    const app = await harness('app', async (url, options) => {
      if (options.body) { const body = JSON.parse(options.body); calls.push({ url, body }); if (url.endsWith('/budget')) run.budget = body; else if (url.endsWith('/asset-candidates')) run.assetCandidates = [{ ...body, id: 'candidate-one', status: 'task_known', active: true }]; }
      return { ok: true, json: async () => url === '/api/health' ? { ok: true } : run }
    })
    app.eval(`render(${JSON.stringify(run)})`)
    expect(app.get('candidate-panel').hidden).toBe(false); expect(app.get('candidate-input-note').textContent).toContain('不会读取文字描述')
    app.get('candidate-reason').value = '腿部与支撑轮廓不清楚'
    await app.get('candidate-generate').dispatch('click'); await flush()
    expect(calls[0]).toEqual({ url: '/api/runs/run-test/budget', body: { maxAssets: 1, maxCredits: Number.MAX_SAFE_INTEGER } })
    expect(calls[1].url).toBe('/api/runs/run-test/asset-candidates')
    expect(calls[1].body).toMatchObject({ assetId: 'object', reason: '腿部与支撑轮廓不清楚', faceLimit: 100000, prompt: 'Artifact display', planSha256: 'b'.repeat(64) })
    expect(calls[1].body.operationId).toMatch(/^[a-f0-9-]{36}$/)
    expect(app.get('candidate-generate').disabled).toBe(true)
    app.eval(`render(${JSON.stringify({ ...run, assetCandidates: [{ ...run.assetCandidates[0], status: 'unknown' }] })})`)
    expect(app.get('candidate-generate').disabled).toBe(true)
    expect(app.get('preview-panel').hidden).toBe(false)
  })

  it('ignores an older status response after a newer refresh so generation progress cannot move backwards', async () => {
    const pending: ((response: any) => void)[] = []
    const app = await harness('app', async url => url === '/api/health' ? { ok: true, json: async () => ({ ok: true }) } : new Promise(resolve => pending.push(resolve)))
    app.eval("state.run={id:'run-test',status:'recoverable'}")
    const old = app.eval('refresh()'), fresh = app.eval('refresh()')
    pending[1]({ ok: true, json: async () => ({ id: 'run-test', status: 'generating', events: [], errors: [], assets: [] }) }); await fresh
    pending[0]({ ok: true, json: async () => ({ id: 'run-test', status: 'recoverable', events: [], errors: [], assets: [] }) }); await old
    expect(app.eval('state.run.status')).toBe('generating'); expect(app.get('run-status').textContent).toBe('Tripo 生成中')
  })
  it('submits only the bound single repair and hides it for unknown or exhausted attempts', async () => {
    const calls: { url: string; body: any }[] = []
    const run = { id: 'run-test', subjectType: 'artifact', status: 'failed', events: [], errors: [], assets: [], planRepair: { eligible: true, candidateSha256: 'a'.repeat(64), attempts: 0, maxAttempts: 1, diagnostics: [{ code: 'EVIDENCE_QUOTE_NOT_IN_PROVIDED_EXCERPT', cueId: 'cue-6', sourceId: 'source-one' }] } }
    const app = await harness('app', async (url, options) => { if (options.body) calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => url === '/api/health' ? { ok: true } : { ...run, status: 'planning', planRepair: { ...run.planRepair, eligible: false, attempts: 1 } } } })
    app.eval(`render(${JSON.stringify(run)})`)
    expect(app.get('repair-panel').hidden).toBe(false); expect(app.get('repair-button').disabled).toBe(false)
    expect(app.get('repair-diagnostics').children[0].textContent).toContain('cue-6')
    app.get('repair-feedback').value = '引文逐字复制，故事自然。'; app.get('approve-checkbox').checked = true
    await app.get('repair-button').dispatch('click'); await flush()
    expect(calls).toEqual([{ url: '/api/runs/run-test/repair-plan', body: { candidateSha256: 'a'.repeat(64), feedback: '引文逐字复制，故事自然。' } }])
    expect(app.get('approve-checkbox').checked).toBe(false)
    for (const status of ['unknown', 'failed']) {
      app.eval(`render(${JSON.stringify({ ...run, status, planRepair: { ...run.planRepair, eligible: false, attempts: 1 } })})`)
      expect(app.get('repair-button').hidden).toBe(true); expect(app.get('repair-button').disabled).toBe(true)
    }
  })
  it('explains the fixed public voice without a readiness claim or an additional voice API field', async () => {
    const html = await readFile(new URL('../agent/web/index.html', import.meta.url), 'utf8')
    const note = html.match(/<div id="fixed-voice-note"[^>]*>([\s\S]*?)<\/div>/)?.[1] || ''
    expect(note).toContain('固定公开男声'); expect(note).toContain('无需额外填写声音 API'); expect(note).toContain('独立的公开音色环境')
    expect(note).toContain('以项目生成结果为准'); expect(note).toContain('尚未配置音轨'); expect(note).not.toContain('已就绪')
    expect(html).toContain('场景、旁白、原图与字幕'); expect(html).not.toMatch(/<input[^>]+id="(?:voice|tts)[^"]*key"/)
  })
  it('switches modes without clearing author inputs and preserves edited budgets', async () => {
    const app = await harness('app')
    app.get('topic').value = '已有讲解主题'; app.get('subject-name').value = '已有器物名'
    app.eval("state.imageDataUrl = 'data:image/png;base64,ORIGINAL';")
    app.get('subject-type').value = 'artifact'; await app.get('subject-type').dispatch('change')
    expect(app.get('image-label').textContent).toBe('文物图片'); expect(app.get('subject-metadata').hidden).toBe(false)
    expect(app.get('max-assets').value).toBe('1'); expect(app.get('max-credits').value).toBe('60')
    app.get('max-credits').value = '200'; await app.get('max-credits').dispatch('input')
    app.get('subject-type').value = 'mural'; await app.get('subject-type').dispatch('change')
    expect(app.get('subject-metadata').hidden).toBe(true); expect(app.get('max-credits').value).toBe('200')
    expect(app.get('topic').value).toBe('已有讲解主题'); expect(app.get('subject-name').value).toBe('已有器物名')
    expect(app.eval('state.imageDataUrl')).toBe('data:image/png;base64,ORIGINAL')
  })

  it('submits artifact metadata and unchanged original image, uses server estimated credits, and does not call a provider', async () => {
    const requests: { url: string; body?: any }[] = []
    const app = await harness('app', async (url, options) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : undefined })
      return { ok: true, json: async () => url === '/api/health' ? { ok: true } : { id: 'run-one', status: 'planning', subjectType: 'artifact', sources: [], events: [], errors: [], quality: {} } }
    })
    app.get('subject-type').value = 'artifact'; await app.get('subject-type').dispatch('change')
    app.get('subject-name').value = '  铜镜  '; app.get('subject-material').value = '青铜'; app.get('topic').value = '说明铜镜的用途与纹饰'
    app.get('model-base').value = 'https://model.example.invalid/v1'; app.get('model-name').value = 'fixture-model'
    app.get('model-key').value = 'fixture-only-model-key'; app.get('tripo-key').value = 'fixture-only-tripo-key'
    app.eval("state.imageDataUrl = 'data:image/png;base64,ORIGINAL';")
    await app.get('project-form').dispatch('submit'); await flush()
    const input = requests.find(request => request.url === '/api/runs')!.body
    expect(input.subjectType).toBe('artifact'); expect(input.subjectMetadata).toEqual({ name: '铜镜', material: '青铜' })
    expect(input.imageDataUrl).toBe('data:image/png;base64,ORIGINAL'); expect(input.budget).toEqual({ maxAssets: 1, maxCredits: Number.MAX_SAFE_INTEGER }); expect(input.autoGenerate).toBe(true)
    expect(requests.every(request => request.url.startsWith('/api/'))).toBe(true)
    app.eval("render({id:'run-one',status:'story_review',subjectType:'artifact',estimatedCredits:110,primaryAssetId:'mirror',planSha256:'sha',sources:[],events:[],errors:[],quality:{},plan:{title:'铜镜',summary:'故事',chapters:[],assets:[{id:'mirror',label:'铜镜',kind:'prop',heightM:0.1,sourceIds:[],generationMode:'image-to-model'},{id:'actor',label:'工匠',kind:'human',heightM:1.7,sourceIds:[]}],scenes:[]}})")
    expect(app.get('approval-cost').textContent).toContain('110 credits')
    expect(app.get('approval-cost').textContent).not.toContain('100 credits')
  })

  it('omits retained artifact-only metadata on mural submission and restores artifact identity', async () => {
    let input: any
    const app = await harness('app', async (url, options) => { if (url === '/api/runs') input = JSON.parse(options.body); return { ok: true, json: async () => url === '/api/health' ? { ok: true } : { id: 'run-one', status: 'planning', events: [], errors: [] } } })
    app.get('subject-name').value = '保留但不提交'; app.eval("state.imageDataUrl='data:image/png;base64,ORIGINAL';")
    await app.get('project-form').dispatch('submit'); await flush()
    expect(input.subjectType).toBe('mural'); expect(input.subjectMetadata).toBeUndefined()
    app.eval("restoreSubject({subjectType:'artifact',subjectMetadata:{name:'铜镜',period:'汉代'}})")
    expect(app.get('subject-type').value).toBe('artifact'); expect(app.get('subject-name').value).toBe('铜镜'); expect(app.get('subject-period').value).toBe('汉代')
  })

  it('places current detail on the actual image rectangle, supports legacy mural anchors, and hides invalid or unseen points', async () => {
    const viewer = await harness('viewer')
    viewer.get('mural-image-wrap').rectangle = { left: 20, top: 30, width: 320, height: 300 }
    viewer.get('mural-image').rectangle = { left: 30, top: 105, width: 300, height: 150 }
    viewer.eval("runtime.story={subjectType:'artifact'}; runtime.cues=[{cue:{text:'纹饰细节',imageRelation:'depicted',imageAnchor:{x:.25,y:.5,label:'中心纹饰'}}}];runtime.current=0;renderImage(runtime.cues[0].cue)")
    expect(viewer.get('mural-anchor').hidden).toBe(false)
    expect(viewer.get('mural-anchor').style).toMatchObject({ left: '85px', top: '150px' })
    expect(viewer.get('mural-caption').textContent).toContain('中心纹饰'); expect(viewer.get('mural-caption').textContent).toContain('仍需人工核实')
    viewer.eval("runtime.cues[0].cue={imageRelation:'depicted',muralAnchor:{x:1,y:0}};updateAnchor()")
    expect(viewer.get('mural-anchor').style).toMatchObject({ left: '310px', top: '75px' })
    for (const cue of ["{imageRelation:'depicted',imageAnchor:{x:2,y:.5}}", "{imageRelation:'not-depicted',imageAnchor:{x:.5,y:.5}}", "{imageRelation:'depicted',imageAnchor:{x:NaN,y:.5}}", "{imageRelation:'context-only',muralAnchor:{x:.5,y:.5}}", "{imageRelation:'depicted'}"]) {
      viewer.eval(`runtime.cues[0].cue=${cue};updateAnchor()`); expect(viewer.get('mural-anchor').hidden).toBe(true)
    }
  })

  it('opens the unchanged original in a dialog and synchronizes the current cue marker and caption', async () => {
    const viewer = await harness('viewer'); viewer.get('mural-image').src = 'http://127.0.0.1:5261/runs/run-one/image.png'
    viewer.eval("runtime.story={subjectType:'artifact'};runtime.cues=[{cue:{text:'观察口沿',imageRelation:'depicted',imageAnchor:{x:.3,y:.2}}},{cue:{text:'背面尚无原图证据',imageRelation:'not-depicted'}}];runtime.current=0;renderImage(runtime.cues[0].cue);setupImageInspection()")
    await viewer.get('inspect-image').dispatch('click')
    expect(viewer.get('image-dialog').open).toBe(true); expect(viewer.get('image-detail').src).toBe(viewer.get('mural-image').src)
    expect(viewer.get('image-detail-anchor').hidden).toBe(false); expect(viewer.get('image-detail-caption').textContent).toContain('观察口沿')
    viewer.eval('runtime.current=1;renderImage(runtime.cues[1].cue)')
    expect(viewer.get('image-detail-anchor').hidden).toBe(true); expect(viewer.get('image-detail-caption').textContent).toContain('背面尚无原图证据')
    expect(viewer.get('image-detail').src).toBe(viewer.get('mural-image').src)
    await viewer.get('close-image').dispatch('click'); expect(viewer.get('image-dialog').open).toBe(false)
  })

  it('frames a real 5 cm geometry at its center and permits close zoom without a 40 cm floor', async () => {
    const viewer = await harness('viewer')
    viewer.eval("runtime.story={subjectType:'artifact',primaryAssetId:'small-object'};runtime.sceneData={scenes:[{id:'scene-one',camera:[0,.08,.2]}]};runtime.sceneId='scene-one';runtime.actors=new THREE.Group();const smallObject=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.05),new THREE.MeshBasicMaterial());smallObject.position.y=.025;smallObject.userData.assetId='small-object';runtime.actors.add(smallObject);runtime.actors.updateMatrixWorld(true);runtime.camera=new THREE.PerspectiveCamera(45,1,.001,400);resetCamera();focusPrimaryAsset();setupCameraControls()")
    expect(viewer.eval('runtime.orbit.target.y')).toBeCloseTo(.025)
    expect(viewer.eval('runtime.orbit.radius')).toBeLessThan(.2)
    await viewer.get('scene-canvas').dispatch('wheel', { deltaY: -1000 })
    expect(viewer.eval('runtime.orbit.radius')).toBeLessThan(.1)
    expect(viewer.eval('runtime.orbit.radius >= runtime.orbit.minRadius')).toBe(true)
  })

  it('fits an artifact in a narrow desktop viewport and keeps upper and lower scene framing distinct', async () => {
    const viewer = await harness('viewer')
    viewer.eval("runtime.story={subjectType:'artifact',primaryAssetId:'object'};runtime.sceneData={scenes:[{id:'whole',camera:[1,.6,2],placements:[{assetId:'object'}]},{id:'upper',camera:[1,.6,2],cameraFraming:{region:'upper',magnification:1.8}},{id:'lower',camera:[1,.15,2],cameraFraming:{region:'lower',magnification:2}}]};runtime.sceneId='whole';runtime.actors=new THREE.Group();const obj=new THREE.Mesh(new THREE.BoxGeometry(.45,.35,.12),new THREE.MeshBasicMaterial());obj.position.y=.175;obj.userData.assetId='object';runtime.actors.add(obj);runtime.actors.updateMatrixWorld(true);runtime.camera=new THREE.PerspectiveCamera(45,.65,.001,400);resetCamera();runtime.camera.updateMatrixWorld(true)")
    const whole = viewer.eval('runtime.orbit.radius')
    expect(viewer.eval('new THREE.Vector3(.225,.35,.06).project(runtime.camera).x')).toBeLessThan(1)
    expect(viewer.eval('new THREE.Vector3(-.225,0,-.06).project(runtime.camera).x')).toBeGreaterThan(-1)
    viewer.eval("runtime.sceneId='upper';resetCamera()")
    expect(viewer.eval('runtime.orbit.target.y')).toBeGreaterThan(.25)
    expect(viewer.eval('runtime.orbit.radius')).toBeLessThan(whole)
    viewer.eval("runtime.sceneId='lower';resetCamera()")
    expect(viewer.eval('runtime.orbit.target.y')).toBeLessThan(.1)
    viewer.eval('focusPrimaryAsset()')
    expect(viewer.eval('runtime.orbit.target.y')).toBeCloseTo(.175)
  })

  it('uses the real GLTF parser and blocks swallowed embedded texture failures instead of accepting a textureless preview', async () => {
    const fixture = texturedGlbFixture(), errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('self', { URL })
    try {
      for (const textureFails of [false, true]) {
        const imageRequests: string[] = []
        class FixtureLoader extends GLTFLoader {
          constructor(manager: THREE.LoadingManager) {
            super(manager)
            this.register(parser => {
              // Only the image decoder boundary is injected; GLB parsing,
              // texture error swallowing and LoadingManager are real Three code.
              ;(parser as any).textureLoader = { load(url: string, onLoad: (value: THREE.Texture) => void, _progress: unknown, onError: (error: Error) => void) {
                imageRequests.push(url); manager.itemStart(url)
                if (textureFails) { manager.itemError(url); onError(new Error('Fixture embedded-image decode rejected')) }
                else onLoad(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1))
                manager.itemEnd(url)
              } }
              return { name: 'fixture-image-decoder' }
            })
          }
        }
        const viewer = await harness('viewer', async () => ({ ok: true, arrayBuffer: async () => fixture.buffer.buffer.slice(fixture.buffer.byteOffset, fixture.buffer.byteOffset + fixture.buffer.byteLength) }), { GLTFLoader: FixtureLoader })
        const result = await viewer.eval(`loadAsset(${JSON.stringify(fixture.item)}).catch(error => fail(error.message))`)
        expect(imageRequests).toHaveLength(1); expect(imageRequests[0]).toMatch(/^blob:/)
        if (textureFails) {
          expect(result).toBeUndefined(); expect(viewer.get('play-button').disabled).toBe(true)
          expect(viewer.get('viewer-error').textContent).toContain('内嵌纹理未能载入')
        } else {
          expect(result.height).toBeCloseTo(1)
          const mesh = result.scene.children[0] as THREE.Mesh
          expect((mesh.material as THREE.MeshStandardMaterial).map?.isTexture).toBe(true)
        }
      }
    } finally { errors.mockRestore(); vi.unstubAllGlobals() }
  })
})

describe('fixed public narration in the real generic viewer script', () => {
  // These tests run the actual script against fake media events. They verify
  // scheduling and integrity boundaries, not audible quality or browser decoding.
  it('fetches and hashes actual PCM WAV bytes before assigning any audio source and uses verified Unicode subtitle points', async () => {
    const viewer = await audioHarness()
    expect(viewer.calls).toEqual(['http://127.0.0.1:5261/runs/run-one/narration/cue-one.wav', 'http://127.0.0.1:5261/runs/run-one/narration/cue-two.wav'])
    expect(viewer.eval('runtime.narrationReady')).toBe(true); expect(viewer.audio.src).toMatch(/^blob:/)
    expect(viewer.eval("timedSubtitleText('甲🪞乙丁',.1,runtime.tracks.get('cue-one').subtitlePoints)")).toBe('')
    expect(viewer.eval("timedSubtitleText('甲🪞乙丁',.8,runtime.tracks.get('cue-one').subtitlePoints)")).toBe('甲🪞')
    expect(viewer.eval("timedSubtitleText('甲🪞乙丁',1.8,runtime.tracks.get('cue-one').subtitlePoints)")).toBe('甲🪞乙丁')
  })

  it('blocks a declared complete manifest with a wrong voice, mismatched subtitle SHA, incomplete code points, changed bytes or wrong WAV duration', async () => {
    for (const mutate of [
      (story: any) => { story.narration.voiceId = 'private-voice' },
      (story: any) => { story.narration.tracks[0].subtitleAudioSha256 = 'f'.repeat(64) },
      (story: any) => { story.narration.tracks[0].subtitlePoints[1].textEnd = 3 },
      (story: any) => { story.narration.tracks[0].text = '已更改正文' },
      (story: any) => { story.narration.tracks[0].file = '../private.wav' },
      (story: any) => { story.narration.tracks[0].bytes += 1 },
      (story: any) => { story.narration.tracks[0].sha256 = 'a'.repeat(64); story.narration.tracks[0].subtitleAudioSha256 = 'a'.repeat(64) },
      (story: any) => { story.narration.tracks[0].seconds = 3 },
    ]) {
      const fixture = narrationFixture(); mutate(fixture.story)
      const viewer = await harness('viewer', async () => ({ ok: true, arrayBuffer: async () => fixture.buffer.buffer.slice(fixture.buffer.byteOffset, fixture.buffer.byteOffset + fixture.buffer.byteLength) }))
      viewer.eval(`runtime.story=${JSON.stringify(fixture.story)};renderStory()`)
      await viewer.eval('loadNarration().catch(error => fail(error.message))')
      expect(viewer.eval('runtime.narrationReady')).toBe(false); expect(viewer.get('narration-audio').src).toBe('')
      expect(viewer.get('viewer-error').hidden).toBe(false); expect(viewer.get('play-button').disabled).toBe(true)
      expect(viewer.get('full-story').children.length).toBe(1)
    }
  })

  it('starts speech immediately and continues only after actual media ended, without observation or reading delays', async () => {
    const viewer = await audioHarness(); await viewer.ready()
    expect(viewer.eval('runtime.cues.map(cue => cue.audioStart)')).toEqual([0, 2])
    expect(viewer.eval('runtime.total')).toBe(4)
    viewer.eval('runtime.playing=true;runtime.speed=2;showMoment(0)'); await flush()
    expect(viewer.audio.playCalls).toBe(1); expect(viewer.audio.playbackRate).toBe(2)
    viewer.audio.currentTime = .5
    viewer.eval('showMoment(advanceStoryClock(runtime.time,100,runtime.cues[0]))')
    expect(viewer.eval('runtime.time')).toBe(.5); expect(viewer.get('cue-text').textContent).toBe('甲🪞')
    viewer.audio.currentTime = 2
    viewer.eval('showMoment(advanceStoryClock(runtime.time,100,runtime.cues[0]))')
    expect(viewer.eval('runtime.current')).toBe(0); expect(viewer.eval('runtime.time')).toBeCloseTo(1.995)
    await viewer.audio.dispatch('ended')
    viewer.eval('showMoment(advanceStoryClock(runtime.time,.25,runtime.cues[0]))')
    expect(viewer.eval('runtime.current')).toBe(1); expect(viewer.eval('runtime.time')).toBe(2)
    await viewer.ready(); expect(viewer.audio.paused).toBe(false)
    expect(viewer.get('cue-phase').textContent).not.toMatch(/观察|随后|阅读时间/)
  })

  it('catches up a delayed frame to the actual ended clip and advances directly to the next cue', async () => {
    const viewer = await audioHarness(); await viewer.ready(); viewer.eval('runtime.playing=true;showMoment(0)'); await flush()
    viewer.audio.currentTime = 2; await viewer.audio.dispatch('ended')
    viewer.eval('showMoment(advanceStoryClock(.1,60,runtime.cues[0]))')
    expect(viewer.eval('runtime.time')).toBe(2); expect(viewer.eval('runtime.current')).toBe(1)
  })

  it('rebuilds speech seeks and preserves media subtitles on pause/resume without a pre-roll', async () => {
    const viewer = await audioHarness(); await viewer.ready()
    viewer.eval('seekTime(1)'); await viewer.ready()
    expect(viewer.audio.playCalls).toBe(0)
    expect(viewer.audio.currentTime).toBe(1); expect(viewer.get('cue-text').textContent).toBe('甲🪞')
    viewer.eval('runtime.playing=true;showMoment(runtime.time)'); await flush(); expect(viewer.audio.playCalls).toBe(1)
    viewer.audio.currentTime = .8; viewer.eval('pause()')
    expect(viewer.audio.paused).toBe(true); expect(viewer.eval('runtime.time')).toBeCloseTo(.8); expect(viewer.get('cue-text').textContent).toBe('甲🪞')
    viewer.eval('runtime.playing=true;showMoment(runtime.time)'); await flush(); expect(viewer.audio.currentTime).toBe(.8); expect(viewer.audio.playCalls).toBe(2)
    viewer.eval('seekTime(3)'); await viewer.ready()
    expect(viewer.eval('runtime.current')).toBe(1); expect(viewer.audio.currentTime).toBe(1)
  })

  it('ignores a stale play promise rejection after a later cue is already speaking', async () => {
    const viewer = await audioHarness(); await viewer.ready()
    let rejectOld!: (reason: Error) => void
    viewer.audio.playResult = () => new Promise<void>((_, reject) => { rejectOld = reject })
    viewer.eval('runtime.playing=true;showMoment(0)'); await flush(); expect(viewer.audio.playCalls).toBe(1)
    viewer.eval('seekTime(3)'); viewer.audio.playResult = () => Promise.resolve(); await viewer.ready()
    viewer.eval('runtime.playing=true;showMoment(runtime.time)'); await flush(); expect(viewer.audio.playCalls).toBe(2)
    rejectOld(new Error('Old blocked request')); await flush()
    expect(viewer.eval('runtime.playing')).toBe(true); expect(viewer.eval('runtime.voice')).toBe(true); expect(viewer.eval('runtime.mediaCueId')).toBe('cue-two')
    expect(viewer.audio.paused).toBe(false); expect(viewer.get('viewer-error').hidden).toBe(true)
  })

  it('ignores old metadata and ended handlers after a cue reconstruction', async () => {
    const viewer = await audioHarness(); await viewer.ready()
    const oldReady = viewer.audio.onloadedmetadata!, oldEnded = viewer.audio.onended!
    viewer.eval('seekTime(3)'); await viewer.ready(); viewer.audio.currentTime = .8
    oldReady(); oldEnded()
    expect(viewer.eval('runtime.mediaCueId')).toBe('cue-two'); expect(viewer.eval('runtime.mediaEnded')).toBe(false)
    expect(viewer.audio.currentTime).toBe(.8)
  })

  it('pauses a current rejected play attempt without switching or silently muting the fixed voice', async () => {
    const viewer = await audioHarness(); await viewer.ready()
    viewer.audio.playResult = () => Promise.reject(new Error('Current autoplay rejected'))
    viewer.eval('runtime.playing=true;showMoment(0)'); await flush()
    expect(viewer.eval('runtime.playing')).toBe(false); expect(viewer.eval('runtime.voice')).toBe(true)
    expect(viewer.get('viewer-error').hidden).toBe(false); expect(viewer.get('viewer-error').textContent).toContain('重试')
    expect(viewer.get('play-button').disabled).toBe(false)
  })

  it('blocks a browser metadata duration mismatch instead of reporting a successful narration preview', async () => {
    const viewer = await audioHarness(); viewer.audio.duration = 7; viewer.audio.readyState = 1
    await viewer.audio.dispatch('loadedmetadata')
    expect(viewer.get('play-button').disabled).toBe(true); expect(viewer.get('viewer-error').textContent).toContain('实际时长')
    expect(viewer.audio.playCalls).toBe(0)
  })

  it('keeps unconfigured narration honest and blocks current decoding failures instead of silently falling back', async () => {
    const viewer = await harness('viewer')
    viewer.eval("runtime.story={chapters:[{id:'chapter-one',title:'故事',cues:[{id:'cue-one',text:'尚无旁白',kind:'illustrative'}]}],narration:{complete:false,status:'not_configured'}};runtime.sceneData={scenes:[]};")
    await viewer.eval('loadNarration()'); viewer.eval('buildTimeline();showMoment(0,true)')
    expect(viewer.eval('runtime.narrationReady')).toBe(false); expect(viewer.get('cue-phase').textContent).toContain('尚无旁白音轨')
    const speaking = await audioHarness(); await speaking.audio.dispatch('error')
    expect(speaking.get('viewer-error').hidden).toBe(false); expect(speaking.get('play-button').disabled).toBe(true)
    expect(speaking.eval('runtime.playing')).toBe(false)
  })
})
