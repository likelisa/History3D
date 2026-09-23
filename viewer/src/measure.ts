import * as THREE from 'three'

import { distance3 } from '../../contracts/src/geometry.ts'
import type { Vec3 } from '../../contracts/src/types.ts'

export interface MeasureResult {
  a: Vec3
  b: Vec3
  distanceM: number
}

export class Measurer {
  enabled = false

  private readonly points: Vec3[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly group = new THREE.Group()
  private readonly line: THREE.Line
  private readonly dots: THREE.Mesh[] = []

  constructor(private targets: THREE.Object3D[]) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ])
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false }),
    )
    this.line.visible = false
    this.line.renderOrder = 10
    this.group.add(this.line)

    for (let index = 0; index < 2; index += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
      )
      dot.visible = false
      dot.renderOrder = 11
      this.dots.push(dot)
      this.group.add(dot)
    }
  }

  get object(): THREE.Object3D {
    return this.group
  }

  setTargets(targets: THREE.Object3D[]): void {
    this.targets = targets.filter((target) => !isIgnored(target))
  }

  /** 命中则返回 true；未命中不改变测量状态。 */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    this.raycaster.setFromCamera(ndc, camera)
    const hits = this.raycaster.intersectObjects(this.targets, true)
    const hit = hits.find((item) => !isIgnored(item.object))
    if (!hit) return false

    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z]
    // 第三次点击清空旧线并重设 A：已满两点时先丢弃，再作为新的起点。
    if (this.points.length >= 2) this.points.length = 0
    this.points.push(point)
    this.render()
    return true
  }

  clear(): void {
    this.points.length = 0
    this.render()
  }

  get result(): MeasureResult | null {
    if (this.points.length < 2) return null
    const [a, b] = this.points as [Vec3, Vec3]
    return { a, b, distanceM: distance3(a, b) }
  }

  get pending(): Vec3 | null {
    return this.points.length === 1 ? this.points[0] : null
  }

  private render(): void {
    this.dots.forEach((dot, index) => {
      const point = this.points[index]
      dot.visible = Boolean(point)
      if (point) dot.position.set(point[0], point[1], point[2])
    })

    const [a, b] = this.points
    if (a && b) {
      const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute
      positions.setXYZ(0, a[0], a[1], a[2])
      positions.setXYZ(1, b[0], b[1], b[2])
      positions.needsUpdate = true
      this.line.visible = true
    } else {
      this.line.visible = false
    }
  }
}

function isIgnored(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  while (node) {
    if (node.userData.raycastIgnore === true) return true
    node = node.parent
  }
  return false
}
