import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'

import { Measurer } from '../viewer/src/measure.ts'

/**
 * 测距的点击协议（文档第 8 节）此前没有自动覆盖，只在浏览器里手测过。
 * 这里用真实的 THREE 射线求交驱动 Measurer.pick，而不是复算一遍公式：
 * 相机固定在原点朝 -Z，一块 10 × 10 米的竖直标靶放在 z = -5，
 * 于是每个 NDC 坐标对应的世界命中点可以独立手算出来。
 */
const TARGET_Z = -5

function makeScene() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 0)
  camera.updateMatrixWorld(true)

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
  plane.position.set(0, 0, TARGET_Z)
  plane.updateMatrixWorld(true)

  return { camera, plane }
}

function pickAt(measurer: Measurer, camera: THREE.Camera, x: number, y: number): boolean {
  return measurer.pick(new THREE.Vector2(x, y), camera)
}

describe('测距点击协议', () => {
  let scene: ReturnType<typeof makeScene>
  let measurer: Measurer

  beforeEach(() => {
    scene = makeScene()
    measurer = new Measurer([scene.plane])
  })

  it('第一次点击只记录起点，不产生结果', () => {
    expect(pickAt(measurer, scene.camera, 0, 0)).toBe(true)
    expect(measurer.result).toBeNull()
    expect(measurer.pending?.[2]).toBeCloseTo(TARGET_Z, 6)
  })

  it('第二次点击得到两点直线距离', () => {
    pickAt(measurer, scene.camera, 0, 0)
    pickAt(measurer, scene.camera, 0.5, 0.5)

    const result = measurer.result
    expect(result).not.toBeNull()
    // 独立手算：距离 5 米处，fov 60°/aspect 1 的半高为 5·tan30° = 2.8867513…
    // NDC 0.5 → x = y = 1.4433757…，两点都在 z = -5 平面上，
    // 于是距离 = √(x² + y²) = 2.0412414…
    expect(result?.a[0]).toBeCloseTo(0, 6)
    expect(result?.a[1]).toBeCloseTo(0, 6)
    expect(result?.b[0]).toBeCloseTo(1.4433756729, 6)
    expect(result?.b[1]).toBeCloseTo(1.4433756729, 6)
    expect(result?.distanceM).toBeCloseTo(2.0412414523, 6)
  })

  it('第三次点击清空旧线并重设 A', () => {
    pickAt(measurer, scene.camera, 0, 0)
    pickAt(measurer, scene.camera, 0.5, 0.5)
    expect(measurer.result).not.toBeNull()

    pickAt(measurer, scene.camera, 0, 0)
    expect(measurer.result).toBeNull()
    expect(measurer.pending?.[0]).toBeCloseTo(0, 6)
  })

  it('未命中不改变已有状态', () => {
    pickAt(measurer, scene.camera, 0, 0)
    // 标靶只有 10 × 10：NDC 5 打在 y ≈ 14.43，远超标靶，必然脱靶。
    expect(pickAt(measurer, scene.camera, 0, 5)).toBe(false)
    expect(measurer.pending?.[0]).toBeCloseTo(0, 6)
    expect(measurer.result).toBeNull()
  })

  it('未命中不会消耗配对次数', () => {
    pickAt(measurer, scene.camera, 0, 0)
    pickAt(measurer, scene.camera, 0, 5)
    pickAt(measurer, scene.camera, 0.5, 0.5)

    const result = measurer.result
    expect(result?.a[1]).toBeCloseTo(0, 6)
    expect(result?.b[0]).toBeCloseTo(1.4433756729, 6)
  })

  it('退出测距清空全部选点', () => {
    pickAt(measurer, scene.camera, 0, 0)
    pickAt(measurer, scene.camera, 0.5, 0.5)
    measurer.clear()

    expect(measurer.result).toBeNull()
    expect(measurer.pending).toBeNull()
    expect(measurer.object.children.every((child) => !child.visible)).toBe(true)
  })
})

describe('测距射线目标', () => {
  it('raycastIgnore 的对象不会被拾取', () => {
    const { camera, plane } = makeScene()
    const marker = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial())
    marker.position.set(0, 0, 0)
    marker.userData.raycastIgnore = true
    marker.updateMatrixWorld(true)

    const measurer = new Measurer([marker, plane])
    expect(pickAt(measurer, camera, 0, 0)).toBe(true)
    // 标记方块更靠前，若未被忽略就会命中 z = 2 而不是标靶的 z = -5。
    expect(measurer.pending?.[2]).toBeCloseTo(TARGET_Z, 6)
  })

  it('setTargets 会过滤掉 raycastIgnore 的对象', () => {
    const { camera, plane } = makeScene()
    const marker = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial())
    marker.userData.raycastIgnore = true
    marker.updateMatrixWorld(true)

    const measurer = new Measurer([])
    measurer.setTargets([marker, plane])
    expect(pickAt(measurer, camera, 0, 0)).toBe(true)
    expect(measurer.pending?.[2]).toBeCloseTo(TARGET_Z, 6)
  })
})
