import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { chapters } from '../viewer/src/mural/story.ts'
import { buildPlaybackTimeline } from '../viewer/src/mural/playback.ts'
import { routePosition, subtitleText } from '../viewer/src/mural/presentation.ts'

describe('early 3D and readable presentation', () => {
  it('shows 3D before one minute using the actual recorded timeline', () => {
    const manifest = JSON.parse(readFileSync('viewer/public/mural-assets/narration-v7/manifest.json', 'utf8'))
    const timeline = buildPlaybackTimeline(chapters, manifest.tracks)
    const first = timeline.chapters.flatMap(chapter => chapter.cues.map(cue => ({ ...cue, absoluteStart: chapter.start + cue.start }))).find(cue => cue.beat)
    expect(first?.beat?.id).toBe('opening')
    expect(first!.absoluteStart).toBeLessThan(60)
  })
  it('reveals Unicode characters in full by the narration tail and respects reduced motion', () => {
    const text = '张骞🙂，继续西行。'
    expect(subtitleText(text, -1, 10)).toBe('')
    expect(subtitleText(text, 0, 10)).toBe('')
    expect(subtitleText(text, 4.5, 10)).toBe('张骞🙂，继')
    expect(subtitleText(text, 9, 10)).toBe(text)
    expect(subtitleText(text, 0, 10, true)).toBe(text)
  })
  it('keeps detention in a broad region, advances westward, and does not restart the return journey', () => {
    expect(routePosition(3, 1, .5).note).toContain('不代表已知扣留地点')
    expect(routePosition(4, 1, .5).label).toContain('被扣留')
    expect(routePosition(4, 2, .5).label).toContain('大月氏')
    const beginning = routePosition(3, 2, 0), end = routePosition(3, 2, 1)
    expect(end.x).toBeLessThan(beginning.x)
    expect(end).toMatchObject({ x: 27, y: 63 })
    expect(routePosition(7, 1, 1)).toMatchObject({ x: 92.5, y: 71.5 })
    expect(routePosition(7, 2, 0)).toMatchObject({ x: 92.5, y: 71.5 })
  })
})
