import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Box3, DataTexture, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three'
import type { SceneFile, SceneObject } from '../contracts/src/types.ts'

const lifecycle = vi.hoisted(() => ({
  render: vi.fn(), rendererDispose: vi.fn(), controlsDispose: vi.fn(), removeCanvas: vi.fn(), observerDisconnect: vi.fn(),
  addListener: vi.fn(), removeListener: vi.fn(),
  geometryDisposals: 0, materialDisposals: 0, textureDisposals: 0,
  failGround: false, width: 720, height: 420,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class TestRenderer {
    shadowMap = { enabled: false, type: 0 }
    capabilities = { getMaxAnisotropy: () => 4 }
    info = { render: { calls: 0, triangles: 0 } }
    domElement = { width: 0, height: 0, style: {}, setAttribute() {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: lifecycle.removeCanvas,
      getBoundingClientRect: () => ({ left: 120, top: 80, width: lifecycle.width, height: lifecycle.height }) }
    setPixelRatio() {}
    setSize(width: number, height: number) { this.domElement.width = width; this.domElement.height = height }
    render(scene: import('three').Scene, camera: import('three').Camera) {
      lifecycle.render(scene, camera)
      scene.traverseVisible((child) => {
        if (child instanceof actual.Mesh) (child.onBeforeRender as unknown as () => void)()
      })
    }
    dispose = lifecycle.rendererDispose
  }
  return { ...actual, WebGLRenderer: TestRenderer }
})
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three')
  return { OrbitControls: class {
    constructor(private camera: import('three').Camera) {}
    target = new Vector3()
    update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true) }
    addEventListener() {}
    dispose = lifecycle.controlsDispose
  } }
})
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } = await import('three')
  return { GLTFLoader: class {
    async parseAsync(bytes: ArrayBuffer) {
      const id = new TextDecoder().decode(bytes)
      const backdrop = ['asset-environment', 'asset-meeting', 'asset-market'].includes(id)
      const geometry = backdrop ? new BoxGeometry(60, .2, 60) : new BoxGeometry(.5, 1.7, .7)
      const texture = new Texture()
      const material = new MeshStandardMaterial({ map: texture })
      geometry.addEventListener('dispose', () => { lifecycle.geometryDisposals++ })
      material.addEventListener('dispose', () => { lifecycle.materialDisposals++ })
      texture.addEventListener('dispose', () => { lifecycle.textureDisposals++ })
      const mesh = new Mesh(geometry, material)
      mesh.position.y = backdrop ? -.1 : .85
      mesh.name = lifecycle.failGround ? 'unidentified-floor' : ({ 'asset-environment': 'Illustrative_valley_terrain', 'asset-meeting': 'Courtyard_floor', 'asset-market': 'Market_courtyard' })[id] ?? id
      const group = new Group()
      group.add(mesh)
      return { scene: group }
    }
  } }
})

import { createStoryWorld } from '../viewer/src/yuezhi/story-world.ts'

