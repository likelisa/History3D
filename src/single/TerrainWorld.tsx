import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ScenePackage } from './data'
import { createActors, poseActors } from './SceneActors'

export type CameraMode = 'overview' | 'walk'
export type StepDirection = 'forward' | 'back' | 'left' | 'right'
type Props = {
  story: ScenePackage
  mode: CameraMode
  beat: number
  reset: number
  command: { serial: number; direction: StepDirection }
  onBeat: (index: number) => void
  onStatus: (status: string, fps: number, progress: number) => void
  onError: (message: string) => void
  playing: boolean
  onPlaybackEnd: () => void
}
const routeX = (z: number) =>
  Math.sin(z * 0.085) * 0.75 + Math.cos(z * 0.18) * 0.34
const heightAt = (x: number, z: number) => {
  const side = Math.max(0, x - 3.2)
  return (
    0.035 * Math.sin(z * 0.55) +
    0.045 * Math.cos(x * 0.7 + z * 0.3) +
    side * 0.08 +
    Math.pow(side, 1.28) * 0.035
  )
}
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}
function ground() {
  const geo = new THREE.PlaneGeometry(64, 74, 128, 148)
  const pos = geo.attributes.position,
    colors = [] as number[]
  const low = new THREE.Color('#aa9980'),
    high = new THREE.Color('#c6b39a')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = -pos.getY(i),
      h = heightAt(x, z)
    pos.setZ(i, h)
    const tone =
      0.36 +
      0.28 * Math.sin(x * 0.6 + z * 0.28) +
      0.08 * Math.cos(x * 3.1 - z * 1.9)
    const c = low.clone().lerp(high, THREE.MathUtils.clamp(tone, 0, 1))
    colors.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  return mesh
}
function track() {
  const coords: number[] = [],
    uvs: number[] = []
  const count = 116
  for (let i = 0; i <= count; i++) {
    const z = 21 - (i * 46) / count,
      x = routeX(z),
      edge = 1.45 + 0.08 * Math.sin(z * 1.2)
    for (const side of [-1, 1]) {
      const xx = x + edge * side
      coords.push(xx, heightAt(xx, z) + 0.025, z)
      uvs.push(side === -1 ? 0 : 1, (i / count) * 12)
    }
  }
  const indices = []
  for (let i = 0; i < count; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#b5a188'
  ctx.fillRect(0, 0, 512, 512)
  const rand = seeded(812)
  for (let i = 0; i < 4600; i++) {
    const x = rand() * 512,
      y = rand() * 512,
      size = 0.3 + rand() * 2.5
    ctx.fillStyle =
      i % 3 === 0 ? '#8d7d68' : i % 2 === 0 ? '#d5c3a6' : '#ac967b'
    ctx.globalAlpha = 0.15 + rand() * 0.32
    ctx.fillRect(x, y, size * 1.4, size)
  }
  ctx.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: texture,
      color: '#b2a38e',
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  )
}
function ridge(color: string, xBase: number, seed: number, height: number) {
  const rand = seeded(seed),
    verts: number[] = [],
    colors: number[] = []
  const dark = new THREE.Color(color),
    light = dark.clone().multiplyScalar(1.15)
  const ridgeLine = Array.from({ length: 37 }, (_, i) => ({
    z: -36 + i * 2,
    crestX: xBase + rand() * 3,
    peak: height * (0.58 + rand() * 0.55),
  }))
  const triangle = (a: number[], b: number[], c: number[], shade: number) => {
    for (const point of [a, b, c]) {
      verts.push(...point)
      const tint = light.clone().lerp(dark, shade)
      colors.push(tint.r, tint.g, tint.b)
    }
  }
  for (let i = 0; i < ridgeLine.length - 1; i++) {
    const a = ridgeLine[i],
      b = ridgeLine[i + 1]
    const fa = [xBase - 5, 0, a.z],
      fb = [xBase - 5, 0, b.z]
    const ca = [a.crestX, a.peak, a.z],
      cb = [b.crestX, b.peak, b.z]
    const ba = [xBase + 7, 0, a.z],
      bb = [xBase + 7, 0, b.z]
    triangle(fa, ca, fb, 0.36 + rand() * 0.18)
    triangle(ca, cb, fb, 0.35 + rand() * 0.2)
    triangle(ca, ba, cb, 0.68 + rand() * 0.2)
    triangle(ba, bb, cb, 0.68 + rand() * 0.18)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: 1,
    }),
  )
}
function scatter(scene: THREE.Scene) {
  const rand = seeded(8841),
    pebbleGeo = new THREE.DodecahedronGeometry(0.12, 0)
  const material = new THREE.MeshStandardMaterial({
    color: '#b3a18a',
    roughness: 1,
  })
  const gravel = new THREE.InstancedMesh(pebbleGeo, material, 900)
  const dummy = new THREE.Object3D(),
    c = new THREE.Color()
  for (let i = 0; i < 900; i++) {
    const z = -32 + rand() * 64,
      side = rand() < 0.5 ? -1 : 1,
      x = routeX(z) + side * (1.8 + rand() * 13)
    const size = 0.25 + Math.pow(rand(), 4) * 2.9
    dummy.position.set(x, heightAt(x, z) + 0.04 * size, z)
    dummy.scale.set(
      size * (0.8 + rand()),
      size * (0.25 + rand() * 0.35),
      size * (0.7 + rand()),
    )
    dummy.rotation.set(rand() * 1.5, rand() * 6.3, rand() * 1.2)
    dummy.updateMatrix()
    gravel.setMatrixAt(i, dummy.matrix)
    c.set(i % 5 === 0 ? '#7e7c73' : i % 3 === 0 ? '#d0c1a8' : '#9b8d7b')
    gravel.setColorAt(i, c)
  }
  gravel.instanceMatrix.needsUpdate = true
  gravel.castShadow = true
  gravel.receiveShadow = true
  scene.add(gravel)
  return gravel
}
function boulder() {
  const g = new THREE.Group(),
    palette = ['#887b70', '#aa9784', '#776e66']
  const forms: [[number, number, number], [number, number, number]][] = [
    [
      [0, 0.7, 0],
      [1.5, 0.9, 1.1],
    ],
    [
      [0.85, 0.55, 0.5],
      [0.65, 0.65, 0.65],
    ],
    [
      [-0.6, 0.45, -0.45],
      [0.7, 0.55, 0.62],
    ],
  ]
  forms.forEach(([position, scale], i) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: palette[i],
        roughness: 1,
        flatShading: true,
      }),
    )
    mesh.position.set(...position)
    mesh.scale.set(...scale)
    mesh.rotation.set(0.1 * i, 0.45 * i, 0.18 * i)
    mesh.castShadow = true
    g.add(mesh)
  })
  return g
}
function marker(index: number) {
  const group = new THREE.Group()
  group.userData.beatIndex = index
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.045, 8, 30),
    new THREE.MeshBasicMaterial({ color: '#b8d1c0' }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.08
  group.add(ring)
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 14, 10),
    new THREE.MeshStandardMaterial({
      color: index === 2 ? '#c07964' : '#e7d9b9',
      emissive: '#604832',
      emissiveIntensity: 0.22,
    }),
  )
  dot.position.y = 0.56
  group.add(dot)
  return group
}
function dispose(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    if (m.material)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const value of Object.values(mat))
          if (value instanceof THREE.Texture) value.dispose()
        mat.dispose()
      }
  })
}

