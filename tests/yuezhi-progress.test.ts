import { describe, expect, it } from 'vitest'
import { advance, freshProgress, readProgress } from '../viewer/src/yuezhi/state.ts'
import { Walker } from '../viewer/src/walker.ts'

describe('Yuezhi local story progress', () => {
  it('recovers malformed, out-of-range and unknown-clue saves at the first chapter', () => {
    for (const invalid of [null, { chapter: 6 }, { ...freshProgress(), chapter: 1, furthest: 0 }, { ...freshProgress(), clues: ['unknown'] }, { ...freshProgress(), prediction: 'change-history' }]) expect(readProgress(invalid)).toEqual(freshProgress())
  })
  it('lets a returning visitor revisit an earlier chapter without losing discoveries', () => {
    const restored = readProgress({ chapter: 1, furthest: 2, clues: ['past', 'past', 'distance'], prediction: 'decline', completed: true })
    expect(restored.clues).toEqual(['past', 'distance'])
    expect(restored.furthest).toBe(2)
    expect(restored.completed).toBe(true)
  })
  it('all predictions lead to the same historical outcome chapter', () => {
    for (const prediction of ['accept', 'decline', 'skip'] as const) {
      const result = advance({ ...freshProgress(), chapter: 1, furthest: 1, prediction })
      expect(result.chapter).toBe(2)
      expect(result.prediction).toBe(prediction)
      expect(advance(result).chapter).toBe(2)
    }
  })
  it('pauses movement without teleporting a visitor back to the spawn point', () => {
    const walker = new Walker({ spawnFeet: [0, 0, 4], eyeHeightM: 1.7, yawRad: 0, pitchRad: 0, moveSpeedMps: 2, radiusM: 0.3, bounds: { min: [-10, -10], max: [10, 10] }, blockers: [], groundY: 0 })
    walker.enabled = true
    walker.setSyntheticInput(1, 0)
    walker.update(0.5)
    const beforePause = [...walker.feet]
    expect(beforePause).not.toEqual([0, 4])
    walker.clearInput()
    walker.update(0.5)
    expect(walker.feet).toEqual(beforePause)
  })
})
