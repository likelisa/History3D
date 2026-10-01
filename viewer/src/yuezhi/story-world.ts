import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SceneFile, SceneObject, Vec3 } from '../../../contracts/src/types.ts'
import { bookScenes } from './book-content.ts'

export type StoryWorldPerspective = 'envoy' | 'opponent' | 'passersby' | 'overview' | 'host' | 'trader'
export type StoryWorldContext = 'book' | 'captivity'
export interface StoryAssetProvenance {
  assetId: string
  sha256: string
  path?: string
  provider?: string
  taskId?: string | null
  conversion?: { offset?: number[] }
}
export interface StoryWorldOptions {
  base: string
  scene: SceneFile
  provenance: StoryAssetProvenance[] | { assets: StoryAssetProvenance[] }
  reducedMotion?: boolean
  onProgress?: (loaded: number, total: number, assetId: string) => void
  onObjectInspect?: (object: StoryWorldInspection) => void
}
export interface StoryWorldInspection {
  objectId: string
  assetId: string
  label: string
  context: StoryWorldContext
  sceneId: string
  sha256: string
}
export interface StoryWorldEvidence {
  storyId: string
  context: StoryWorldContext
  scene: number
  sceneId: string
  line: string
  perspective: StoryWorldPerspective
  frames: number
  elapsedSeconds: number
  paused: boolean
  camera: { position: Vec3; target: Vec3; fieldOfView: number }
  assets: Array<{ assetId: string; sha256: string; hashChecked: true; bytes: number; meshes: number; provider: string; taskId: string | null }>
  visibleObjects: Array<{ objectId: string; assetId: string; sha256: string; meshesRendered: number; bounds: { min: Vec3; max: Vec3 }; floorGapM: number | null }>
  backdrop: string
  rendering: { calls: number; triangles: number; width: number; height: number }
  historicalStatus: 'illustrative'
}
export interface StoryWorld {
  setContext(context: StoryWorldContext): void
  setScene(index: number): void
  setPerspective(view: StoryWorldPerspective): void
  setLine(id: string): void
  setPaused(paused: boolean): void
  resize(): void
  capturePng(): string
  getEvidence(): StoryWorldEvidence
  inspectObject(objectId: string): boolean
  dispose(): void
}

const perspectives: StoryWorldPerspective[] = ['envoy', 'opponent', 'passersby', 'overview', 'host', 'trader']
const backdrops = ['asset-environment', 'asset-meeting', 'asset-market']
const requiredActors = ['asset-envoy', 'asset-representative', 'asset-mural-horse']
function availableViews(index: number, context: StoryWorldContext): StoryWorldPerspective[] {
  if (context === 'captivity') return ['envoy', 'opponent', 'overview']
  if (index === 1) return ['envoy', 'host', 'overview']
  if (index === 3) return ['envoy', 'trader', 'passersby', 'overview']
  return ['envoy', 'passersby', 'overview']
}
const vector = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]
const resourceUrl = (base: string, relative: string) => `${base.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`

/** Ground against authored Blender floor meshes, never roofs, vegetation, or props. */
export function groundStoryObject(object: THREE.Object3D, floorMeshes: THREE.Object3D[]): number {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  const center = bounds.getCenter(new THREE.Vector3())
  const ray = new THREE.Raycaster(new THREE.Vector3(center.x, bounds.max.y + 50, center.z), new THREE.Vector3(0, -1, 0))
  const hit = ray.intersectObjects(floorMeshes, true)[0]
  if (!hit) throw new Error(`物件 ${object.name} 所在位置没有 Blender 地面，停止组合场景。`)
  // The runtime group has an untransformed parent; model geometry and authored scale stay intact.
  object.position.y += hit.point.y - bounds.min.y
  object.updateMatrixWorld(true)
  return hit.point.y
}

export async function verifyStoryAsset(bytes: ArrayBuffer, expected: string, assetId: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error(`资产 ${assetId} 缺少有效的 SHA-256 来源记录。`)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
  if (hash !== expected.toLowerCase()) throw new Error(`资产 ${assetId} 与来源 SHA-256 不一致，停止显示。`)
  return hash
}

