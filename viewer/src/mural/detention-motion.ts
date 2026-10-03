import { MathUtils } from 'three'

export type GuardTurn = { fromYaw: number; toYaw: number; progress: number }
export type GuardMotion = {
  side: number; x: number; z: number; yaw: number; distance: number; weight: number
  action: 'halt' | 'turn' | 'walk'; turns: GuardTurn[]
}
const stage = (u: number, from: number, to: number) => MathUtils.smoothstep(u, from, to)
const walkingWeight = (u: number, from: number, to: number) => {
  const width = (to - from) * .15
  return stage(u, from, from + width) * (1 - stage(u, to - width, to))
}

/** Authored blocking, independent of frame history. A turn never translates
 * the route, and every translating body faces the tangent of its own route.
 * This is an illustrative interception, not a recorded camp layout or rite.
 */
export function sampleDetentionMotion(progress: number, retained = false) {
  const u = retained ? 1 : Number.isFinite(progress) ? MathUtils.clamp(progress, 0, 1) : 0
  const approach = stage(u, 0, .28), escort = stage(u, .60, .92)
  const partyZ = 8 - 3.5 * approach - 5.3 * escort
  const partyWeight = walkingWeight(u, 0, .28) + walkingWeight(u, .60, .92)
  const guards: GuardMotion[] = [-1, 1].map(side => {
    const interception = stage(u, .16, .32)
    const incomingYaw = Math.atan2(-side * 1.55, .35)
    const turns = [
      { fromYaw: 0, toYaw: incomingYaw, progress: stage(u, .08, .16) },
      { fromYaw: incomingYaw, toYaw: 0, progress: stage(u, .32, .38) },
      { fromYaw: 0, toYaw: side * Math.PI, progress: stage(u, .43, .59) },
    ]
    const yaw = u < .32 ? incomingYaw * turns[0]!.progress
      : u < .43 ? incomingYaw * (1 - turns[1]!.progress)
      : side * Math.PI * turns[2]!.progress
    const turning = turns.some(turn => turn.progress > 0 && turn.progress < 1)
    const weight = walkingWeight(u, .16, .32) + walkingWeight(u, .60, .92)
    return {
      side, x: side * (2.65 - 1.55 * interception), z: 3.4 + .35 * interception - 5.3 * escort,
      yaw, distance: Math.hypot(1.55, .35) * interception + 5.3 * escort, weight,
      action: turning ? 'turn' : weight > 0 ? 'walk' : 'halt', turns,
    }
  })
  return { partyZ, partyDistance: 8 - partyZ, partyWeight,
    phase: u >= .92 ? 'restricted' : u >= .60 ? 'escorted' : u >= .28 ? 'intercepted' : 'approaching', guards }
}