const assetIds = ['asset-environment', 'asset-meeting', 'asset-market', 'asset-envoy', 'asset-representative', 'asset-mural-horse']
function fixture(withXiongnu = false) {
  const ids = withXiongnu ? [...assetIds, 'asset-xiongnu'] : assetIds
  const assets = ids.map<SceneFile['assets'][number]>((id) => ({ id, path: `assets/${id}.glb`, dimensionsM: [1, 1, 1], format: 'glb', rights: 'test fixture' }))
  const objects = ['envoy', 'representative', 'mural-horse'].map<SceneObject>((id) => ({ id: `obj-${id}`, briefId: `brief-${id}`, label: id, render: { type: 'asset', assetId: `asset-${id}` }, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensionsM: [1, 1.7, 1], evidence: { dimensions: [], appearance: [], placement: [], quantity: [] } }))
  objects.push({ ...objects[1]!, id: 'obj-local' }, { ...objects[0]!, id: 'obj-companion' })
  if (withXiongnu) objects.push({ ...objects[1]!, id: 'obj-xiongnu', render: { type: 'asset', assetId: 'asset-xiongnu' } })
  const scene: SceneFile = {
    schemaVersion: '0.1.0', storyId: 'zhang-qian-yuezhi', contentRevision: 2, sceneRevision: 2,
    storyPath: 'story.json', sourcesPath: 'sources.json', units: 'm', upAxis: 'Y', handedness: 'right',
    ground: { type: 'plane', y: 0 }, assets, objects, hotspotBindings: [],
    cameras: { firstPerson: { spawnFeet: [0, 0, 0], eyeHeightM: 1.7, yawRad: 0, pitchRad: 0, moveSpeedMps: 2, radiusM: .3 }, overview: { position: [0, 5, 10], target: [0, 0, 0], up: [0, 1, 0] } },
    walkableBounds: { min: [-20, -20], max: [20, 20] }, blockers: [],
  }
  const provenance = ids.map((assetId) => ({ assetId, sha256: createHash('sha256').update(assetId).digest('hex') }))
  const host = { dataset: {}, append: vi.fn(), getBoundingClientRect: () => ({ width: lifecycle.width, height: lifecycle.height }) } as unknown as HTMLElement
  return { host, options: { base: '/packages/test', scene, provenance } }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(lifecycle, { geometryDisposals: 0, materialDisposals: 0, textureDisposals: 0, failGround: false, width: 720, height: 420 })
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('document', { hidden: false, addEventListener: lifecycle.addListener, removeEventListener: lifecycle.removeListener })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect = lifecycle.observerDisconnect })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = url.split('/').at(-1)!.replace('.glb', '')
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(id).buffer }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('story world resource lifecycle (renderer mock)', () => {
  it.each(['grass_medium_01', 'shrub_01'])('picks an actor behind transparent %s using actual pointer coordinates and ray intersections', async (materialName) => {
    const { host, options } = fixture()
    const onObjectInspect = vi.fn()
    const world = await createStoryWorld(host, { ...options, onObjectInspect })
    world.setLine('arrival-2')
    const [scene, camera] = lifecycle.render.mock.calls.at(-1)! as [import('three').Scene, import('three').PerspectiveCamera]
    const actor = scene.getObjectByName('obj-representative')!
    const target = new Box3().setFromObject(actor).getCenter(new Vector3())
    const backdrop = scene.getObjectByName('obj-environment')!
    const transparentPixel = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
    const material = new MeshStandardMaterial({ map: transparentPixel, side: DoubleSide, transparent: materialName.startsWith('grass'), alphaTest: materialName.startsWith('shrub') ? .5 : 0 })
    material.name = materialName
    const foliage = new Mesh(new PlaneGeometry(4, 4), material)
    foliage.position.copy(target).lerp(camera.position, .5)
    foliage.lookAt(camera.position)
    backdrop.add(foliage)
    scene.updateMatrixWorld(true)
    const proofRay = new Raycaster(camera.position, target.clone().sub(camera.position).normalize())
    const hits = proofRay.intersectObjects([backdrop, actor], true)
    expect(hits[0]!.object).toBe(foliage)
    expect(hits.some(hit => hit.object.parent?.parent === actor)).toBe(true)
    const projected = target.clone().project(camera)
    const canvas = vi.mocked(host.append).mock.calls[0]![0] as unknown as { addEventListener: ReturnType<typeof vi.fn>; getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
    const rect = canvas.getBoundingClientRect()
    const event = { button: 0, pointerId: 1, clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2 }
    canvas.addEventListener.mock.calls.find(([type]) => type === 'pointerdown')![1](event)
    canvas.addEventListener.mock.calls.find(([type]) => type === 'pointerup')![1](event)
    expect(onObjectInspect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ objectId: 'obj-representative', context: 'book', sceneId: 'arrival' }))
    expect(JSON.parse(host.dataset.inspectedObject!)).toMatchObject({ objectId: 'obj-representative' })
    expect(world.getEvidence()).toMatchObject({ scene: 0, line: 'arrival-2' })
    world.dispose(); foliage.geometry.dispose(); material.dispose(); transparentPixel.dispose()
  })

  it('keeps an opaque wall in front of an actor as an observation occluder', async () => {
    const { host, options } = fixture()
    const onObjectInspect = vi.fn()
    const world = await createStoryWorld(host, { ...options, onObjectInspect })
    const [scene, camera] = lifecycle.render.mock.calls.at(-1)! as [import('three').Scene, import('three').PerspectiveCamera]
    const actor = scene.getObjectByName('obj-representative')!
    const target = new Box3().setFromObject(actor).getCenter(new Vector3())
    const backdrop = scene.getObjectByName('obj-environment')!
    const material = new MeshStandardMaterial({ side: DoubleSide })
    material.name = 'opaque_stone_wall'
    const wall = new Mesh(new PlaneGeometry(4, 4), material)
    wall.position.copy(target).lerp(camera.position, .5)
    wall.lookAt(camera.position)
    backdrop.add(wall)
    scene.updateMatrixWorld(true)
    const hits = new Raycaster(camera.position, target.clone().sub(camera.position).normalize()).intersectObjects([backdrop, actor], true)
    expect(hits[0]!.object).toBe(wall)
    expect(hits.some(hit => hit.object.parent?.parent === actor)).toBe(true)
    const projected = target.clone().project(camera)
    const canvas = vi.mocked(host.append).mock.calls[0]![0] as unknown as { addEventListener: ReturnType<typeof vi.fn>; getBoundingClientRect(): { left: number; top: number; width: number; height: number } }
    const rect = canvas.getBoundingClientRect()
    const event = { button: 0, pointerId: 1, clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2 }
    canvas.addEventListener.mock.calls.find(([type]) => type === 'pointerdown')![1](event)
    canvas.addEventListener.mock.calls.find(([type]) => type === 'pointerup')![1](event)
    expect(onObjectInspect).not.toHaveBeenCalled()
    expect(host.dataset.inspectedObject).toBeUndefined()
    world.dispose(); wall.geometry.dispose(); material.dispose()
  })

  it('collects observations only from present, verified scene actors and keeps book position', async () => {
    const { host, options } = fixture(true)
    const onObjectInspect = vi.fn()
    const world = await createStoryWorld(host, { ...options, onObjectInspect })
    world.setScene(1)
    world.setLine('meeting-3')
    expect(world.inspectObject('obj-local')).toBe(false)
    expect(world.inspectObject('obj-xiongnu')).toBe(false)
    expect(world.inspectObject('obj-environment')).toBe(false)
    expect(onObjectInspect).not.toHaveBeenCalled()
    expect(world.inspectObject('obj-representative')).toBe(true)
    expect(onObjectInspect).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: 'obj-representative', context: 'book', sceneId: 'meeting', sha256: options.provenance.find(item => item.assetId === 'asset-representative')!.sha256 }))
    world.setContext('captivity')
    expect(world.inspectObject('obj-representative')).toBe(false)
    expect(world.inspectObject('obj-xiongnu')).toBe(true)
    expect(onObjectInspect).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: 'obj-xiongnu', context: 'captivity', sceneId: 'captivity' }))
    expect(world.getEvidence()).toMatchObject({ scene: 1, line: 'meeting-3' })
    world.dispose()
    expect(world.inspectObject('obj-envoy')).toBe(false)
  })
  it('redraws once when a paused canvas changes size and retains pause and story position', async () => {
    const { host, options } = fixture()
    const world = await createStoryWorld(host, options)
    world.setScene(3)
    world.setLine('market-3')
    world.setPaused(true)
    const before = lifecycle.render.mock.calls.length
    lifecycle.width = 960
    lifecycle.height = 540
    world.resize()
    expect(lifecycle.render.mock.calls.length).toBe(before + 1)
    expect(world.getEvidence()).toMatchObject({ paused: true, scene: 3, line: 'market-3', rendering: { width: 960, height: 540 } })
    world.dispose()
    expect(lifecycle.rendererDispose).toHaveBeenCalledTimes(1)
  })

  it('releases the canvas, controls and every decoded asset after failure while assembling objects', async () => {
    const { host, options } = fixture()
    options.scene.objects.push({ ...options.scene.objects[0], id: 'unsupported-box', render: { type: 'primitive', shape: 'box', color: '#fff' } } as SceneObject)
    await expect(createStoryWorld(host, options)).rejects.toThrow('不接受灰盒')
    expect(lifecycle.rendererDispose).toHaveBeenCalledTimes(1)
    expect(lifecycle.controlsDispose).toHaveBeenCalledTimes(1)
    expect(lifecycle.removeCanvas).toHaveBeenCalledTimes(1)
    expect(lifecycle.geometryDisposals).toBe(assetIds.length)
    expect(lifecycle.materialDisposals).toBe(assetIds.length)
    expect(lifecycle.textureDisposals).toBe(assetIds.length)
    expect(host.dataset.ready).toBe('false')
  })

  it('also disconnects observers and listeners after ground validation fails late in initialization', async () => {
    const { host, options } = fixture()
    lifecycle.failGround = true
    await expect(createStoryWorld(host, options)).rejects.toThrow('缺少明确地面网格')
    expect(lifecycle.observerDisconnect).toHaveBeenCalledTimes(1)
    expect(lifecycle.removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(lifecycle.rendererDispose).toHaveBeenCalledTimes(1)
    expect(lifecycle.geometryDisposals).toBe(assetIds.length)
    expect(host.dataset.evidence).toBeUndefined()
  })

  it('uses the reception NPC for the meeting viewpoint and excludes street roles from the meeting', async () => {
    const { host, options } = fixture(true)
    const world = await createStoryWorld(host, options)
    world.setScene(1)
    world.setLine('meeting-3')
    world.setPerspective('host')
    const ids = world.getEvidence().visibleObjects.map((item) => item.objectId)
    expect(ids).toEqual(expect.arrayContaining(['obj-envoy', 'obj-representative', 'obj-companion']))
    expect(ids).not.toContain('obj-local')
    expect(ids).not.toContain('obj-mural-horse')
    expect(ids).not.toContain('obj-xiongnu')
    expect(() => world.setPerspective('passersby')).toThrow('当前场景没有')
    expect(() => world.setPerspective('opponent')).toThrow('当前场景没有')
    expect(world.getEvidence()).toMatchObject({ perspective: 'host', scene: 1, line: 'meeting-3' })
    world.dispose()
  })

  it('shows the adopted Xiongnu NPC in captivity while retaining book position and accumulated scene time', async () => {
    const { host, options } = fixture(true)
    const world = await createStoryWorld(host, options)
    world.setPaused(false)
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1000)
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1167)
    world.setScene(3)
    world.setLine('market-3')
    const elapsed = world.getEvidence().elapsedSeconds
    expect(elapsed).toBeGreaterThan(0)
    world.setContext('captivity')
    world.setPerspective('opponent')
    const captivity = world.getEvidence()
    expect(captivity).toMatchObject({ context: 'captivity', scene: 3, sceneId: 'captivity', line: 'market-3', elapsedSeconds: elapsed, backdrop: 'asset-environment', perspective: 'opponent' })
    expect(captivity.visibleObjects.map((item) => item.objectId)).toEqual(expect.arrayContaining(['obj-envoy', 'obj-xiongnu']))
    expect(captivity.visibleObjects.map((item) => item.objectId)).not.toContain('obj-representative')
    const xiongnu = captivity.visibleObjects.find((item) => item.objectId === 'obj-xiongnu')!
    expect(xiongnu.sha256).toBe(options.provenance.find((item) => item.assetId === 'asset-xiongnu')!.sha256)
    expect(Math.hypot(captivity.camera.position[0] - 1.1, captivity.camera.position[2] + 1.5)).toBeLessThan(3)
    world.setContext('book')
    world.setPerspective('trader')
    expect(world.getEvidence()).toMatchObject({ context: 'book', scene: 3, line: 'market-3', elapsedSeconds: elapsed, perspective: 'trader', backdrop: 'asset-market' })
    expect(world.getEvidence().visibleObjects.map((item) => item.objectId)).not.toContain('obj-xiongnu')
    world.dispose()
  })

  it('does not replace a missing captivity NPC with a remote landscape viewpoint', async () => {
    const { host, options } = fixture()
    const world = await createStoryWorld(host, options)
    expect(() => world.setContext('captivity')).toThrow('真实匈奴 NPC')
    expect(world.getEvidence()).toMatchObject({ context: 'book', sceneId: 'arrival', perspective: 'overview' })
    world.dispose()
  })

  it('rejects a declared Xiongnu asset that is not adopted by its NPC object before rendering', async () => {
    const { host, options } = fixture(true)
    options.scene.objects = options.scene.objects.filter((item) => item.id !== 'obj-xiongnu')
    await expect(createStoryWorld(host, options)).rejects.toThrow('没有被 obj-xiongnu 采用')
    expect(lifecycle.render).not.toHaveBeenCalled()
  })
})
