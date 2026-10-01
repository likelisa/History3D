import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface InspectAsset { id: string; label: string; path: string; hash: string; note: string; taskId: string }
export function installInspector(assets: InspectAsset[]) {
  const dialog = document.createElement('dialog')
  dialog.id = 'asset-inspector'
  dialog.setAttribute('aria-label', '查看 Tripo 3D 资产')
  dialog.innerHTML = `<header><h2 id="asset-title"></h2><button id="close-asset">回到壁画</button></header><div id="asset-viewport"></div><p id="asset-status" role="status"></p><p id="asset-note"></p><footer><button id="rotate-left">向左旋转</button><button id="rotate-right">向右旋转</button><button id="zoom-in">放大</button><button id="zoom-out">缩小</button><button id="reset-camera">重置视角</button><button id="retry-asset" hidden>重新加载</button></footer>`
  document.body.append(dialog)
  const viewport = dialog.querySelector<HTMLDivElement>('#asset-viewport')!
  const status = dialog.querySelector<HTMLElement>('#asset-status')!
  let renderer: THREE.WebGLRenderer | undefined
  let controls: OrbitControls | undefined
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let model: THREE.Group | undefined
  let frame = 0
  let sequence = 0
  let selected: InspectAsset | undefined
  const cache = new Map<string, THREE.Group>()
  function resize() {
    if (!renderer || !dialog.open) return
    const rect = viewport.getBoundingClientRect()
    camera.aspect = rect.width / Math.max(rect.height, 1)
    camera.updateProjectionMatrix()
    renderer.setSize(rect.width, rect.height)
  }
  function reset() {
    if (!camera || !controls) return
    camera.position.set(2.2, 1.5, 3.8)
    controls.target.set(0, .95, 0)
    controls.update()
    if (model) model.rotation.y = 0
  }
  function initialize() {
    if (renderer) return
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.domElement.setAttribute('aria-label', '可旋转放大的 Tripo 三维模型')
    viewport.append(renderer.domElement)
    scene = new THREE.Scene()
    scene.background = new THREE.Color('#342c25')
    camera = new THREE.PerspectiveCamera(35, 1, .05, 100)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 1.2
    controls.maxDistance = 8
    scene.add(new THREE.HemisphereLight('#f2e3cc', '#685442', 2.5))
    const light = new THREE.DirectionalLight('#ffead1', 3)
    light.position.set(3, 5, 4); scene.add(light)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.8, 64), new THREE.MeshStandardMaterial({ color: '#625344', roughness: 1 }))
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.015; scene.add(floor)
    reset()
    new ResizeObserver(resize).observe(viewport)
  }
  function animate() {
    if (!dialog.open) return
    controls!.update()
    renderer!.render(scene, camera)
    frame = requestAnimationFrame(animate)
  }
  async function load(asset: InspectAsset) {
    selected = asset
    const token = ++sequence
    status.textContent = '正在读取并核对 Tripo 模型…'
    dialog.querySelector<HTMLElement>('#retry-asset')!.hidden = true
    dialog.querySelector('#asset-title')!.textContent = asset.label
    dialog.querySelector('#asset-note')!.textContent = asset.note
    if (model) { scene.remove(model); model = undefined }
    try {
      let template = cache.get(asset.id)
      if (!template) {
        const response = await fetch(asset.path)
        if (!response.ok) throw new Error('模型文件读取失败')
        const bytes = await response.arrayBuffer()
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
        if (hash !== asset.hash) throw new Error('模型与来源记录不一致')
        const gltf = await new GLTFLoader().parseAsync(bytes, asset.path.slice(0, asset.path.lastIndexOf('/') + 1))
        template = gltf.scene
        const bounds = new THREE.Box3().setFromObject(template)
        const size = bounds.getSize(new THREE.Vector3())
        const scale = 1.9 / Math.max(size.x, size.y, size.z)
        const center = bounds.getCenter(new THREE.Vector3())
        const wrapper = new THREE.Group()
        template.scale.multiplyScalar(scale)
        template.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z).multiplyScalar(scale))
        wrapper.add(template)
        template = wrapper
        cache.set(asset.id, template)
      }
      if (token !== sequence || !dialog.open) return
      model = template.clone(true)
      scene.add(model)
      reset()
      status.textContent = 'Tripo 生成资产 · 拖动旋转，滚轮或双指缩放；也可使用下方按钮'
      dialog.dataset.loaded = asset.id
      dialog.dataset.taskId = asset.taskId
    } catch (error) {
      if (token !== sequence || !dialog.open) return
      status.textContent = error instanceof Error ? error.message : '3D 模型加载失败'
      dialog.querySelector<HTMLElement>('#retry-asset')!.hidden = false
    }
  }
  function open(id: string) {
    const asset = assets.find(a => a.id === id)
    if (!asset) return
    if (!dialog.open) dialog.showModal()
    try { initialize(); resize(); cancelAnimationFrame(frame); animate(); void load(asset) }
    catch { status.textContent = '此设备未能开启 3D 查看，请换用支持 WebGL 的浏览器。' }
  }
  dialog.querySelector('#close-asset')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { ++sequence; cancelAnimationFrame(frame); delete dialog.dataset.loaded })
  dialog.querySelector('#retry-asset')!.addEventListener('click', () => { if (selected) void load(selected) })
  dialog.querySelector('#rotate-left')!.addEventListener('click', () => { if (model) model.rotation.y -= .35 })
  dialog.querySelector('#rotate-right')!.addEventListener('click', () => { if (model) model.rotation.y += .35 })
  for (const [id, factor] of [['zoom-in', .8], ['zoom-out', 1.25]] as const) dialog.querySelector(`#${id}`)!.addEventListener('click', () => {
    if (!controls) return
    const vector = camera.position.clone().sub(controls.target)
    const distance = THREE.MathUtils.clamp(vector.length() * factor, controls.minDistance, controls.maxDistance)
    camera.position.copy(controls.target).add(vector.setLength(distance)); controls.update()
  })
  dialog.querySelector('#reset-camera')!.addEventListener('click', reset)
  return open
}
