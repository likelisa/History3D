import * as THREE from 'three'

import {
  cameraEyePosition,
  resolveMove,
} from '../../contracts/src/geometry.ts'
import type { RectBounds } from '../../contracts/src/geometry.ts'
import type { Blocker, Vec2, Vec3 } from '../../contracts/src/types.ts'

export interface WalkerConfig {
  spawnFeet: Vec3
  eyeHeightM: number
  yawRad: number
  pitchRad: number
  moveSpeedMps: number
  radiusM: number
  bounds: RectBounds
  blockers: Blocker[]
  groundY: number
}

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp'])
const BACKWARD_KEYS = new Set(['KeyS', 'ArrowDown'])
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft'])
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight'])

export class Walker {
  feet: Vec2
  yawRad: number
  pitchRad: number
  enabled = false

  private readonly keys = new Set<string>()
  private synthetic: Vec2 = [0, 0]

  constructor(readonly config: WalkerConfig) {
    this.feet = [config.spawnFeet[0], config.spawnFeet[2]]
    this.yawRad = config.yawRad
    this.pitchRad = config.pitchRad
  }

  handleKey(event: KeyboardEvent, pressed: boolean): void {
    if (pressed) {
      this.keys.add(event.code)
    } else {
      this.keys.delete(event.code)
    }
  }

  handleMouseMove(movementX: number, movementY: number): void {
    if (!this.enabled) return
    this.yawRad -= movementX * 0.0022
    const nextPitch = this.pitchRad - movementY * 0.0022
    const limit = Math.PI / 2 - 0.05
    this.pitchRad = Math.min(Math.max(nextPitch, -limit), limit)
  }

  /** 供自动化基准模式注入移动输入，避免依赖真实键鼠。 */
  setSyntheticInput(forward: number, strafe: number): void {
    this.synthetic = [forward, strafe]
  }

  reset(): void {
    this.feet = [this.config.spawnFeet[0], this.config.spawnFeet[2]]
    this.yawRad = this.config.yawRad
    this.pitchRad = this.config.pitchRad
    this.keys.clear()
    this.synthetic = [0, 0]
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) return

    let forward = this.synthetic[0]
    let strafe = this.synthetic[1]
    if (forward === 0 && strafe === 0) {
      for (const code of this.keys) {
        if (FORWARD_KEYS.has(code)) forward += 1
        if (BACKWARD_KEYS.has(code)) forward -= 1
        if (RIGHT_KEYS.has(code)) strafe += 1
        if (LEFT_KEYS.has(code)) strafe -= 1
      }
    }
    if (forward === 0 && strafe === 0) return

    const sin = Math.sin(this.yawRad)
    const cos = Math.cos(this.yawRad)
    const forwardVector: Vec2 = [-sin, -cos]
    const rightVector: Vec2 = [cos, -sin]
    const dx = forwardVector[0] * forward + rightVector[0] * strafe
    const dz = forwardVector[1] * forward + rightVector[1] * strafe
    const step = this.config.moveSpeedMps * deltaSeconds

    const next = resolveMove(
      this.feet,
      [dx * step, dz * step],
      this.config.bounds,
      this.config.blockers,
      this.config.radiusM,
    )
    this.feet = [next.x, next.z]
  }

  applyTo(camera: THREE.PerspectiveCamera): void {
    const eye = cameraEyePosition(
      [this.feet[0], this.config.groundY, this.feet[1]],
      this.config.eyeHeightM,
    )
    camera.position.set(eye[0], eye[1], eye[2])
    camera.rotation.order = 'YXZ'
    camera.rotation.set(this.pitchRad, this.yawRad, 0, 'YXZ')
  }
}
