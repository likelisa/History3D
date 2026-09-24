import * as THREE from 'three'

import {
  errorDiagnostic,
  hasBlockingError,
  warningDiagnostic,
} from '../../contracts/src/diagnostics.ts'
import type { Diagnostic, DiagnosticCode } from '../../contracts/src/diagnostics.ts'
import { formatMeters } from '../../contracts/src/geometry.ts'
import type { Claim, SceneFile, SourceEntry, SourcesFile, StoryFile } from '../../contracts/src/types.ts'
import type { ExperienceFile } from '../../contracts/src/experience.ts'
import { validateScenePackage } from '../../contracts/src/validate.ts'
import { BenchRecorder } from './bench.ts'
import type { BenchReport } from './bench.ts'
import { createHotspotMarkers } from './hotspots.ts'
import type { HotspotMarker } from './hotspots.ts'
import { Measurer } from './measure.ts'
import { candidateBaseUrl, createFetchReader, packageBaseUrl, packageUrl } from './reader.ts'
import { clear, claimGroupNode, diagnosticsNode, el, hotspotNode, sourceDetailNode } from './ui.ts'
import { Walker } from './walker.ts'
import { buildWorld, WorldBuildError } from './world.ts'
import type { World } from './world.ts'
import { ExperiencePlayer } from './experience-player.ts'

declare global {
  interface Window {
    __benchReport?: BenchReport
  }
}

type Stage = 'idle' | 'loading_manifest' | 'validating' | 'loading_assets' | 'ready' | 'error'
type CameraMode = 'first-person' | 'overview' | 'story'

const STAGE_LABELS: Record<Stage, string> = {
  idle: '等待开始',
  loading_manifest: '① 读取场景包',
  validating: '② 校验数据与引用',
  loading_assets: '③ 加载资产',
  ready: '可体验',
  error: '加载失败',
}