export function TerrainWorld({
  story,
  mode,
  beat,
  reset,
  command,
  onBeat,
  onStatus,
  onError,
  playing,
  onPlaybackEnd,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null),
    cameraRef = useRef<THREE.PerspectiveCamera | null>(null),
    controlsRef = useRef<OrbitControls | null>(null)
  const modeRef = useRef(mode),
    playingRef = useRef(playing),
    timeRef = useRef(0),
    walk = useRef({ x: routeX(18), z: 18, yaw: 0, pitch: -0.05 }),
    keys = useRef(new Set<string>()),
    markers = useRef<THREE.Group[]>([]),
    asset = useRef('岩体占位 · 候选待加载'),
    fpsRef = useRef(0),
    lastReport = useRef(0)
  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      onError('WebGL 启动失败，请检查浏览器硬件加速。')
      return
    }
    let alive = true
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)
    renderer.domElement.setAttribute(
      'aria-label',
      '可漫游的山前路段，使用 W A S D 行走，拖动画面转向',
    )
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#b5bdbe')
    scene.fog = new THREE.FogExp2('#c2bdb0', 0.016)
    sceneRef.current = scene
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(85, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'varying vec3 vPos; void main(){float h=smoothstep(-0.16,0.52,normalize(vPos).y);gl_FragColor=vec4(mix(vec3(0.76,0.77,0.74),vec3(0.45,0.57,0.63),h),1.0);}',
      }),
    )
    sky.frustumCulled = false
    scene.add(sky)
    const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 170)
    cameraRef.current = camera
    camera.position.set(-15, 11, 24)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 3
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI / 2 - 0.01
    controls.target.set(0, 0, -5)
    controlsRef.current = controls
    scene.add(new THREE.HemisphereLight('#e4eff2', '#8d7358', 1.7))
    const sun = new THREE.DirectionalLight('#ffe3ad', 2.4)
    sun.position.set(-15, 22, 8)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -36
    sun.shadow.camera.right = 36
    sun.shadow.camera.top = 38
    sun.shadow.camera.bottom = -38
    scene.add(sun)
    scene.add(
      ground(),
      track(),
      ridge('#93898a', 28, 40, 16),
      ridge('#746b69', 22, 91, 9),
    )
    scatter(scene)
    const actors = createActors(story.props, scene)
    markers.current = story.beats.map((point, index) => {
      const group = marker(index)
      group.position.set(
        point.position[0],
        heightAt(point.position[0], point.position[2]),
        point.position[2],
      )
      scene.add(group)
      return group
    })
    const rockGroup = new THREE.Group()
    rockGroup.position.set(6, heightAt(6, -2), -2)
    scene.add(rockGroup)
    const fallback = boulder()
    rockGroup.add(fallback)
    if (story.rockAsset)
      new GLTFLoader().load(
        `/story/south-detour/${story.rockAsset}`,
        (gltf) => {
          if (!alive) {
            dispose(gltf.scene)
            return
          }
          const model = gltf.scene,
            box = new THREE.Box3().setFromObject(model),
            size = box.getSize(new THREE.Vector3()),
            max = Math.max(size.x, size.y, size.z)
          if (!Number.isFinite(max) || max <= 0) {
            dispose(model)
            asset.current = 'GLB 尺寸无效，使用程序岩体'
            return
          }
          model.scale.multiplyScalar(2.6 / max)
          model.updateMatrixWorld(true)
          const fitted = new THREE.Box3().setFromObject(model),
            center = fitted.getCenter(new THREE.Vector3())
          model.position.add(
            new THREE.Vector3(-center.x, -fitted.min.y, -center.z),
          )
          model.traverse((o) => {
            o.castShadow = true
            o.receiveShadow = true
          })
          rockGroup.remove(fallback)
          dispose(fallback)
          rockGroup.add(model)
          asset.current = 'Tripo 岩体候选已加载 · 地貌示意'
        },
        undefined,
        () => {
          if (alive) asset.current = '程序岩体 · Tripo 候选加载失败'
        },
      )
    else asset.current = '程序岩体 · 候选未采用'
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
    const down = (e: KeyboardEvent) => {
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      ) {
        keys.current.add(e.code)
        if (modeRef.current === 'walk') e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    let lastPointer: [number, number] | null = null,
      clickStart: [number, number] | null = null
    const pointerDown = (e: PointerEvent) => {
      lastPointer = [e.clientX, e.clientY]
      clickStart = [e.clientX, e.clientY]
    }
    const pointerMove = (e: PointerEvent) => {
      if (modeRef.current !== 'walk' || !lastPointer || !e.buttons) return
      walk.current.yaw -= (e.clientX - lastPointer[0]) * 0.004
      walk.current.pitch = THREE.MathUtils.clamp(
        walk.current.pitch - (e.clientY - lastPointer[1]) * 0.003,
        -0.52,
        0.42,
      )
      lastPointer = [e.clientX, e.clientY]
    }
    const pointerUp = (e: PointerEvent) => {
      lastPointer = null
      if (
        !clickStart ||
        Math.hypot(e.clientX - clickStart[0], e.clientY - clickStart[1]) > 5
      )
        return
      const rect = renderer.domElement.getBoundingClientRect(),
        pointer = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(markers.current, true)[0]
      let obj: THREE.Object3D | undefined = hit?.object
      while (obj && !Number.isInteger(obj.userData.beatIndex))
        obj = obj.parent ?? undefined
      if (obj && Number.isInteger(obj.userData.beatIndex))
        onBeat(obj.userData.beatIndex)
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    const clock = new THREE.Clock()
    let frames = 0,
      lastFps = 0
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05)
      if (playingRef.current) {
        timeRef.current = Math.min(story.performance.duration, timeRef.current + dt)
        const nextBeat = story.performance.times.reduce((result, start, index) => timeRef.current >= start ? index : result, 0)
        if (nextBeat !== currentBeat.current) {
          currentBeat.current = nextBeat
          onBeat(nextBeat)
        }
        if (timeRef.current >= story.performance.duration) {
          playingRef.current = false
          onPlaybackEnd()
        }
      }
      poseActors(actors, timeRef.current, currentBeat.current)
      frames++
      if (modeRef.current === 'walk') {
        const pos = walk.current,
          speed = 3.1 * dt
        const f =
          (keys.current.has('KeyW') || keys.current.has('ArrowUp') ? 1 : 0) -
          (keys.current.has('KeyS') || keys.current.has('ArrowDown') ? 1 : 0)
        const side =
          (keys.current.has('KeyD') || keys.current.has('ArrowRight') ? 1 : 0) -
          (keys.current.has('KeyA') || keys.current.has('ArrowLeft') ? 1 : 0)
        pos.x += speed * (Math.sin(pos.yaw) * f + Math.cos(pos.yaw) * side)
        pos.z += speed * (-Math.cos(pos.yaw) * f + Math.sin(pos.yaw) * side)
        pos.z = THREE.MathUtils.clamp(pos.z, -23, 20)
        pos.x = THREE.MathUtils.clamp(
          pos.x,
          routeX(pos.z) - 3.2,
          routeX(pos.z) + 3.2,
        )
        camera.position.set(pos.x, heightAt(pos.x, pos.z) + 1.7, pos.z)
        camera.rotation.set(pos.pitch, pos.yaw, 0, 'YXZ')
      } else controls.update()
      renderer.render(scene, camera)
      const now = performance.now()
      if (now - lastReport.current > 1500) {
        lastFps = Math.round(
          (frames * 1000) / Math.max(1, now - lastReport.current),
        )
        fpsRef.current = Math.min(lastFps, 144)
        frames = 0
        lastReport.current = now
        onStatus(
          asset.current,
          Math.min(lastFps, 144),
          Math.round(((20 - walk.current.z) / 43) * 100),
        )
      }
    })
    return () => {
      alive = false
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.dispose()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      dispose(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      markers.current = []
      keys.current.clear()
    }
  }, [story, onBeat, onStatus, onError, onPlaybackEnd])
  useEffect(() => { playingRef.current = playing }, [playing])
  const currentBeat = useRef(beat)
  useEffect(() => {
    currentBeat.current = beat
    if (!playingRef.current) timeRef.current = story.performance.times[beat] ?? 0
  }, [beat, story])
  useEffect(() => {
    modeRef.current = mode
    markers.current.forEach((item) => {
      item.visible = mode === 'overview'
    })
    const camera = cameraRef.current,
      controls = controlsRef.current
    if (!camera || !controls) return
    if (mode === 'walk') {
      controls.enabled = false
      const p = walk.current
      camera.position.set(p.x, heightAt(p.x, p.z) + 1.7, p.z)
      camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ')
    } else {
      controls.enabled = true
      camera.position.set(-15, 11, 24)
      controls.target.set(0, 0, -5)
      controls.update()
    }
  }, [mode, story])
  useEffect(() => {
    markers.current.forEach((item, index) =>
      item.scale.setScalar(index === beat ? 1.28 : 1),
    )
    if (modeRef.current === 'overview' && cameraRef.current && controlsRef.current) {
      const focusZ = beat === 0 ? 8 : beat === 1 ? -2 : -7
      cameraRef.current.position.set(11, 7.5, focusZ + 12)
      controlsRef.current.target.set(0, .8, focusZ)
      controlsRef.current.update()
    }
  }, [beat, story])
  useEffect(() => {
    if (reset === 0) return
    timeRef.current = 0
    currentBeat.current = 0
    walk.current = { x: routeX(18), z: 18, yaw: 0, pitch: -0.05 }
    if (modeRef.current === 'walk' && cameraRef.current) {
      const p = walk.current
      cameraRef.current.position.set(p.x, heightAt(p.x, p.z) + 1.7, p.z)
      cameraRef.current.rotation.set(p.pitch, p.yaw, 0, 'YXZ')
    }
  }, [reset])
  useEffect(() => {
    if (!command.serial || modeRef.current !== 'walk') return
    const position = walk.current
    const forward =
      command.direction === 'forward'
        ? 1
        : command.direction === 'back'
          ? -1
          : 0
    const side =
      command.direction === 'right' ? 1 : command.direction === 'left' ? -1 : 0
    position.x +=
      Math.sin(position.yaw) * forward + Math.cos(position.yaw) * side
    position.z +=
      -Math.cos(position.yaw) * forward + Math.sin(position.yaw) * side
    position.z = THREE.MathUtils.clamp(position.z, -23, 20)
    position.x = THREE.MathUtils.clamp(
      position.x,
      routeX(position.z) - 3.2,
      routeX(position.z) + 3.2,
    )
    cameraRef.current?.position.set(
      position.x,
      heightAt(position.x, position.z) + 1.7,
      position.z,
    )
    onStatus(
      asset.current,
      fpsRef.current,
      Math.round(((20 - position.z) / 43) * 100),
    )
  }, [command, onStatus])
  return <div className="single-world" ref={host} />
}
