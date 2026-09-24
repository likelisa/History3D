import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { StoryPackage } from './storyData'

type ViewMode = 'route' | 'person'
type Props = {
  story: StoryPackage
  selected: number
  view: ViewMode
  onSelect: (index: number) => void
  onFailure: (message: string) => void
}

function label(text: string, highlight = false) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = highlight ? '#4d302a' : '#263e3b'
  ctx.beginPath()
  ctx.roundRect(3, 12, 506, 106, 18)
  ctx.fill()
  ctx.font = 'bold 52px "PingFang SC", sans-serif'
  ctx.fillStyle = '#fff9eb'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 67)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  )
  sprite.scale.set(3.1, 0.78, 1)
  sprite.position.y = 2.55
  sprite.renderOrder = 3
  return sprite
}
function makeMarker(index: number, title: string) {
  const group = new THREE.Group()
  group.userData.stepIndex = index
  const accent = index === 5 ? 0x8d5343 : 0xb37139
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.76, 0.9, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: 0xe2c290, roughness: 1 }),
  )
  base.position.y = 0.1
  group.add(base)
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.3, 1, 12),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 }),
  )
  stem.position.y = 0.62
  stem.castShadow = true
  group.add(stem)
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 12),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }),
  )
  cap.position.y = 1.25
  cap.castShadow = true
  group.add(cap)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.96, 0.055, 6, 30),
    new THREE.MeshBasicMaterial({ color: accent }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.07
  group.add(ring)
  group.add(label(title === '再次被俘' ? '被俘 · 未定位' : title, index === 5))
  return group
}
function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    if (mesh.material)
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
  })
}
export function RouteWorld({
  story,
  selected,
  view,
  onSelect,
  onFailure,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const markerRef = useRef<THREE.Group[]>([])
  const personRef = useRef<THREE.Group | null>(null)
  const selectedRef = useRef(selected)
  const desiredPosition = useRef(new THREE.Vector3(0, 21, 32))
  const desiredTarget = useRef(new THREE.Vector3(0, 0, 0))
  const fly = useRef(false)
  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      onFailure('浏览器无法启动 WebGL，请检查硬件加速设置。')
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.22
    container.appendChild(renderer.domElement)
    renderer.domElement.setAttribute(
      'aria-label',
      '张骞归途的可旋转三维路线示意，点击节点切换章节',
    )
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#d6c7ad')
    scene.fog = new THREE.Fog('#d6c7ad', 35, 90)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120)
    camera.position.set(0, 21, 32)
    cameraRef.current = camera
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 4
    controls.maxDistance = 65
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controlsRef.current = controls
    controls.addEventListener('start', () => {
      fly.current = false
    })
    scene.add(new THREE.HemisphereLight('#fff5db', '#9b7558', 2.9))
    const sun = new THREE.DirectionalLight('#fff0c9', 3.5)
    sun.position.set(-10, 20, 15)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, {
      left: -25,
      right: 25,
      top: 22,
      bottom: -22,
    })
    scene.add(sun)
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 30, 52, 36),
      new THREE.MeshStandardMaterial({
        color: '#d6b485',
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    )
    sand.rotation.x = -Math.PI / 2
    sand.receiveShadow = true
    scene.add(sand)
    // Designed terrain conveys a southern mountain corridor; it carries no geographic measurements.
    for (let i = 0; i < 18; i++) {
      const x = -22 + i * 2.6
      const h = 2.1 + (i % 5) * 0.72
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(2.5 + (i % 3) * 0.5, h, 4),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? '#9f927d' : '#b9a991',
          roughness: 1,
          flatShading: true,
        }),
      )
      mountain.position.set(x, h / 2 - 0.1, -11.5 + Math.sin(i * 0.8) * 1.3)
      mountain.rotation.y = i * 0.43
      mountain.castShadow = true
      scene.add(mountain)
    }
    for (let i = 0; i < 20; i++) {
      const x = -21 + i * 2.25
      const z = 8.5 + Math.sin(i * 1.7) * 2
      const dune = new THREE.Mesh(
        new THREE.SphereGeometry(
          1.4 + (i % 3) * 0.4,
          12,
          6,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? '#c6a879' : '#e0c595',
          roughness: 1,
        }),
      )
      dune.scale.set(1, 0.24, 0.6)
      dune.position.set(x, -0.02, z)
      scene.add(dune)
    }
    const points = story.steps.map(
      (s) => new THREE.Vector3(s.position[0], 0.16, s.position[2]),
    )
    const path = new THREE.CatmullRomCurve3(
      points.slice(0, 5),
      false,
      'centripetal',
    )
    const road = new THREE.Mesh(
      new THREE.TubeGeometry(path, 100, 0.105, 8, false),
      new THREE.MeshStandardMaterial({ color: '#674c36', roughness: 0.9 }),
    )
    scene.add(road)
    const dash = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([points[4], points[5]]),
      new THREE.LineDashedMaterial({
        color: '#815e50',
        dashSize: 0.42,
        gapSize: 0.3,
      }),
    )
    dash.computeLineDistances()
    scene.add(dash)
    markerRef.current = story.steps.map((step, index) => {
      const marker = makeMarker(index, step.title)
      marker.position.set(step.position[0], 0, step.position[2])
      scene.add(marker)
      return marker
    })
    const traveler = new THREE.Group()
    personRef.current = traveler
    const coat = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.25, 10),
      new THREE.MeshStandardMaterial({ color: '#273d3b', roughness: 1 }),
    )
    coat.position.y = 0.63
    traveler.add(coat)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 10),
      new THREE.MeshStandardMaterial({ color: '#c79568' }),
    )
    head.position.y = 1.43
    traveler.add(head)
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.25, 0.09, 12),
      new THREE.MeshStandardMaterial({ color: '#273d3b' }),
    )
    hat.position.y = 1.6
    traveler.add(hat)
    traveler.position.set(points[0].x + 1, 0, points[0].z + 1.35)
    scene.add(traveler)
    const resize = () => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
      renderer.setSize(rect.width, rect.height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    const pointer = new THREE.Vector2(),
      raycaster = new THREE.Raycaster()
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
      const hit = raycaster.intersectObjects(markerRef.current, true)[0]
      let object: THREE.Object3D | undefined = hit?.object
      while (object && !Number.isInteger(object.userData.stepIndex))
        object = object.parent ?? undefined
      if (object && Number.isInteger(object.userData.stepIndex))
        onSelect(object.userData.stepIndex)
    }
    renderer.domElement.addEventListener('pointerdown', pointerdown)
    renderer.domElement.addEventListener('pointerup', pointerup)
    renderer.setAnimationLoop(() => {
      if (fly.current) {
        camera.position.lerp(desiredPosition.current, 0.06)
        controls.target.lerp(desiredTarget.current, 0.06)
        if (camera.position.distanceTo(desiredPosition.current) < 0.05) {
          fly.current = false
        }
      }
      const focus = story.steps[selectedRef.current].position
      traveler.position.lerp(
        new THREE.Vector3(focus[0] + 0.95, 0, focus[2] + 1.15),
        0.055,
      )
      markerRef.current.forEach((marker, index) =>
        marker.scale.setScalar(index === selectedRef.current ? 1.18 : 1),
      )
      controls.update()
      renderer.render(scene, camera)
    })
    return () => {
      observer.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', pointerdown)
      renderer.domElement.removeEventListener('pointerup', pointerup)
      dispose(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      cameraRef.current = null
      controlsRef.current = null
      markerRef.current = []
      personRef.current = null
    }
  }, [story, onSelect, onFailure])
  useEffect(() => {
    const camera = cameraRef.current,
      controls = controlsRef.current
    if (!camera || !controls) return
    selectedRef.current = selected
    markerRef.current.forEach((marker) =>
      marker.traverse((object) => {
        if (object instanceof THREE.Sprite) object.visible = view === 'route'
      }),
    )
    const p = story.steps[selected].position
    if (view === 'person') {
      desiredPosition.current.set(p[0] + 2.6, 1.7, p[2] + 4.2)
      desiredTarget.current.set(p[0], 1, p[2])
    } else {
      desiredPosition.current.set(p[0] * 0.45, 18, 29)
      desiredTarget.current.set(p[0] * 0.4, 0, p[2] * 0.35)
    }
    fly.current = true
  }, [story, selected, view])
  return <div className="journey-canvas" ref={host} />
}