export class ViewerApp {
  private readonly viewport = el('div', { className: 'viewport' })
  private readonly storyTitle = el('span', { className: 'story-title', text: '未命名故事' })
  private readonly stageIndicator = el('span', { className: 'stage-indicator', text: STAGE_LABELS.idle })
  private readonly bannerRow = el('div', { className: 'banner-row' })
  private readonly crosshair = el('div', { className: 'crosshair', hidden: true })
  private readonly measureReadout = el('div', { className: 'measure-readout', hidden: true })
  private readonly panel = el('aside', { className: 'panel', hidden: true })
  private readonly panelTitle = el('h2', { className: 'panel-title' })
  private readonly panelBody = el('div', { className: 'panel-body' })
  private readonly panelClose = el('button', {
    className: 'panel-close',
    text: '关闭',
    onClick: () => this.closePanel(),
  })
  private readonly overlay = el('div', { className: 'overlay' })
  private readonly benchCard = el('pre', { className: 'bench-card', hidden: true })
  private readonly experienceBar = el('div', { className: 'experience-bar', hidden: true })
  private readonly experiencePlay = el('button', { className: 'experience-action', text: '播放', onClick: () => this.toggleExperiencePlayback() })
  private readonly experienceTimeLabel = el('span', { className: 'experience-time', text: '0:00 / 0:00' })
  private readonly experienceSlider = document.createElement('input')
  private readonly buttonByAction = new Map<string, HTMLButtonElement>()

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene3d = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400)
  private readonly clock = new THREE.Clock()
  private readonly pointer = new THREE.Vector2()
  private readonly raycaster = new THREE.Raycaster()

  private storyId: string
  private candidateReleaseId: string | null
  private readonly benchEnabled: boolean
  private readonly benchSeconds: number
  private bench: BenchRecorder | null = null
  private benchYawSign = 1

  private stage: Stage = 'idle'
  private sceneFile: SceneFile | null = null
  private story: StoryFile | null = null
  private sources: SourcesFile | null = null
  private world: World | null = null
  private walker: Walker | null = null
  private measurer: Measurer | null = null
  private markers: HotspotMarker[] = []
  private diagnostics: Diagnostic[] = []
  private cameraMode: CameraMode = 'first-person'
  private experienceActive = false
  private panelOpen = false
  private pauseOverlayShown = false
  private loadStartMs = performance.now()
  private experienceFile: ExperienceFile | null = null
  private experiencePlayer: ExperiencePlayer | null = null
  private experienceTime = 0
  private experiencePlaying = false

  constructor(private readonly root: HTMLElement) {
    const query = new URLSearchParams(location.search)
    this.storyId =
      query.get('story') || import.meta.env.VITE_DEFAULT_STORY_ID || 'silk-road-demo'
    this.candidateReleaseId = query.get('candidate')
    this.benchEnabled = query.get('bench') === '1'
    this.benchSeconds = Number(query.get('benchSeconds') ?? '90') || 90

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.scene3d.background = new THREE.Color(0x16233a)
    this.scene3d.fog = new THREE.Fog(0x16233a, 80, 220)

    this.buildShell()
    this.bindEvents()
  }

  async start(): Promise<void> {
    this.loadStartMs = performance.now()
    this.renderer.setAnimationLoop(() => this.tick())
    await this.loadPackage()
  }

  private buildShell(): void {
    const brand = el('div', { className: 'brand' }, [
      el('span', { className: 'brand-mark', text: 'History3D' }),
      this.storyTitle,
    ])

    const actions: Array<[string, string, () => void]> = [
      ['start', '开始体验', () => this.startExperience()],
      ['camera', '俯视', () => this.toggleCameraMode()],
      ['measure', '测距', () => this.toggleMeasure()],
      ['stories', '故事列表', () => this.openStoryList()],
      ['reset', '回到起点', () => this.resetToSpawn()],
    ]
    const nav = el('nav', { className: 'actions' })
    for (const [action, label, handler] of actions) {
      const button = el('button', { className: 'action', text: label, onClick: handler })
      button.dataset.action = action
      this.buttonByAction.set(action, button)
      nav.append(button)
    }

    const topbar = el('header', { className: 'topbar' }, [
      brand,
      nav,
      el('div', { className: 'stage' }, [this.stageIndicator]),
    ])

    this.panel.append(this.panelClose, this.panelTitle, this.panelBody)
    this.experienceSlider.type = 'range'
    this.experienceSlider.min = '0'
    this.experienceSlider.max = '0'
    this.experienceSlider.step = '0.1'
    this.experienceSlider.value = '0'
    this.experienceSlider.setAttribute('aria-label', '演示时间')
    this.experienceSlider.addEventListener('input', () => this.seekExperience(Number(this.experienceSlider.value)))
    this.experienceBar.append(
      el('span', { className: 'experience-heading', text: '演示动作' }),
      this.experiencePlay,
      el('button', { className: 'experience-action', text: '归零', onClick: () => this.seekExperience(0) }),
      el('button', { className: 'experience-action', text: '剧情镜头', onClick: () => this.activateStoryCamera() }),
      this.experienceSlider,
      this.experienceTimeLabel,
    )
    this.root.append(
      el('div', { className: 'app-shell' }, [
        this.viewport,
        topbar,
        this.bannerRow,
        this.crosshair,
        this.measureReadout,
        this.panel,
        this.overlay,
        this.benchCard,
        this.experienceBar,
      ]),
    )
    this.viewport.append(this.renderer.domElement)
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize())
    document.addEventListener('pointerlockchange', () => this.syncPausedState())
    document.addEventListener('keydown', (event) => {
      this.walker?.handleKey(event, true)
    })
    document.addEventListener('keyup', (event) => {
      this.walker?.handleKey(event, false)
    })
    this.viewport.addEventListener('mousemove', (event) => {
      const rect = this.viewport.getBoundingClientRect()
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      if (document.pointerLockElement === this.viewport) {
        this.walker?.handleMouseMove(event.movementX, event.movementY)
      }
    })
    this.viewport.addEventListener('click', (event) => this.handleViewportClick(event))
    this.resize()
  }

  private resize(): void {
    const width = this.viewport.clientWidth || window.innerWidth
    const height = this.viewport.clientHeight || window.innerHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private async loadPackage(): Promise<void> {
    const baseUrl = this.candidateReleaseId
      ? candidateBaseUrl(this.storyId, this.candidateReleaseId)
      : packageBaseUrl(this.storyId)
    if (!baseUrl) {
      this.failWith([errorDiagnostic('VALIDATION_FAILED', 'release.json', 'releaseId', '候选版本 ID 不合法')])
      return
    }
    const reader = createFetchReader(baseUrl)
    this.setStage('loading_manifest')
    this.showOverlay('正在读取场景包', `位置：${baseUrl}/scene.json`)

    const result = await validateScenePackage(reader)
    this.setStage('validating')
    this.diagnostics = [...result.diagnostics]

    if (!result.scene || !result.story || !result.sources) {
      this.failWith(result.diagnostics)
      return
    }
    if (hasBlockingError(result.diagnostics)) {
      this.failWith(result.diagnostics)
      return
    }
    const releaseText = await reader.readText('release.json')
    if (releaseText) {
      try {
        const release = JSON.parse(releaseText) as { requiredCapabilities?: string[] }
        const supported = new Set(['static-glb-v1', 'transform-tracks-v1', 'attachment-tracks-v1', 'visibility-tracks-v1', 'environment-v1', 'camera-cues-v1'])
        const missing = (release.requiredCapabilities ?? []).filter((item) => !supported.has(item))
        if (missing.length) {
          this.failWith([errorDiagnostic('VALIDATION_FAILED', 'release.json', 'requiredCapabilities', `查看器不支持：${missing.join(', ')}`)])
          return
        }
      } catch (error) {
        if (this.stage === 'error') return
        this.failWith([errorDiagnostic('VALIDATION_FAILED', 'release.json', '', `release.json 无法读取：${String(error)}`)])
        return
      }
    }

    this.sceneFile = result.scene
    this.story = result.story
    this.sources = result.sources
    this.storyTitle.textContent = result.story.title
    this.collectSourceDiagnostics()

    this.setStage('loading_assets')
    this.showOverlay('正在加载资产', '主模型与贴图准备中…')

    try {
      const world = await buildWorld({
        scene: result.scene,
        baseUrl,
        onAssetProgress: (loaded, total) => {
          this.showOverlay('正在加载资产', total > 0 ? `模型 ${loaded}/${total}` : '场景中没有外部模型')
        },
      })
      this.world = world
      this.diagnostics.push(...world.diagnostics)
      this.setupWorld(world, result.scene, result.story)
      const experienceText = await reader.readText('experience.json')
      if (experienceText) {
        const experience = JSON.parse(experienceText) as ExperienceFile
        if (experience.audio.length) throw new Error('audio-v1 未接入；候选不能声称已播放音乐')
        this.experiencePlayer = new ExperiencePlayer(result.scene, experience, world, this.scene3d, this.markers)
        this.experienceFile = experience
        this.experienceSlider.max = String(experience.durationSeconds)
        this.experienceBar.hidden = false
        for (const beat of experience.beats) {
          this.experienceBar.append(el('button', { className: 'experience-beat', text: beat.label, onClick: () => this.seekExperience(beat.startSeconds) }))
        }
        this.seekExperience(0)
      }
    } catch (error) {
      if (error instanceof WorldBuildError) {
        this.diagnostics.push(
          errorDiagnostic('ASSET_LOAD_FAILED', error.file, '', error.message),
        )
      } else {
        const reason = error instanceof Error ? error.message : String(error)
        this.diagnostics.push(
          errorDiagnostic('ASSET_LOAD_FAILED', 'scene.json', '', `场景构建失败：${reason}`),
        )
      }
      this.failWith(this.diagnostics)
      return
    }

    this.setStage('ready')
    this.hideOverlay()
    this.renderBanners()
    this.openStoryList()
    this.startBenchIfRequested()
  }

  private setupWorld(world: World, scene: SceneFile, story: StoryFile): void {
    this.scene3d.add(world.root)

    const groups = new Map(world.objects.map((item) => [item.definition.id, item.group]))
    this.markers = createHotspotMarkers(story, scene, groups)
    for (const marker of this.markers) {
      marker.marker.userData.raycastIgnore = false
      this.scene3d.add(marker.marker)
    }

    this.measurer = new Measurer(world.pickTargets)
    this.measurer.object.traverse((child) => {
      child.userData.raycastIgnore = true
    })
    this.scene3d.add(this.measurer.object)

    this.walker = new Walker({
      spawnFeet: scene.cameras.firstPerson.spawnFeet,
      eyeHeightM: scene.cameras.firstPerson.eyeHeightM,
      yawRad: scene.cameras.firstPerson.yawRad,
      pitchRad: scene.cameras.firstPerson.pitchRad,
      moveSpeedMps: scene.cameras.firstPerson.moveSpeedMps,
      radiusM: scene.cameras.firstPerson.radiusM,
      bounds: scene.walkableBounds,
      blockers: scene.blockers,
      groundY: scene.ground.y,
    })
    this.applyCameraMode()
  }

  private collectSourceDiagnostics(): void {
    const sources = this.sources
    if (!sources) return
    for (const source of sources.sources) {
      const usable = Boolean(source.locator.url && /^https?:\/\//i.test(source.locator.url))
      if (!usable) {
        this.diagnostics.push(
          warningDiagnostic(
            'SOURCE_OFFLINE',
            'sources.json',
            `sources[id=${source.id}].locator.url`,
            `来源 ${source.id} 没有可用的外部链接，界面会显示包内摘要。`,
          ),
        )
      }
    }
  }

  private tick(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1)
    if (this.experiencePlaying && this.experiencePlayer) {
      this.experienceTime = Math.min(this.experiencePlayer.durationSeconds, this.experienceTime + delta)
      this.experiencePlayer.apply(this.experienceTime)
      if (this.cameraMode === 'story') this.applyStoryCamera()
      this.syncExperienceControls()
      if (this.experienceTime >= this.experiencePlayer.durationSeconds) {
        this.experiencePlaying = false
        this.syncExperienceControls()
      }
    }
    if (this.walker) {
      this.walker.update(delta)
      if (this.cameraMode === 'first-person') this.walker.applyTo(this.camera)
    }
    this.syncMovement()
    this.updateMeasureReadout()
    this.addBenchSample(delta)
    this.renderer.render(this.scene3d, this.camera)
  }

  private syncMovement(): void {
    if (!this.walker) return
    const canMove =
      this.stage === 'ready' &&
      this.cameraMode === 'first-person' &&
      this.experienceActive &&
      document.pointerLockElement === this.viewport &&
      !this.panelOpen &&
      this.measurer?.enabled !== true &&
      !this.benchEnabled
    this.walker.enabled = canMove || (this.benchEnabled && this.stage === 'ready')
  }

  private applyCameraMode(): void {
    const scene = this.sceneFile
    if (!scene) return
    if (this.cameraMode === 'story') {
      this.applyStoryCamera()
    } else if (this.cameraMode === 'overview') {
      const overview = scene.cameras.overview
      this.camera.up.set(overview.up[0], overview.up[1], overview.up[2])
      this.camera.position.set(overview.position[0], overview.position[1], overview.position[2])
      // 不要在这里改 rotation.order：lookAt 写入的是四元数，
      // 之后改 order 会按新顺序重算四元数，直接破坏朝向。
      this.camera.lookAt(overview.target[0], overview.target[1], overview.target[2])
    } else {
      this.camera.up.set(0, 1, 0)
      this.walker?.applyTo(this.camera)
    }
  }

  private applyStoryCamera(): void {
    const cues = this.experienceFile?.cameraCues ?? []
    const cue = [...cues].reverse().find((item) => item.timeSeconds <= this.experienceTime)
    if (!cue) return
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(...cue.position)
    this.camera.lookAt(...cue.target)
  }

  private activateStoryCamera(): void {
    if (!this.experienceFile || this.stage !== 'ready') return
    this.cameraMode = 'story'
    this.applyStoryCamera()
    const button = this.buttonByAction.get('camera')
    if (button) button.textContent = '第一人称'
    if (document.pointerLockElement === this.viewport) document.exitPointerLock()
    this.closePanel()
    this.syncPausedState()
  }

  private updatePointerFromEvent(event: MouseEvent): void {
    const rect = this.viewport.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    )
  }

  private handleViewportClick(event: MouseEvent): void {
    if (this.stage !== 'ready') return
    const measurer = this.measurer
    if (measurer?.enabled) {
      // 测距时指针是自由的：直接用这次点击的坐标，不依赖此前的 mousemove。
      this.updatePointerFromEvent(event)
      measurer.pick(this.pointer, this.camera)
      this.updateMeasureReadout()
      return
    }
    if (document.pointerLockElement !== this.viewport) return

    this.raycaster.setFromCamera(this.pointer.set(0, 0), this.camera)
    const markerHits = this.raycaster.intersectObjects(
      this.markers.map((item) => item.marker),
      false,
    )
    if (markerHits.length > 0 && markerHits[0].distance < 25) {
      const hotspotId = markerHits[0].object.userData.hotspotId as string
      this.openHotspot(hotspotId)
      return
    }

    const objectHits = this.raycaster.intersectObjects(this.world?.pickTargets ?? [], true)
    const objectId = objectHits[0]?.object.userData.objectId as string | undefined
    if (objectId) this.openObjectDetail(objectId)
  }

  private startExperience(): void {
    this.closePanel()
    this.pauseOverlayShown = false
    this.overlay.hidden = false
    clear(this.overlay)
    this.overlay.append(
      el('div', { className: 'card' }, [
        el('h2', { text: '操作说明' }),
        el('ul', { className: 'help-list' }, [
          el('li', { text: 'WASD 或方向键移动，鼠标看向四周' }),
          el('li', { text: 'Esc 释放鼠标，回到本页可再次进入' }),
          el('li', { text: '准星对准故事点标记后点击，可以打开故事说明' }),
          el('li', { text: '眼睛高度固定为 1.7 米，可以直接比较物体与人的尺度' }),
        ]),
        el('button', {
          className: 'primary',
          text: '进入场景',
          onClick: () => {
            this.experienceActive = true
            this.hideOverlay()
            void this.requestLock()
          },
        }),
      ]),
    )
  }

  private async requestLock(): Promise<void> {
    try {
      await this.viewport.requestPointerLock()
    } catch {
      this.syncPausedState()
    }
    this.syncPausedState()
  }

  private syncPausedState(): void {
    const locked = document.pointerLockElement === this.viewport
    if (this.stage !== 'ready') return
    if (locked) {
      this.pauseOverlayShown = false
      this.hideOverlay()
      return
    }
    // 打开面板或进入测距时自由指针本来就不该被「已暂停」卡片挡住。
    // 这里要主动收掉可能残留的卡片，而不是直接 return。
    if (this.panelOpen || this.measurer?.enabled) {
      this.hidePauseOverlay()
      return
    }
    // 俯视模式本来就不可行走，不应该弹「已暂停」。
    if (this.cameraMode !== 'first-person') {
      this.hidePauseOverlay()
      return
    }
    if (!this.experienceActive) {
      this.hidePauseOverlay()
      return
    }
    this.pauseOverlayShown = true
    this.overlay.hidden = false
    clear(this.overlay)
    this.overlay.append(
      el('div', { className: 'card card-compact' }, [
        el('p', { text: '已暂停。进入体验后开始计时与移动。' }),
        el('button', {
          className: 'primary',
          text: '继续体验',
          onClick: () => {
            void this.requestLock()
          },
        }),
      ]),
    )
  }

  private toggleCameraMode(): void {
    if (this.stage !== 'ready') return
    this.cameraMode = this.cameraMode === 'first-person' ? 'overview' : 'first-person'
    this.applyCameraMode()
    const button = this.buttonByAction.get('camera')
    if (button) button.textContent = this.cameraMode === 'first-person' ? '俯视' : '第一人称'
    if (this.cameraMode === 'overview') {
      document.exitPointerLock()
      this.closePanel()
    }
    this.syncPausedState()
  }

  private toggleMeasure(): void {
    const measurer = this.measurer
    if (!measurer || this.stage !== 'ready') return
    measurer.enabled = !measurer.enabled
    if (measurer.enabled) {
      this.cameraMode = 'first-person'
      this.applyCameraMode()
      document.exitPointerLock()
      this.closePanel()
      measurer.clear()
    }
    this.crosshair.hidden = !measurer.enabled
    this.measureReadout.hidden = !measurer.enabled
    const button = this.buttonByAction.get('measure')
    if (button) button.textContent = measurer.enabled ? '退出测距' : '测距'
    this.updateMeasureReadout()
    this.syncPausedState()
  }

  private updateMeasureReadout(): void {
    const measurer = this.measurer
    if (!measurer?.enabled) return
    const result = measurer.result
    if (result) {
      this.measureReadout.textContent = `${formatMeters(result.distanceM)} · 两点直线距离`
      return
    }
    if (measurer.pending) {
      this.measureReadout.textContent = '已选第一个点，请点击第二个点'
      return
    }
    this.measureReadout.textContent = '测距模式：点击地面或物体表面选点'
  }

  private resetToSpawn(): void {
    if (this.stage !== 'ready') return
    this.walker?.reset()
    this.cameraMode = 'first-person'
    const button = this.buttonByAction.get('camera')
    if (button) button.textContent = '俯视'
    if (this.measurer) {
      this.measurer.clear()
      this.measurer.enabled = false
    }
    this.crosshair.hidden = true
    this.measureReadout.hidden = true
    const measureButton = this.buttonByAction.get('measure')
    if (measureButton) measureButton.textContent = '测距'
    this.closePanel()
    if (this.experiencePlayer) this.seekExperience(0)
    this.applyCameraMode()
    if (this.experienceActive) void this.requestLock()
  }

  private toggleExperiencePlayback(): void {
    if (!this.experiencePlayer || this.stage !== 'ready') return
    if (this.experienceTime >= this.experiencePlayer.durationSeconds) this.experienceTime = 0
    this.experiencePlaying = !this.experiencePlaying
    this.experiencePlayer.apply(this.experienceTime)
    this.syncExperienceControls()
  }

  private seekExperience(timeSeconds: number): void {
    if (!this.experiencePlayer) return
    this.experiencePlaying = false
    this.experienceTime = Math.max(0, Math.min(this.experiencePlayer.durationSeconds, timeSeconds))
    this.experiencePlayer.apply(this.experienceTime)
    if (this.cameraMode === 'story') this.applyStoryCamera()
    this.syncExperienceControls()
  }

  private syncExperienceControls(): void {
    if (!this.experienceFile) return
    this.experiencePlay.textContent = this.experiencePlaying ? '暂停' : '播放'
    this.experienceSlider.value = String(this.experienceTime)
    const format = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
    this.experienceTimeLabel.textContent = `${format(this.experienceTime)} / ${format(this.experienceFile.durationSeconds)}`
  }

  private openStoryList(): void {
    const story = this.story
    if (!story) return
    const sources = this.sourceMap()
    const list = el('ol', { className: 'hotspot-list' })
    story.hotspots.forEach((hotspot, index) => {
      const button = el('button', {
        className: 'hotspot-link',
        text: `${index + 1}. ${hotspot.title}`,
        onClick: () => this.openHotspot(hotspot.id),
      })
      list.append(el('li', {}, [button]))
    })

    const route = el('button', {
      className: 'hotspot-link',
      text: '区域路线示意（不可测量历史里程）',
      onClick: () => this.openRoutePanel(),
    })

    const body = el('div', {}, [
      el('p', { className: 'scope-note', text: story.experienceQuestion }),
      list,
      el('h3', { text: '路线' }),
      el('ul', { className: 'hotspot-list' }, [el('li', {}, [route])]),
      el('h3', { text: '资料缺口与不确定性' }),
      el('p', {
        className: 'scope-note',
        text: story.historicalScope.scopeNote,
      }),
      ...story.claims
        .filter((claim) => claim.valueStatus === 'unknown')
        .map((claim) => el('p', { className: 'unknown-note', text: `暂无依据：${claim.statement}` })),
      el('h3', { text: '来源' }),
      this.sourcesNode(sources),
    ])

    this.openPanel('故事列表', body)
  }

  private openHotspot(hotspotId: string): void {
    const story = this.story
    if (!story) return
    const index = story.hotspots.findIndex((hotspot) => hotspot.id === hotspotId)
    if (index < 0) return
    const hotspot = story.hotspots[index]
    const claims = this.claimsOf(hotspot.claimIds)
    this.openPanel(
      `故事点 ${index + 1}`,
      hotspotNode(hotspot, index + 1, claims, this.sourceMap()),
    )
  }

  private openObjectDetail(objectId: string): void {
    const world = this.world
    const story = this.story
    if (!world || !story) return
    const item = world.objects.find((entry) => entry.definition.id === objectId)
    if (!item) return
    const { definition } = item
    const brief = story.objectBriefs.find((entry) => entry.id === definition.briefId)
    const sources = this.sourceMap()

    const groups = [
      claimGroupNode('尺寸依据', this.claimsOf(definition.evidence.dimensions), sources),
      claimGroupNode('造型依据', this.claimsOf(definition.evidence.appearance), sources),
      claimGroupNode('布局依据', this.claimsOf(definition.evidence.placement), sources),
      claimGroupNode('数量依据', this.claimsOf(definition.evidence.quantity), sources),
    ].filter((node): node is HTMLElement => node !== null)

    const body = el('div', {}, [
      el('p', { className: 'scope-note', text: brief?.purpose ?? '未记录用途' }),
      el('p', {
        className: 'object-meta',
        text: `实现尺寸：${definition.dimensionsM.join(' × ')} 米`,
      }),
      el('p', {
        className: 'object-meta',
        text: '证据按属性分别标注；未覆盖的部分不代表已经复原。',
      }),
      ...groups,
    ])
    this.openPanel(definition.label, body)
  }

  private openRoutePanel(): void {
    const story = this.story
    if (!story) return
    const imageUrl = packageUrl(packageBaseUrl(this.storyId), story.routeOverview.imagePath)
    const fallback = el('p', {
      className: 'route-fallback',
      text: '路线示意图不可用，请参考文字说明。',
    })
    fallback.hidden = true
    const image = el('img', { className: 'route-image' })
    image.src = imageUrl
    image.alt = '区域路线示意'
    image.addEventListener('error', () => {
      image.hidden = true
      fallback.hidden = false
      this.pushRuntimeWarning(
        warningDiagnostic(
          'OPTIONAL_IMAGE_FAILED',
          'story.json',
          'routeOverview.imagePath',
          `路线示意图加载失败：${story.routeOverview.imagePath}，已保留文字说明。`,
        ),
      )
    })

    this.openPanel(
      '区域路线示意',
      el('div', {}, [
        image,
        fallback,
        el('p', { className: 'scope-note', text: '区域示意，不可据此测量历史里程。' }),
        el('p', {
          className: 'scope-note',
          text: '局部现场（60 × 60 米营地）与区域路线分开表达；本页不是场景本身。',
        }),
      ]),
    )
  }

  private sourcesNode(sources: Map<string, SourceEntry>): HTMLElement {
    const container = el('div', { className: 'sources' })
    if (sources.size === 0) {
      container.append(el('p', { className: 'scope-note', text: '本包没有登记来源。' }))
      return container
    }
    for (const source of sources.values()) {
      container.append(sourceDetailNode(source))
    }
    return container
  }

  private pushRuntimeWarning(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic)
    this.renderBanners()
  }

  private openPanel(title: string, body: HTMLElement): void {
    this.panelTitle.textContent = title
    clear(this.panelBody)
    this.panelBody.append(body)
    this.panel.hidden = false
    this.panelOpen = true
    document.exitPointerLock()
    this.pauseOverlayShown = false
    this.overlay.hidden = true
  }

  private closePanel(): void {
    this.panel.hidden = true
    this.panelOpen = false
    this.syncPausedState()
  }

  private renderBanners(): void {
    clear(this.bannerRow)
    const banners: HTMLElement[] = []
    if (this.story?.status === 'draft') {
      banners.push(el('div', { className: 'banner banner-draft', text: '技术占位，未经历史核验' }))
    }
    const warnings = this.diagnostics.filter((item) => item.severity === 'warning')
    if (warnings.length > 0) {
      const list = el('ul', { className: 'banner-list' })
      for (const warning of warnings) {
        list.append(el('li', { text: `[${warning.code}] ${warning.message}` }))
      }
      banners.push(
        el('details', { className: 'banner banner-warning' }, [
          el('summary', { text: `有 ${warnings.length} 条非阻塞提示` }),
          list,
        ]),
      )
    }
    for (const banner of banners) this.bannerRow.append(banner)
  }

  private setStage(stage: Stage): void {
    this.stage = stage
    this.stageIndicator.textContent = STAGE_LABELS[stage]
    this.root.dataset.stage = stage
  }

  private showOverlay(title: string, detail: string): void {
    this.overlay.hidden = false
    clear(this.overlay)
    this.overlay.append(
      el('div', { className: 'card' }, [
        el('h2', { text: title }),
        el('p', { text: detail }),
      ]),
    )
  }

  private hideOverlay(): void {
    this.pauseOverlayShown = false
    this.overlay.hidden = true
    clear(this.overlay)
  }

  /** 只清理由 syncPausedState 弹出的「已暂停」卡片，避免误伤操作说明或错误页。 */
  private hidePauseOverlay(): void {
    if (!this.pauseOverlayShown) return
    this.hideOverlay()
  }

  private failWith(diagnostics: readonly Diagnostic[]): void {
    this.setStage('error')
    document.exitPointerLock()
    this.overlay.hidden = false
    clear(this.overlay)
    this.overlay.append(
      el('div', { className: 'card card-error' }, [
        el('h2', { text: '场景包无法进入' }),
        el('p', {
          text: '以下问题需要先修好。缺失的主模型不会静默降级为灰盒。',
        }),
        diagnosticsNode(diagnostics),
        el('button', {
          className: 'primary',
          text: '重试加载',
          onClick: () => {
            void this.reload();
          },
        }),
      ]),
    )
  }

  private async reload(): Promise<void> {
    this.disposeWorld()
    this.diagnostics = []
    this.loadStartMs = performance.now()
    await this.loadPackage()
  }

  private disposeWorld(): void {
    if (this.world) {
      this.scene3d.remove(this.world.root)
      this.world = null
    }
    for (const marker of this.markers) this.scene3d.remove(marker.marker)
    this.markers = []
    if (this.measurer) this.scene3d.remove(this.measurer.object)
    this.measurer = null
    this.walker = null
  }

  private startBenchIfRequested(): void {
    if (!this.benchEnabled) return
    this.experienceActive = true
    this.bench = new BenchRecorder(this.benchSeconds, performance.now() - this.loadStartMs)
    this.benchCard.hidden = false
    this.benchCard.textContent = `基准模式运行中：${this.benchSeconds} 秒…`
  }

  private addBenchSample(delta: number): void {
    const bench = this.bench
    const walker = this.walker
    const scene = this.sceneFile
    if (!bench || !walker || !scene) return

    walker.enabled = true
    walker.setSyntheticInput(1, Math.sin(bench.elapsedSeconds / 6) * 0.8)
    this.benchYawSign = Math.sin(bench.elapsedSeconds / 9) > 0 ? 1 : -1
    walker.yawRad += 0.45 * this.benchYawSign * delta
    bench.sample(delta)
    this.benchCard.textContent = `基准模式运行中：${bench.elapsedSeconds.toFixed(1)} / ${this.benchSeconds} 秒`

    if (!bench.finished) return
    this.bench = null
    walker.setSyntheticInput(0, 0)
    const report = bench.report({
      storyId: scene.storyId,
      schemaVersion: scene.schemaVersion,
      contentRevision: scene.contentRevision,
      sceneRevision: scene.sceneRevision,
    })
    window.__benchReport = report
    this.benchCard.textContent = JSON.stringify(report, null, 2)
    console.log('benchReport', report)
  }

  private claimsOf(ids: readonly string[]): Claim[] {
    const story = this.story
    if (!story) return []
    const byId = new Map(story.claims.map((claim) => [claim.id, claim]))
    return ids.map((id) => byId.get(id)).filter((claim): claim is Claim => Boolean(claim))
  }

  private sourceMap(): Map<string, SourceEntry> {
    const sources = this.sources
    if (!sources) return new Map()
    return new Map(sources.sources.map((source) => [source.id, source]))
  }
}

export type { DiagnosticCode }
