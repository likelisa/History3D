import { describe, expect, it } from 'vitest'
import { chapters } from '../viewer/src/mural/story.ts'
import { buildPlaybackTimeline, locateMoment } from '../viewer/src/mural/playback.ts'
import { cueView } from '../viewer/src/mural/cue-presentation.ts'
import { advancePresentation, cueRouteProgress, presentationFrame, resetPresentation, sceneTransitionSeconds } from '../viewer/src/mural/presentation-state.ts'

const timeline = buildPlaybackTimeline(chapters, [])
function moment(cueId: string, seconds: number) {
  const chapter = timeline.chapters.find(item => item.cues.some(cue => cue.id === cueId))!
  const cue = chapter.cues.find(item => item.id === cueId)!
  return locateMoment(timeline, chapter.start + cue.start + seconds)
}
function frame(cueId: string, seconds: number) {
  const current = moment(cueId, seconds)
  return presentationFrame(current, cueView(current.cue.id, current.cueLocalSeconds, !!current.cue.beat))
}

describe('scene cuts preserve the outgoing presentation and deterministic cue clocks', () => {
  it('covers a departure to detention cut even though both views are spatial', () => {
    const outgoing = frame('c1-0', 6)
    const incoming = frame('c1-1', 0)
    const fading = advancePresentation(resetPresentation(outgoing), incoming, .1)
    expect(fading.displayed).toEqual(outgoing)
    expect(fading.pending?.spatial?.beat.id).toBe('detention')
    expect(fading.opacity).toBeGreaterThan(0)
    const cut = advancePresentation(fading, frame('c1-1', .5), .5)
    expect(cut.opacity).toBe(1)
    expect(cut.displayed.spatial?.beat.id).toBe('detention')
    expect(cut.pending).toBeNull()
    expect(advancePresentation(cut, frame('c1-1', 1.1), .6).opacity).toBe(0)
  })

  it('freezes the last westward scene while fading to a cue without a 3D beat', () => {
    const outgoing = frame('c2-0', 7)
    const fading = advancePresentation(resetPresentation(outgoing), frame('c2-1', 0), .2)
    expect(fading.displayed).toEqual(outgoing)
    expect(fading.displayed.spatial).toMatchObject({ progress: 1, beat: { id: 'westward' } })
    expect(fading.pending?.mode).toBe('map')
    const cut = advancePresentation(fading, frame('c2-1', .6), .4)
    expect(cut.opacity).toBe(1)
    expect(cut.displayed.mode).toBe('map')
    expect(cut.displayed.spatial).toBeUndefined()
  })

  it('never invents mountain as the scene for a missing spatial beat', () => {
    expect(presentationFrame(moment('c2-1', 0), 'spatial')).toEqual({ key: 'map', mode: 'map' })
  })

  it.each([['c3-0', 'c3-1'], ['c4-1', 'c4-2']])('keeps the completed %s beat through %s without replaying its camera', (first, second) => {
    const outgoing = frame(first, 8)
    const continuation = frame(second, 0)
    expect(continuation.key).toBe(outgoing.key)
    expect(continuation.spatial?.progress).toBe(1)
    expect(continuation.spatial?.beat).toEqual(outgoing.spatial?.beat)
    const result = advancePresentation(resetPresentation(outgoing), continuation, .016)
    expect(result.pending).toBeNull()
    expect(result.opacity).toBe(0)
    expect(result.displayed.spatial?.progress).toBe(1)
  })

  it('keeps market ambient time continuous across market/goods cue boundaries', () => {
    const chapter = timeline.chapters[4]!
    for (const [before, after] of [['c4-0', 'c4-1'], ['c4-1', 'c4-2']]) {
      const cue = chapter.cues.find(item => item.id === before)!
      const last = frame(before!, cue.end - cue.start - .00001).spatial!.ambientSeconds
      const next = frame(after!, 0).spatial!.ambientSeconds
      expect(next - last).toBeCloseTo(.00001, 6)
      expect(next).toBeGreaterThan(6)
    }
  })

  it('reconstructs the same completed scene and ambient time after backward/forward seeks', () => {
    const expected = frame('c4-2', .3)
    for (const [id, seconds] of [['c1-1', 6], ['c3-1', .5], ['c4-0', 2]] as const) {
      const unrelated = advancePresentation(resetPresentation(frame(id, seconds)), frame('c2-1', 0), .2)
      expect(unrelated.pending).not.toBeNull()
      const sought = resetPresentation(frame('c4-2', .3))
      expect(sought).toEqual(resetPresentation(expected))
      expect(sought.pending).toBeNull()
      expect(sought.opacity).toBe(0)
    }
    const replay = resetPresentation(frame('c0-0', 0))
    expect(replay.displayed.spatial?.progress).toBe(0)
    expect(replay.elapsed).toBe(sceneTransitionSeconds)
  })

  it('can cancel a manual view toggle without replacing the visible scene', () => {
    const outgoing = frame('c1-0', 2)
    const covered = advancePresentation(resetPresentation(outgoing), { key: 'mural', mode: 'mural' }, .2)
    const cancelled = advancePresentation(covered, outgoing, 0)
    expect(cancelled.pending).toBeNull()
    expect(cancelled.displayed).toEqual(outgoing)
    expect(cancelled.opacity).toBeCloseTo(covered.opacity, 8)
    expect(advancePresentation(cancelled, outgoing, 1).opacity).toBe(0)
  })

  it('retargets a pending manual transition without dropping its cover or showing another scene', () => {
    const outgoing = frame('c1-0', 2)
    const covered = advancePresentation(resetPresentation(outgoing), { key: 'mural', mode: 'mural' }, .2)
    const retargeted = advancePresentation(covered, frame('c1-1', 0), 0)
    expect(retargeted.displayed).toEqual(outgoing)
    expect(retargeted.pending?.spatial?.beat.id).toBe('detention')
    expect(retargeted.opacity).toBeCloseTo(covered.opacity, 8)
  })

  it('uses the whole cue clock for both maps while the short visual action is already finished', () => {
    const current = moment('c1-0', 6)
    expect(frame('c1-0', 6).spatial?.progress).toBe(1)
    const expected = current.cueLocalSeconds / (current.cue.end - current.cue.start)
    expect(cueRouteProgress(current)).toBeCloseTo(expected, 10)
    expect(cueRouteProgress(current)).toBeLessThan(1)
    const final = locateMoment(timeline, timeline.duration)
    expect(cueRouteProgress(final)).toBe(1)
  })
})