interface Instance { definition: SceneObject; group: THREE.Group; assetId: string; meshes: number; groundY: number | null }
interface Placement { x: number; z: number; yaw: number }

// Spatial staging is explicitly illustrative. It changes no story, historical conclusion, or reading position.
function placements(index: number, context: StoryWorldContext): Record<string, Placement> {
  if (context === 'captivity') return {
    'obj-envoy': { x: -.9, z: 1.3, yaw: 2.54 },
    'obj-xiongnu': { x: 1.1, z: -1.5, yaw: -.62 },
  }
  if (index === 1) return {
    'obj-envoy': { x: -1.4, z: 1.5, yaw: 2.19 }, 'obj-companion': { x: -3, z: 2.2, yaw: 2.19 },
    'obj-representative': { x: 1.4, z: -.5, yaw: -.95 }, 'obj-local': { x: 4.7, z: 0, yaw: -.95 },
    'obj-staff': { x: -1.73, z: 1.5, yaw: 0 }, 'obj-mural-horse': { x: -5.4, z: 3.2, yaw: Math.PI },
  }
  if (index === 3) return {
    'obj-envoy': { x: -1.7, z: 1.5, yaw: 2.48 }, 'obj-companion': { x: -3.2, z: 3, yaw: 2.48 },
    'obj-representative': { x: 1.7, z: -1, yaw: -.83 }, 'obj-local': { x: 6.2, z: .1, yaw: -.8 },
    'obj-staff': { x: -2.03, z: 1.5, yaw: 0 }, 'obj-mural-horse': { x: -5.1, z: 4.2, yaw: Math.PI },
  }
  return {
    'obj-envoy': { x: -2, z: 2.5, yaw: 2.08 }, 'obj-companion': { x: -3.5, z: 3.7, yaw: 2.08 },
    'obj-representative': { x: 1.2, z: .7, yaw: -1.06 }, 'obj-local': { x: 4, z: -2.5, yaw: -.7 },
    'obj-staff': { x: -2.33, z: 2.5, yaw: 0 }, 'obj-mural-horse': { x: -4.8, z: 2, yaw: Math.PI },
  }
}

