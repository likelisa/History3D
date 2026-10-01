import { describe, expect, it } from 'vitest'
import { freshBook, nextLine, restoreBook, turnToScene } from '../viewer/src/yuezhi/book-state.ts'
import { bookScenes } from '../viewer/src/yuezhi/book-content.ts'
import { sources } from '../viewer/src/yuezhi/content.ts'
import { Walker } from '../viewer/src/walker.ts'

describe('Yuezhi dialogue book progress', () => {
  it('recovers corrupted or mismatched saves at the first page', () => {
    for (const invalid of [null, { scene: 6 }, { ...freshBook(), scene: 1, furthest: 0 }, { ...freshBook(), line: 'unknown' }, { ...freshBook(), read: ['unknown'] }]) expect(restoreBook(invalid)).toEqual(freshBook())
  })
  it('dialogue changes stay in the scene and page turns require the end of a new page', () => {
    const initial = freshBook()
    const spoken = nextLine(initial)
    expect(spoken.scene).toBe(0)
    expect(spoken.line).toBe('arrival-2')
    expect(turnToScene(spoken, 1)).toBe(spoken)
    expect(turnToScene(spoken, 3)).toBe(spoken)
    const last = { ...spoken, line: 'arrival-6' }
    expect(turnToScene(last, 1)).toMatchObject({ scene: 1, line: 'meeting-1', furthest: 1 })
  })
  it('both questions return to the same source-grounded narrative without rewriting the result', () => {
    const question = { ...freshBook(), scene: 1, furthest: 1, line: 'meeting-3' }
    expect(nextLine(question)).toBe(question)
    expect(nextLine(question, 'unknown')).toBe(question)
    for (const choice of ['grievance', 'distance']) {
      const answer = nextLine(question, choice)
      expect(answer.scene).toBe(1)
      expect(nextLine(answer).line).toBe('meeting-4')
    }
  })
  it('all dialogue links and historical references resolve inside the current book package', () => {
    const sourceIds = new Set(sources.map((source) => source.id))
    for (const scene of bookScenes) {
      const lineIds = new Set(scene.lines.map((line) => line.id))
      expect(lineIds.has(scene.start)).toBe(true)
      for (const id of scene.noteSourceIds ?? []) expect(sourceIds.has(id)).toBe(true)
      for (const line of scene.lines) {
        for (const id of line.sourceIds) expect(sourceIds.has(id)).toBe(true)
        if (line.next) expect(lineIds.has(line.next)).toBe(true)
        for (const choice of line.choices ?? []) expect(lineIds.has(choice.next)).toBe(true)
      }
    }
  })
  it('restores the exact dialogue and allows revisiting read pages without losing progress', () => {
    const restored = restoreBook({ scene: 1, line: 'meeting-distance', furthest: 3, read: ['arrival-1', 'arrival-1', 'meeting-3'], complete: true })
    expect(restored.read).toEqual(['arrival-1', 'meeting-3'])
    expect(turnToScene(restored, 0).furthest).toBe(3)
    expect(restored.complete).toBe(true)
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
