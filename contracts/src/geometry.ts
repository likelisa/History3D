import type { Blocker, Vec2, Vec3 } from './types.ts'

export interface RectBounds {
  min: Vec2
  max: Vec2
}

/** 相机位置 = 脚下位置 + [0, eyeHeightM, 0]；不得把出生点当成眼睛位置再加一次高度。 */
export function cameraEyePosition(spawnFeet: Vec3, eyeHeightM: number): Vec3 {
  return [spawnFeet[0], spawnFeet[1] + eyeHeightM, spawnFeet[2]]
}

/** yaw=0 看向 -Z；yaw=π/2 看向 -X；pitch 为正表示抬头。 */
export function viewDirection(yawRad: number, pitchRad: number): Vec3 {
  const cosPitch = Math.cos(pitchRad)
  return [
    -Math.sin(yawRad) * cosPitch,
    Math.sin(pitchRad),
    -Math.cos(yawRad) * cosPitch,
  ]
}

/** 灰盒几何中心相对底部原点的本地偏移。 */
export function grayBoxCenterOffset(dimensionsM: Vec3): Vec3 {
  return [0, dimensionsM[1] / 2, 0]
}

export function distance3(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function formatMeters(meters: number): string {
  return `${meters.toFixed(2)} 米`
}

export function expandBlocker(blocker: Blocker, radiusM: number): RectBounds {
  return {
    min: [blocker.min[0] - radiusM, blocker.min[1] - radiusM],
    max: [blocker.max[0] + radiusM, blocker.max[1] + radiusM],
  }
}

export function shrinkBounds(bounds: RectBounds, radiusM: number): RectBounds {
  const minX = bounds.min[0] + radiusM
  const maxX = bounds.max[0] - radiusM
  const minZ = bounds.min[1] + radiusM
  const maxZ = bounds.max[1] - radiusM
  return {
    min: [Math.min(minX, maxX), Math.min(minZ, maxZ)],
    max: [Math.max(minX, maxX), Math.max(minZ, maxZ)],
  }
}

export function isInsideRect(x: number, z: number, rect: RectBounds): boolean {
  return x > rect.min[0] && x < rect.max[0] && z > rect.min[1] && z < rect.max[1]
}

export function isBlocked(
  x: number,
  z: number,
  blockers: readonly Blocker[],
  radiusM: number,
): boolean {
  return blockers.some((blocker) =>
    isInsideRect(x, z, expandBlocker(blocker, radiusM)),
  )
}

export function normalizeDirection(dx: number, dz: number): Vec2 {
  const length = Math.hypot(dx, dz)
  if (length === 0) return [0, 0]
  return [dx / length, dz / length]
}

export interface MoveResult {
  x: number
  z: number
  blocked: boolean
}

const MAX_SUBSTEP_M = 0.1

/**
 * 对角方向先归一化，再按小步推进；被阻挡时沿单轴滑动，避免低帧率穿墙。
 */
export function resolveMove(
  from: Vec2,
  delta: Vec2,
  bounds: RectBounds,
  blockers: readonly Blocker[],
  radiusM: number,
): MoveResult {
  const walkable = shrinkBounds(bounds, radiusM)
  const direction = normalizeDirection(delta[0], delta[1])
  const total = Math.hypot(delta[0], delta[1])
  if (total === 0) {
    return { x: from[0], z: from[1], blocked: false }
  }
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP_M))
  const stepLength = total / steps
  let x = from[0]
  let z = from[1]
  let blocked = false

  for (let index = 0; index < steps; index += 1) {
    const nextX = clamp(x + direction[0] * stepLength, walkable.min[0], walkable.max[0])
    const nextZ = clamp(z + direction[1] * stepLength, walkable.min[1], walkable.max[1])

    if (!isBlocked(nextX, nextZ, blockers, radiusM)) {
      x = nextX
      z = nextZ
      continue
    }
    blocked = true
    if (!isBlocked(nextX, z, blockers, radiusM)) {
      x = nextX
      continue
    }
    if (!isBlocked(x, nextZ, blockers, radiusM)) {
      z = nextZ
    }
  }

  return { x, z, blocked }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function isInsideWalkable(
  point: Vec2,
  bounds: RectBounds,
  radiusM: number,
): boolean {
  const walkable = shrinkBounds(bounds, radiusM)
  return (
    point[0] >= walkable.min[0] &&
    point[0] <= walkable.max[0] &&
    point[1] >= walkable.min[1] &&
    point[1] <= walkable.max[1]
  )
}

export function sizeTolerance(axisSizeM: number): number {
  return Math.max(0.01, axisSizeM * 0.01)
}

export function withinTolerance(a: number, b: number, axisSizeM: number): boolean {
  return Math.abs(a - b) <= sizeTolerance(axisSizeM)
}

export function vectorsMatch(a: Vec3, b: Vec3): boolean {
  return (
    withinTolerance(a[0], b[0], a[0]) &&
    withinTolerance(a[1], b[1], a[1]) &&
    withinTolerance(a[2], b[2], a[2])
  )
}