/** Builds the combined view only when its host is first opened. Asset failures are surfaced, never replaced by boxes. */
export async function createStoryWorld(host: HTMLElement, options: StoryWorldOptions): Promise<StoryWorld> {
  const provenance = Array.isArray(options.provenance) ? options.provenance : options.provenance.assets
  const records = new Map(provenance.map((asset) => [asset.assetId, asset]))
  for (const id of [...backdrops, ...requiredActors]) {
    if (!options.scene.assets.some((asset) => asset.id === id)) throw new Error(`组合场景包缺少 ${id}，请先准备完整的 Blender 与 Tripo 资产。`)
  }
  for (const id of requiredActors) {
    if (!options.scene.objects.some((object) => object.render.type === 'asset' && object.render.assetId === id)) throw new Error(`组合场景包包含 ${id} 文件，却没有采用它的场景物件。`)
  }
  if (options.scene.assets.some((asset) => asset.id === 'asset-xiongnu') && !options.scene.objects.some((object) => object.id === 'obj-xiongnu' && object.render.type === 'asset' && object.render.assetId === 'asset-xiongnu')) throw new Error('匈奴角色资产没有被 obj-xiongnu 采用，不能显示前情。')
  const templates = new Map<string, THREE.Group>()
  const checked: StoryWorldEvidence['assets'] = []
  const loader = new GLTFLoader()
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  function remember(object: THREE.Object3D) {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      geometries.add(child.geometry)
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      }
    })
  }
  function freeAssets() { for (const texture of textures) texture.dispose(); for (const material of materials) material.dispose(); for (const geometry of geometries) geometry.dispose() }
  host.dataset.ready = 'false'
  try {
    for (const asset of options.scene.assets) {
      const record = records.get(asset.id)
      if (!record) throw new Error(`组合场景缺少资产 ${asset.id} 的来源记录。`)
      const url = resourceUrl(options.base, asset.path)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`组合场景资产读取失败：${asset.path} (${response.status})`)
      const bytes = await response.arrayBuffer()
      const sha256 = await verifyStoryAsset(bytes, record.sha256, asset.id)
      const gltf = await loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1))
      remember(gltf.scene)
      let meshes = 0
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        meshes++
        // Authored stones, plants, timber and walls must cast shadows as well as the actors.
        child.castShadow = !/terrain|courtyard.?floor|Market.?courtyard|landscape.?continuation|river.?ribbon/i.test(child.name)
        child.receiveShadow = true
      })
      if (!meshes || new THREE.Box3().setFromObject(gltf.scene).isEmpty()) throw new Error(`资产 ${asset.id} 没有可渲染的三维网格。`)
      templates.set(asset.id, gltf.scene)
      checked.push({ assetId: asset.id, sha256, hashChecked: true, bytes: bytes.byteLength, meshes, provider: record.provider ?? '', taskId: record.taskId ?? null })
      host.dataset.loadedAssets = checked.map((item) => item.assetId).join(',')
      options.onProgress?.(checked.length, options.scene.assets.length, asset.id)
    }
  } catch (error) { freeAssets(); throw error }

  let disposed = false
  let frame = 0
  const resources: { renderer?: THREE.WebGLRenderer; controls?: OrbitControls; observer?: ResizeObserver; visibilityListener?: () => void; inspectionCleanup?: () => void; shadow?: THREE.LightShadow } = {}
  function cleanup() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(frame)
    resources.observer?.disconnect()
    if (resources.visibilityListener) document.removeEventListener('visibilitychange', resources.visibilityListener)
    resources.inspectionCleanup?.()
    resources.controls?.dispose()
    resources.shadow?.dispose()
    resources.renderer?.dispose()
    resources.renderer?.domElement.remove()
    freeAssets()
    host.dataset.ready = 'false'
    delete host.dataset.evidence
    delete host.dataset.inspectedObject
  }
  try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  resources.renderer = renderer
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .94
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  for (const texture of textures) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  renderer.domElement.setAttribute('aria-label', 'Blender 叙事布景与 Tripo 人物、马共同渲染的三维示意场景')
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  host.append(renderer.domElement)
  const world = new THREE.Scene()
  const skyPixels = new Uint8Array(256 * 4)
  const horizon = new THREE.Color('#d5d8c6'), zenith = new THREE.Color('#8daebe')
  for (let row = 0; row < 256; row++) {
    const color = horizon.clone().lerp(zenith, Math.pow(row / 255, .6))
    skyPixels.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], row * 4)
  }
  const sky = new THREE.DataTexture(skyPixels, 1, 256)
  sky.magFilter = THREE.LinearFilter
  sky.needsUpdate = true
  textures.add(sky)
  world.background = sky
  world.fog = new THREE.Fog('#c9d0c0', 50, 140)
  const content = new THREE.Group()
  world.add(content)
  world.add(new THREE.HemisphereLight('#d6e4ed', '#57452f', .85))
  const sun = new THREE.DirectionalLight('#ffe7c3', 2.2)
  resources.shadow = sun.shadow
  sun.position.set(-14, 24, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32; sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 95
  sun.shadow.normalBias = .012
  sun.shadow.bias = -.0001
  world.add(sun)
  const fill = new THREE.DirectionalLight('#d3e5ff', .18)
  fill.position.set(8, 5, -4); world.add(fill)
  const camera = new THREE.PerspectiveCamera(43, 1, .05, 250)
  const controls = new OrbitControls(camera, renderer.domElement)
  resources.controls = controls
  controls.enableDamping = !options.reducedMotion
  controls.dampingFactor = .08
  controls.minDistance = 1.1
  controls.maxDistance = 36
  controls.maxPolarAngle = Math.PI / 2 - .025
  controls.enablePan = true
  const instances: Instance[] = []
  const renderCounts = new Map<string, number>()
  let sceneIndex = 0
  let context: StoryWorldContext = 'book'
  let perspective: StoryWorldPerspective = 'overview'
  let line = ''
  let backdrop = ''
  let paused = true
  let frames = 0
  let elapsedSeconds = 0
  let lastTime = 0

  function addInstance(definition: SceneObject, assetId: string) {
    const template = templates.get(assetId)
    if (!template) throw new Error(`物件 ${definition.id} 的真实资产 ${assetId} 无法加载。`)
    const group = new THREE.Group()
    group.name = definition.id
    const instance = template.clone(true)
    group.add(instance)
    group.scale.set(...definition.scale)
    group.position.set(...definition.position)
    group.rotation.set(...definition.rotation)
    let meshes = 0
    instance.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      meshes++
      child.onBeforeRender = () => { renderCounts.set(definition.id, (renderCounts.get(definition.id) ?? 0) + 1) }
    })
    content.add(group)
    const item = { definition, assetId, group, meshes, groundY: null as number | null }
    instances.push(item)
    return item
  }
  for (const id of backdrops) {
    const definition = options.scene.objects.find((object) => object.render.type === 'asset' && object.render.assetId === id)
    const offset = records.get(id)?.conversion?.offset
    const position: Vec3 = offset?.length === 3 ? [offset[0]!, offset[1]!, offset[2]!] : definition?.position ?? [0, 0, 0]
    const dimensions = options.scene.assets.find((asset) => asset.id === id)!.dimensionsM
    const object: SceneObject = definition ?? { id: `obj-${id.replace('asset-', '')}`, briefId: `brief-${id}`, label: id, render: { type: 'asset', assetId: id }, position, rotation: [0, 0, 0], scale: [1, 1, 1], dimensionsM: dimensions, evidence: { dimensions: [], appearance: [], placement: [], quantity: [] } }
    const added = addInstance(object, id)
    added.group.position.set(...position)
  }
  for (const definition of options.scene.objects) {
    if (definition.render.type !== 'asset') throw new Error(`组合场景不接受灰盒替代物件 ${definition.id}。`)
    if (!backdrops.includes(definition.render.assetId)) addInstance(definition, definition.render.assetId)
  }

  function evidence(): StoryWorldEvidence {
    return {
      storyId: options.scene.storyId, context, scene: sceneIndex, sceneId: context === 'captivity' ? 'captivity' : bookScenes[sceneIndex]!.id, line, perspective, frames, elapsedSeconds, paused,
      camera: { position: vector(camera.position), target: vector(controls.target), fieldOfView: camera.fov },
      assets: checked.map((asset) => ({ ...asset })),
      visibleObjects: instances.filter((item) => item.group.visible && renderCounts.has(item.definition.id)).map((item) => {
        const box = new THREE.Box3().setFromObject(item.group)
        return { objectId: item.definition.id, assetId: item.assetId, sha256: records.get(item.assetId)!.sha256, meshesRendered: renderCounts.get(item.definition.id)!, bounds: { min: vector(box.min), max: vector(box.max) }, floorGapM: item.groundY === null ? null : box.min.y - item.groundY }
      }),
      backdrop, rendering: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, width: renderer.domElement.width, height: renderer.domElement.height }, historicalStatus: 'illustrative',
    }
  }
  function expose() {
    host.dataset.scene = String(sceneIndex)
    host.dataset.context = context
    host.dataset.sceneId = context === 'captivity' ? 'captivity' : bookScenes[sceneIndex]!.id
    host.dataset.line = line
    host.dataset.perspective = perspective
    host.dataset.frames = String(frames)
    host.dataset.paused = String(paused)
    host.dataset.backdrop = backdrop
    host.dataset.objectIds = instances.filter((item) => item.group.visible).map((item) => item.definition.id).join(',')
    host.dataset.renderedObjectIds = [...renderCounts.keys()].join(',')
    host.dataset.renderedAssetIds = [...new Set(instances.filter((item) => renderCounts.has(item.definition.id)).map((item) => item.assetId))].join(',')
    host.dataset.hashChecked = 'true'
    host.dataset.evidence = JSON.stringify(evidence())
  }
  function render() {
    if (disposed) return
    renderCounts.clear()
    world.updateMatrixWorld(true)
    renderer.render(world, camera)
    frames++
    expose()
  }
  function resize() {
    if (disposed) return
    const rect = host.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height))
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    // setSize clears the canvas, so paused scenes must also redraw once after a resize.
    render()
  }
  function configureCamera(view: StoryWorldPerspective) {
    const meeting = sceneIndex === 1, market = sceneIndex === 3
    controls.minDistance = 1.1
    controls.maxDistance = 36
    controls.enablePan = true
    if (view !== 'overview') {
      const ownId = view === 'envoy' ? 'obj-envoy' : view === 'opponent' ? 'obj-xiongnu' : view === 'passersby' && sceneIndex !== 0 ? 'obj-local' : 'obj-representative'
      const own = instances.find((item) => item.definition.id === ownId)
      const otherId = view === 'envoy' ? context === 'captivity' ? 'obj-xiongnu' : 'obj-representative' : 'obj-envoy'
      const other = instances.find((item) => item.definition.id === otherId)
      if (!own?.group.visible || !other?.group.visible) throw new Error(`当前场景没有可供 ${view} 视角使用的在场角色。`)
      const yaw = own.group.rotation.y
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      // A shoulder view shows the actual viewpoint NPC as well as the interlocutor.
      camera.position.copy(own.group.position).addScaledVector(forward, -1.7).addScaledVector(side, .72)
      camera.position.y += 1.64
      controls.target.copy(other.group.position)
      controls.target.y += 1.12
      controls.maxDistance = context === 'captivity' ? 12 : 18
      controls.enablePan = false
    } else {
      camera.position.set(context === 'captivity' ? 5.8 : meeting ? 6.5 : market ? 7.2 : 6.8, context === 'captivity' ? 3.5 : meeting ? 4.2 : market ? 4.7 : 4.4, context === 'captivity' ? 7.3 : meeting ? 8.6 : market ? 9.8 : 9.3)
      controls.target.set(context === 'captivity' ? 0 : market ? -.3 : -.8, .9, context === 'captivity' ? 0 : meeting ? 0 : market ? .8 : 1.2)
    }
    controls.update()
    render()
  }
  function stageScene() {
    delete host.dataset.inspectedObject
    backdrop = context === 'captivity' ? 'asset-environment' : bookScenes[sceneIndex]!.backdrop
    const actorIds = context === 'captivity'
      ? ['obj-envoy', 'obj-xiongnu']
      : sceneIndex === 1
        ? ['obj-envoy', 'obj-companion', 'obj-representative', 'obj-staff']
        : sceneIndex === 0
          ? ['obj-envoy', 'obj-companion', 'obj-representative', 'obj-staff', 'obj-mural-horse']
          : ['obj-envoy', 'obj-companion', 'obj-representative', 'obj-local', 'obj-staff', 'obj-mural-horse']
    for (const item of instances) item.group.visible = backdrops.includes(item.assetId) ? item.assetId === backdrop : actorIds.includes(item.definition.id)
    const ground = instances.find((item) => item.assetId === backdrop)!
    const floorMeshes: THREE.Object3D[] = []
    ground.group.updateMatrixWorld(true)
    ground.group.traverse((child) => {
      if (child instanceof THREE.Mesh && (/Illustrative_valley_terrain|Courtyard_floor|Market_courtyard|Illustrative valley terrain|Courtyard floor|Market courtyard/.test(child.name))) floorMeshes.push(child)
    })
    if (!floorMeshes.length) throw new Error(`Blender 布景 ${backdrop} 缺少明确地面网格，无法放置人物。`)
    const placement = placements(sceneIndex, context)
    for (const item of instances.filter((instance) => !backdrops.includes(instance.assetId) && instance.group.visible)) {
      const staged = placement[item.definition.id]
      item.group.position.set(staged?.x ?? item.definition.position[0], 0, staged?.z ?? item.definition.position[2])
      item.group.rotation.set(item.definition.rotation[0], staged?.yaw ?? item.definition.rotation[1], item.definition.rotation[2])
      item.groundY = groundStoryObject(item.group, floorMeshes)
    }
    if (!availableViews(sceneIndex, context).includes(perspective)) perspective = 'overview'
    configureCamera(perspective)
  }
  function setScene(index: number) {
    if (!Number.isInteger(index) || !bookScenes[index]) throw new Error(`没有第 ${index} 个故事布景。`)
    sceneIndex = index
    stageScene()
  }
  function setContext(value: StoryWorldContext) {
    if (value !== 'book' && value !== 'captivity') throw new Error(`未知故事场景上下文：${value}`)
    if (value === 'captivity' && !instances.some((item) => item.definition.id === 'obj-xiongnu' && item.assetId === 'asset-xiongnu')) throw new Error('前情缺少已采用并核对 SHA-256 的真实匈奴 NPC 资产。')
    context = value
    stageScene()
  }
  function setPerspective(view: StoryWorldPerspective) {
    if (!perspectives.includes(view)) throw new Error(`未知的故事视角：${view}`)
    if (!availableViews(sceneIndex, context).includes(view)) throw new Error(`当前场景没有 ${view} 身份视角。`)
    perspective = view
    configureCamera(view)
  }
  function inspectObject(objectId: string) {
    if (disposed) return false
    const item = instances.find(entry => entry.definition.id === objectId && entry.group.visible && !backdrops.includes(entry.assetId))
    if (!item) return false
    const inspection: StoryWorldInspection = { objectId, assetId: item.assetId, label: item.definition.label, context, sceneId: context === 'captivity' ? 'captivity' : bookScenes[sceneIndex]!.id, sha256: records.get(item.assetId)!.sha256 }
    host.dataset.inspectedObject = JSON.stringify(inspection)
    options.onObjectInspect?.(inspection)
    return true
  }
  let pointerStart: { id: number; x: number; y: number } | undefined
  const pointerDown = (event: PointerEvent) => { if (event.button === 0) pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY } }
  const pointerUp = (event: PointerEvent) => {
    const start = pointerStart
    pointerStart = undefined
    if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7 || disposed) return
    const rect = renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
    world.updateMatrixWorld(true)
    const hits = ray.intersectObjects(instances.filter(item => item.group.visible).map(item => item.group), true)
    for (const hit of hits) {
      let item: Instance | undefined
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        item = instances.find(entry => entry.group === node)
        if (item) break
      }
      if (!item) continue
      if (!backdrops.includes(item.assetId)) { inspectObject(item.definition.id); return }
      // Raycaster hits full foliage triangles even where their texture is transparent.
      // Let authored grass/shrub cards pass; solid walls, rocks and floors still occlude.
      if (hit.object instanceof THREE.Mesh) {
        const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material
        if (material && /grass|shrub/i.test(material.name) && (material.transparent || material.alphaTest > 0)) continue
      }
      return
    }
  }
  const pointerCancel = () => { pointerStart = undefined }
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  renderer.domElement.addEventListener('pointercancel', pointerCancel)
  resources.inspectionCleanup = () => {
    renderer.domElement.removeEventListener('pointerdown', pointerDown)
    renderer.domElement.removeEventListener('pointerup', pointerUp)
    renderer.domElement.removeEventListener('pointercancel', pointerCancel)
  }
  function animate(time: number) {
    if (paused || disposed || document.hidden) return
    if (lastTime) elapsedSeconds += Math.min((time - lastTime) / 1000, .1)
    lastTime = time
    controls.update()
    render()
    frame = requestAnimationFrame(animate)
  }
  function setPaused(value: boolean) {
    paused = value
    controls.enabled = !paused
    cancelAnimationFrame(frame)
    lastTime = 0
    if (!paused && !document.hidden) { resize(); frame = requestAnimationFrame(animate) }
    expose()
  }
  function visibilityChanged() { cancelAnimationFrame(frame); lastTime = 0; if (!paused && !document.hidden) frame = requestAnimationFrame(animate) }
  const observer = new ResizeObserver(resize)
  resources.observer = observer
  observer.observe(host)
  document.addEventListener('visibilitychange', visibilityChanged)
  resources.visibilityListener = visibilityChanged
  controls.addEventListener('change', () => { if (!paused && options.reducedMotion) render() })
  resize(); setScene(0); host.dataset.ready = 'true'
  return {
    setScene, setContext, setPerspective, setPaused, resize,
    setLine(id) { line = id; expose() },
    getEvidence: evidence, inspectObject,
    capturePng() { if (disposed) throw new Error('三维场景已关闭。'); render(); return renderer.domElement.toDataURL('image/png') },
    dispose: cleanup,
  }
  } catch (error) { cleanup(); throw error }
}
