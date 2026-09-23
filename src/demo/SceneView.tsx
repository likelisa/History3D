import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { AssetStates, Package } from './cases'

export type View = 'overview' | 'human' | 'top'
type Props = {
  pack: Package
  view: View
  reset: number
  selected: string
  localModel: string | null
  onSelect: (id: string) => void
  onAssets: (states: AssetStates) => void
  onError: (message: string) => void
}
const colors = {
  wood: '#855c3d',
  rail: '#b28b61',
  stone: '#bdab8b',
  cargo: '#ac7850',
  person: '#1d7569',
}
function box(
  parent: THREE.Object3D,
  size: number[],
  pos: number[],
  color: string,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(size as [number, number, number])),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
  )
  mesh.position.set(...(pos as [number, number, number]))
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
function primitive(kind: string, dims: number[]) {
  const g = new THREE.Group()
  const [w, h, d] = dims
  if (kind === 'bridge') {
    box(g, [w, 0.25, d], [0, 0.25, 0], colors.wood)
    for (let x = -w / 2; x <= w / 2; x += 0.5)
      box(g, [0.05, 0.05, d], [x, 0.4, 0], colors.rail)
    for (const z of [-d / 2, d / 2]) {
      box(g, [w, 0.12, 0.12], [0, h, z], colors.rail)
      for (let x = -w / 2; x <= w / 2; x += 1.5)
        box(g, [0.12, h, 0.12], [x, h / 2, z], colors.wood)
    }
    for (const x of [-4, 4]) box(g, [0.35, 1.5, d], [x, -0.4, 0], colors.wood)
  } else if (kind === 'gate') {
    for (const z of [-d / 2 + 0.2, d / 2 - 0.2])
      box(g, [0.35, h, 0.35], [0, h / 2, z], colors.wood)
    box(g, [0.55, 0.35, d + 0.6], [0, h - 0.15, 0], colors.rail)
    box(g, [1.2, 0.18, d + 0.9], [0, h + 0.15, 0], colors.wood)
  } else if (kind === 'cargo') {
    for (const [x, y, z] of [
      [-0.5, 0.4, -0.45],
      [0.5, 0.4, -0.45],
      [-0.5, 0.4, 0.5],
      [0.1, 1.05, 0],
    ]) {
      box(g, [0.85, 0.7, 0.8], [x, y, z], colors.cargo)
      box(g, [0.9, 0.07, 0.84], [x, y + 0.12, z], colors.rail)
    }
  } else if (kind === 'person') {
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshStandardMaterial({ color: colors.person }),
    )
    head.position.y = 1.54
    g.add(head)
    box(g, [0.4, 0.65, 0.25], [0, 1.03, 0], colors.person)
    for (const x of [-0.12, 0.12])
      box(g, [0.14, 0.72, 0.17], [x, 0.36, 0], colors.person)
  } else box(g, [w, h, d], [0, h / 2, 0], colors.stone)
  return g
}
function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    if (mesh.material)
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) value.dispose()
        m.dispose()
      }
  })
}
export function SceneView({
  pack,
  view,
  reset,
  selected,
  localModel,
  onSelect,
  onAssets,
  onError,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rootsRef = useRef(new Map<string, THREE.Group>())
  const sceneRef = useRef<THREE.Scene | null>(null)
  const selectionRef = useRef<THREE.BoxHelper | null>(null)
  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      onError('浏览器无法启动 WebGL，请启用硬件加速后重试。')
      return
    }
    let alive = true
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#e8e6dc')
    scene.fog = new THREE.Fog('#e8e6dc', 40, 100)
    sceneRef.current = scene
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    container.appendChild(renderer.domElement)
    renderer.domElement.setAttribute(
      'aria-label',
      '可拖动旋转、滚轮缩放、点击物件的三维案例',
    )
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 180)
    cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 2
    controls.maxDistance = 50
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controlsRef.current = controls
    const isModel = pack.entities[0]?.render_kind === 'model'
    camera.position.set(
      ...((isModel ? [7, 5, 8] : [22, 17, 22]) as [number, number, number]),
    )
    controls.target.set(0, isModel ? 1 : 0.5, 0)
    controls.update()
    scene.add(new THREE.HemisphereLight('#ffffff', '#877353', 2.6))
    const key = new THREE.DirectionalLight('#fff5dd', 3)
    key.position.set(-10, 18, 12)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    Object.assign(key.shadow.camera, {
      left: -20,
      right: 20,
      top: 16,
      bottom: -16,
    })
    key.shadow.bias = -0.0005
    scene.add(key)
    box(scene, [32, 0.3, 22], [0, isModel ? -0.15 : -0.95, 0], '#d8ceb8')
    if (!isModel) {
      box(scene, [9, 0.08, 22], [0, -0.73, 0], '#6c9fa0')
      for (const x of [-11, 11])
        box(scene, [10, 0.65, 22], [x, -0.47, 0], '#c1c5a7')
      for (const x of [-11, 11])
        box(scene, [10, 0.05, 3], [x, -0.1, 0], '#d8c8a5')
      for (const [x, z] of [
        [-13, -6],
        [-10, -8],
        [12, 6],
        [14, -6],
      ]) {
        box(scene, [0.35, 2, 0.35], [x, 1, z], colors.wood)
        const tree = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.4, 0),
          new THREE.MeshStandardMaterial({ color: '#758b6b', roughness: 1 }),
        )
        tree.position.set(x, 2.4, z)
        scene.add(tree)
      }
    }
    const grid = new THREE.GridHelper(32, 32, '#b3b9af', '#cbd0c5')
    grid.position.y = isModel ? 0.005 : -0.06
    scene.add(grid)
    const roots = new Map<string, THREE.Group>()
    rootsRef.current = roots
    const states: AssetStates = {}
    const publish = () => {
      if (alive) onAssets({ ...states })
    }
    for (const entity of pack.entities) {
      const p = pack.scene.placements.find((x) => x.entity_id === entity.id)
      if (!p) continue
      const group = new THREE.Group()
      group.position.fromArray(p.position_m)
      group.rotation.set(...p.rotation_rad, 'XYZ')
      group.userData.entityId = entity.id
      scene.add(group)
      roots.set(entity.id, group)
      const uri =
        localModel && isModel ? localModel : p.asset || p.candidate_asset
      if (!uri) {
        group.add(primitive(entity.render_kind, entity.dimensions_m))
        states[entity.id] = { status: 'ready', message: '程序几何 · 演示尺寸' }
        continue
      }
      const fallback = new THREE.Mesh(
        new THREE.BoxGeometry(...entity.dimensions_m),
        new THREE.MeshStandardMaterial({
          color: '#d78b32',
          transparent: true,
          opacity: 0.5,
        }),
      )
      fallback.position.y = entity.dimensions_m[1] / 2
      group.add(fallback)
      states[entity.id] = { status: 'loading', message: '正在加载 GLB…' }
      new GLTFLoader().load(
        uri.startsWith('blob:') ? uri : pack.base + uri,
        (gltf) => {
          if (!alive) {
            dispose(gltf.scene)
            return
          }
          const model = gltf.scene
          const bounds = new THREE.Box3().setFromObject(model)
          const size = bounds.getSize(new THREE.Vector3())
          const longest = Math.max(size.x, size.y, size.z)
          if (!Number.isFinite(longest) || longest <= 0) {
            dispose(model)
            states[entity.id] = {
              status: 'fallback',
              message: '模型包围盒无效，显示占位',
            }
            publish()
            return
          }
          const scale = Math.max(...entity.dimensions_m) / longest
          model.scale.multiplyScalar(scale)
          model.updateMatrixWorld(true)
          const normalized = new THREE.Box3().setFromObject(model)
          const center = normalized.getCenter(new THREE.Vector3())
          model.position.add(
            new THREE.Vector3(-center.x, -normalized.min.y, -center.z),
          )
          model.traverse((o) => {
            o.castShadow = true
            o.receiveShadow = true
          })
          group.remove(fallback)
          dispose(fallback)
          group.add(model)
          states[entity.id] = {
            status: 'ready',
            message: 'GLB 已加载 · 显示归一化，未校准历史尺寸',
          }
          publish()
        },
        undefined,
        () => {
          if (alive) {
            states[entity.id] = {
              status: 'fallback',
              message: 'GLB 加载失败，保留橙色占位。请补充模型或重新加载。',
            }
            publish()
          }
        },
      )
    }
    publish()
    const pointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    let down = [0, 0]
    const pointerdown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY]
    }
    const pointerup = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects([...roots.values()], true)[0]
      let object: THREE.Object3D | undefined = hit?.object
      while (object && !object.userData.entityId)
        object = object.parent ?? undefined
      if (object?.userData.entityId) onSelect(object.userData.entityId)
    }
    renderer.domElement.addEventListener('pointerdown', pointerdown)
    renderer.domElement.addEventListener('pointerup', pointerup)
    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    renderer.setAnimationLoop(() => {
      controls.update()
      selectionRef.current?.update()
      renderer.render(scene, camera)
    })
    return () => {
      alive = false
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', pointerdown)
      renderer.domElement.removeEventListener('pointerup', pointerup)
      dispose(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      roots.clear()
      sceneRef.current = null
      selectionRef.current = null
    }
  }, [pack, localModel, onSelect, onAssets, onError])
  useEffect(() => {
    const camera = cameraRef.current,
      controls = controlsRef.current
    if (!camera || !controls) return
    const model = pack.entities[0]?.render_kind === 'model'
    const position: [number, number, number] =
      view === 'top'
        ? [0, model ? 12 : 34, 0.1]
        : view === 'human'
          ? pack.scene.spawn.position_m
          : model
            ? [7, 5, 8]
            : [22, 17, 22]
    camera.position.set(...position)
    if (view === 'human') controls.target.fromArray(pack.scene.spawn.look_at_m)
    else controls.target.set(0, 0.5, 0)
    controls.update()
  }, [view, reset, pack, localModel])
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (selectionRef.current) {
      scene.remove(selectionRef.current)
      dispose(selectionRef.current)
      selectionRef.current = null
    }
    const object = rootsRef.current.get(selected)
    if (object) {
      selectionRef.current = new THREE.BoxHelper(object, '#157e76')
      scene.add(selectionRef.current)
    }
  }, [selected, pack, localModel])
  return <div className="scene-canvas" ref={host} />
}
