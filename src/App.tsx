import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101820)

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    )
    camera.position.set(0, 1.8, 6)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x4ade80 }),
    )
    scene.add(cube)

    const grid = new THREE.GridHelper(20, 20, 0x475569, 0x334155)
    scene.add(grid)

    const light = new THREE.DirectionalLight(0xffffff, 2)
    light.position.set(4, 6, 4)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    window.addEventListener('resize', resize)

    const animate = () => {
      cube.rotation.y += 0.005
      renderer.render(scene, camera)
    }
    renderer.setAnimationLoop(animate)

    return () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <main className="app">
      <div className="overlay">
        <h1>History3D</h1>
        <p>Three.js 开发环境已就绪</p>
      </div>
      <div ref={containerRef} className="viewport" />
    </main>
  )
}
