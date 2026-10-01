import type { SceneFile } from '../../../contracts/src/types.ts'
import { bookScenes } from './book-content.ts'
import { getAvailablePerspectives, getPerspectiveLine, getPerspectiveScene, perspectiveIds } from './perspectives.ts'
import type { PerspectiveId } from './perspectives.ts'
import { createStoryWorld } from './story-world.ts'
import type { StoryWorld, StoryWorldContext, StoryWorldInspection } from './story-world.ts'

interface SceneInspectorOptions {
  base: string
  scene: SceneFile
  provenance: { assets: Array<{ assetId: string; sha256: string }> }
  currentPage: () => { scene: number; line: string }
  onOpen?: (opener: HTMLElement | null) => void
  onClose?: () => void
  onObjectInspect?: (object: StoryWorldInspection) => void
}

/** A separate scene window: opening, changing viewpoint and closing never advances the book. */
export function installSceneInspector(options: SceneInspectorOptions): () => void {
  const dialog = document.createElement('dialog')
  dialog.id = 'scene-inspector'
  dialog.setAttribute('aria-label', '查看组合后的 3D 场景')
  dialog.innerHTML = `<header><div><span class="scene-kicker">场景制作示意</span><h2 id="world-title"></h2></div><button id="close-world">返回当前书页</button></header>
    <nav id="scene-contexts" aria-label="选择场景"><button data-context="book" aria-pressed="true">本页场景</button><button data-context="captivity" aria-pressed="false">前情：匈奴羁留</button></nav>
    <div id="scene-viewport" aria-label="Blender 场景与 Tripo 物件的组合渲染"></div>
    <p id="world-status" role="status">正在准备场景…</p>
    <details class="scene-exploration"><summary>查看在场人物与物件</summary><p>点击画面中的人物，或使用下面的入口查看当前对象。</p><div id="world-inspect-objects"></div><p id="world-object-note" role="status"></p></details>
    <nav id="scene-perspectives" aria-label="选择 3D 场景视角"></nav>
    <section class="scene-perspective-note" aria-live="polite"><p id="world-view-note"></p><p id="world-narrative"></p><p id="world-boundary"></p></section>
    <details id="world-character-sources" hidden><summary>匈奴人物形象的交叉资料</summary><p>铜带牌、软帽、袍裤与毡靴分别参考考古材料；部分服装材料晚于本段约一个世纪，剪裁、配色和面貌属于推定复原。</p><a href="https://www.metmuseum.org/art/collection/search/65231" target="_blank" rel="noopener">同期匈奴铜带牌 · 大都会博物馆</a><a href="https://archaeology.nsc.ru/en/publications/jr-aeae-en/23-51-1/annot-12/" target="_blank" rel="noopener">阿尔泰软帽 · 俄科学院考古研究</a><a href="https://www.scfh.ru/en/papers/steppe-fashion-/" target="_blank" rel="noopener">诺音乌拉裤腿与毡靴 · 发掘者研究</a></details>
    <footer><button id="world-pause" aria-pressed="false">暂停场景</button><button id="save-world-image">保存当前渲染图</button><a id="world-image-download" hidden>下载 PNG 渲染图</a><button id="retry-world" hidden>重新加载场景</button></footer>`
  document.body.append(dialog)
  const viewport = dialog.querySelector<HTMLDivElement>('#scene-viewport')!
  const status = dialog.querySelector<HTMLElement>('#world-status')!
  const viewNav = dialog.querySelector<HTMLElement>('#scene-perspectives')!
  let world: StoryWorld | undefined
  let loading: Promise<StoryWorld> | undefined
  let page = options.currentPage()
  let perspective: PerspectiveId = 'overview'
  let context: StoryWorldContext = 'book'
  let paused = false
  let opener: HTMLElement | null = null
  const storageKey = 'history3d:zhang-qian-yuezhi:scene-view-v1'
  try {
    const saved = localStorage.getItem(storageKey)
    if (perspectiveIds.includes(saved as PerspectiveId)) perspective = saved as PerspectiveId
  } catch { /* The scene is usable without local storage. */ }

  function readyStatus() {
    status.textContent = context === 'captivity'
      ? '前情场景已就绪 · 汉使与匈奴人物的推定复原'
      : '本页场景已就绪 · 布景与在场人物已组合呈现'
  }
  function objectLabel(id: string) {
    if (id === 'obj-envoy') return '观察汉使'
    if (id === 'obj-companion') return '观察同行者'
    if (id === 'obj-representative') return page.scene === 1 ? '与月氏接见者交流' : page.scene === 3 ? '向大夏答问者询问' : '与当地协助者交流'
    if (id === 'obj-local') return '观察当地人的生活'
    if (id === 'obj-mural-horse') return '观察行旅中的马'
    if (id === 'obj-staff') return '观察汉使的节杖'
    if (id === 'obj-xiongnu') return '观察匈奴人物'
    return id
  }
  function updateExploration() {
    const present = new Set((viewport.dataset.objectIds ?? '').split(','))
    const buttons = options.scene.objects.filter(object => present.has(object.id) && !['asset-environment', 'asset-meeting', 'asset-market'].includes(object.render.type === 'asset' ? object.render.assetId : '')).map(object => {
      const button = document.createElement('button')
      button.dataset.inspectObject = object.id
      button.textContent = objectLabel(object.id)
      button.disabled = dialog.dataset.ready !== 'true'
      button.addEventListener('click', () => { world?.inspectObject(object.id) })
      return button
    })
    dialog.querySelector('#world-inspect-objects')!.replaceChildren(...buttons)
  }
  function updateDescription() {
    dialog.querySelector<HTMLAnchorElement>('#world-image-download')!.hidden = true
    dialog.querySelector('#world-object-note')!.textContent = ''
    const scene = bookScenes[page.scene]!
    const available = getAvailablePerspectives(page.scene, context)
    if (!available.some(item => item.id === perspective)) perspective = 'overview'
    const view = getPerspectiveScene(perspective, page.scene, context)
    const narrative = getPerspectiveLine(page.scene, page.line, perspective, context)
    const metadata = available.find(item => item.id === perspective)!
    dialog.querySelector('#world-title')!.textContent = `${context === 'captivity' ? '前情：羁留匈奴' : scene.title} · 3D 场景`
    dialog.querySelector('#world-view-note')!.textContent = view.description
    dialog.querySelector('#world-narrative')!.textContent = narrative.text
    dialog.querySelector('#world-boundary')!.textContent = `${metadata.boundary} 建筑、人物外貌、物件外形与站位为制作示意；绘本进度保持在当前句。`
    viewNav.replaceChildren(...available.map(item => {
      const button = document.createElement('button')
      button.dataset.perspective = item.id
      button.textContent = item.label
      button.setAttribute('aria-pressed', String(item.id === perspective))
      button.disabled = dialog.dataset.ready !== 'true'
      return button
    }))
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-context]')) button.setAttribute('aria-pressed', String(button.dataset.context === context))
    dialog.querySelector<HTMLElement>('#world-character-sources')!.hidden = context !== 'captivity'
    dialog.dataset.context = context
    dialog.dataset.perspective = perspective
    dialog.dataset.scene = String(page.scene)
    dialog.dataset.line = page.line
    if (dialog.dataset.ready === 'true') readyStatus()
    updateExploration()
  }
  function enableControls(enabled: boolean) {
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-perspective],[data-context],[data-inspect-object],#world-pause,#save-world-image')) button.disabled = !enabled
  }
  async function showWorld() {
    enableControls(false)
    dialog.dataset.ready = 'false'
    status.textContent = '正在加载组合场景并核对模型…'
    dialog.querySelector<HTMLElement>('#retry-world')!.hidden = true
    try {
      if (!world) {
        loading ??= createStoryWorld(viewport, { base: options.base, scene: options.scene, provenance: options.provenance, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, onObjectInspect: (object) => {
          options.onObjectInspect?.(object)
          dialog.querySelector('#world-object-note')!.textContent = object.context === 'captivity' ? '已查看羁留前情人物。服装与面貌为交叉史料推定。' : `已选中：${objectLabel(object.objectId)}。`
        } })
        try { world = await loading } finally { loading = undefined }
      }
      if (!dialog.open) return
      world.resize()
      world.setScene(page.scene)
      world.setContext(context)
      world.setLine(page.line)
      world.setPerspective(perspective)
      world.setPaused(paused)
      readyStatus()
      dialog.dataset.ready = 'true'
      enableControls(true)
      updateExploration()
    } catch (error) {
      world?.dispose()
      world = undefined
      status.textContent = error instanceof Error ? error.message : '组合场景未能加载'
      dialog.dataset.ready = 'false'
      dialog.querySelector<HTMLElement>('#retry-world')!.hidden = false
      for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-context]')) button.disabled = false
      console.error('3D scene unavailable', error)
    }
  }
  viewNav.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-perspective]')
    if (!button || button.disabled) return
    const next = button.dataset.perspective as PerspectiveId
    if (!world || !perspectiveIds.includes(next)) return
    perspective = next
    world.setPerspective(perspective)
    updateDescription()
    try { localStorage.setItem(storageKey, perspective) } catch { /* Optional scene preference. */ }
  })
  dialog.querySelector('#scene-contexts')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-context]')
    if (!button || button.disabled || button.dataset.context === context) return
    context = button.dataset.context as StoryWorldContext
    updateDescription()
    void showWorld()
  })
  dialog.querySelector('#close-world')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => {
    world?.setPaused(true)
    document.body.classList.remove('scene-view-open')
    if (opener?.isConnected) opener.focus()
    options.onClose?.()
  })
  dialog.querySelector('#retry-world')!.addEventListener('click', () => { void showWorld() })
  dialog.querySelector('#world-pause')!.addEventListener('click', () => {
    paused = !paused
    world?.setPaused(paused)
    const button = dialog.querySelector('#world-pause')!
    button.textContent = paused ? '继续查看' : '暂停场景'
    button.setAttribute('aria-pressed', String(paused))
  })
  dialog.querySelector('#save-world-image')!.addEventListener('click', () => {
    if (!world || dialog.dataset.ready !== 'true') return
    try {
      const link = dialog.querySelector<HTMLAnchorElement>('#world-image-download')!
      link.href = world.capturePng()
      link.download = `张骞-${context === 'captivity' ? 'captivity' : bookScenes[page.scene]!.id}-${perspective}-场景示意.png`
      link.hidden = false
      link.click()
      status.textContent = '已生成当前视角的渲染图 · 可点击下载 PNG'
    } catch {
      status.textContent = '渲染图暂时无法保存，请重试'
    }
  })
  document.addEventListener('visibilitychange', () => world?.setPaused(document.hidden || !dialog.open || paused))
  addEventListener('pagehide', (event) => {
    if (event.persisted) world?.setPaused(true)
    else { world?.dispose(); world = undefined }
  })
  addEventListener('pageshow', (event) => {
    if (event.persisted && dialog.open) void showWorld()
  })
  return () => {
    if (dialog.open) return
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    page = options.currentPage()
    context = 'book'
    updateDescription()
    enableControls(false)
    dialog.showModal()
    document.body.classList.add('scene-view-open')
    options.onOpen?.(opener)
    void showWorld()
  }
}
