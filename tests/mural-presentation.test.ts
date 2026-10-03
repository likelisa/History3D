import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { chapters } from '../viewer/src/mural/story.ts'
import { buildPlaybackTimeline } from '../viewer/src/mural/playback.ts'
import { routePosition, subtitleText, timedSubtitleText, validateSubtitlePoints } from '../viewer/src/mural/presentation.ts'

describe('early 3D and readable presentation', () => {
  it('shows 3D before one minute using the actual recorded timeline', () => {
    const manifest = JSON.parse(readFileSync('viewer/public/mural-assets/narration-v12/manifest.json', 'utf8'))
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
  it('keeps subtitles at the spoken word during a real pause and reconstructs exact seek positions', () => {
    const points = [{ seconds: .5, textEnd: 2 }, { seconds: 4, textEnd: 4 }]
    validateSubtitlePoints('甲，乙。', points, 5)
    expect(timedSubtitleText('甲，乙。', 0, points)).toBe('')
    expect(timedSubtitleText('甲，乙。', .5, points)).toBe('甲，')
    expect(timedSubtitleText('甲，乙。', 3.9, points)).toBe('甲，')
    expect(timedSubtitleText('甲，乙。', 4, points)).toBe('甲，乙。')
    expect(timedSubtitleText('甲，乙。', .5, points)).toBe('甲，')
    expect(timedSubtitleText('甲，乙。', -1, points, true)).toBe('')
    expect(timedSubtitleText('甲，乙。', 0, points, true)).toBe('甲，乙。')
    expect(timedSubtitleText('张🙂骞', 1, [{ seconds: 0, textEnd: 2 }, { seconds: 2, textEnd: 3 }])).toBe('张🙂')
  })
  it('rejects partial, nonmonotonic and out-of-audio subtitle alignment instead of pairing stale captions', () => {
    for (const points of [[], [{ seconds: 0, textEnd: 1 }], [{ seconds: 0, textEnd: 2 }, { seconds: -1, textEnd: 4 }], [{ seconds: 0, textEnd: 2 }, { seconds: 6, textEnd: 4 }], [{ seconds: 0, textEnd: 3 }, { seconds: 1, textEnd: 2 }]]) {
      expect(() => validateSubtitlePoints('甲，乙。', points, 5)).toThrow('字幕时间戳')
    }
  })
  it('uses the delivered speech timings rather than revealing the next sentence inside a detected pause', () => {
    const manifest = JSON.parse(readFileSync('viewer/public/mural-assets/narration-v12/manifest.json', 'utf8'))
    const first = manifest.tracks[0]
    expect(timedSubtitleText(first.text, 4.9, first.subtitlePoints)).toBe('西汉时，汉武帝想找到一个盟友，共同对抗匈奴。')
    expect(timedSubtitleText(first.text, 5.23, first.subtitlePoints)).toBe('西汉时，汉武帝想找到一个盟友，共同对抗匈奴。张')
    for (const track of manifest.tracks) {
      validateSubtitlePoints(track.text, track.subtitlePoints, track.seconds)
      expect(timedSubtitleText(track.text, track.seconds, track.subtitlePoints)).toBe(track.text)
      expect(track.subtitleAudioSha256).toBe(track.sha256)
    }
  })
  it('keeps detention in a broad region, advances westward, and does not restart the return journey', () => {
    expect(routePosition(1, 1, .5).note).toContain('不代表已知扣留地点')
    expect(routePosition(1, 2, .5).label).toContain('被扣留')
    expect(routePosition(3, 0, .5).label).toContain('大月氏')
    const beginning = routePosition(2, 2, 0), end = routePosition(2, 2, 1)
    expect(end.x).toBeLessThan(beginning.x)
    expect(end).toMatchObject({ x: 27, y: 63 })
    expect(routePosition(5, 0, 1)).toMatchObject({ x: 71, y: 45 })
    expect(routePosition(5, 0, 1).label).toContain('再次被扣留')
    expect(routePosition(5, 1, 1)).toMatchObject({ x: 92.5, y: 71.5 })
    expect(routePosition(5, 2, 0)).toMatchObject({ x: 92.5, y: 71.5 })
    expect(routePosition(6, 1, .5).note).toContain('副使')
    expect(routePosition(7, 2, 0).label).toContain('初唐')
  })
  it('continues the westward route across cues instead of replaying captivity to Yuezhi twice', () => {
    const coordinates = (point: ReturnType<typeof routePosition>) => ({ x: point.x, y: point.y })
    for (const progress of [0, .25, .5, .75, 1]) {
      expect(coordinates(routePosition(2, 0, progress))).toEqual({ x: 71, y: 45 })
    }
    expect(coordinates(routePosition(2, 1, 0))).toEqual({ x: 71, y: 45 })
    const foodCueEnd = routePosition(2, 1, 1), transferCueStart = routePosition(2, 2, 0)
    expect(coordinates(foodCueEnd)).toEqual({ x: 34.4, y: 48.9 })
    expect(coordinates(transferCueStart)).toEqual(coordinates(foodCueEnd))
    expect(transferCueStart.x).toBeLessThan(routePosition(2, 1, 0).x - 20)
    // A forward cue change must not jump back toward the detention region.
    const before = routePosition(2, 1, 1 - 1e-6), after = routePosition(2, 2, 1e-6)
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.001)
  })
  it('visits Dayuan, the Kangju region and Yuezhi in narrative order with continuous segment joins', () => {
    expect(routePosition(2, 2, 0)).toMatchObject({ x: 34.4, y: 48.9 })
    expect(routePosition(2, 2, 0).label).toContain('大宛')
    expect(routePosition(2, 2, .5)).toMatchObject({ x: 28, y: 25 })
    expect(routePosition(2, 2, .5).label).toContain('康居区域')
    expect(routePosition(2, 2, 1)).toMatchObject({ x: 27, y: 63 })
    expect(routePosition(2, 2, 1).label).toContain('大月氏')
    const samples = Array.from({ length: 21 }, (_, index) => routePosition(2, 2, index / 20))
    for (let i = 1; i < samples.length; i++) expect(samples[i]!.x).toBeLessThanOrEqual(samples[i - 1]!.x)
    const before = routePosition(2, 2, .5 - 1e-6), after = routePosition(2, 2, .5 + 1e-6)
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(.001)
    for (const progress of [0, .5, 1]) {
      const note = routePosition(2, 2, progress).note
      expect(note).toContain('精确路线不明')
      expect(note).toContain('大致区域')
      expect(note).toContain('副使及其他时期路线')
    }
  })
  it('reconstructs the same country position on forward and backward seeks without accumulated animation state', () => {
    const targets = [{ cue: 1, progress: .3 }, { cue: 1, progress: 1 }, { cue: 2, progress: 0 }, { cue: 2, progress: .25 }, { cue: 2, progress: .5 }, { cue: 2, progress: .75 }, { cue: 2, progress: 1 }]
    const expected = targets.map(target => routePosition(2, target.cue, target.progress))
    for (const index of [6, 2, 5, 0, 4, 1, 3, 6, 0]) {
      routePosition(5, 1, 1)
      expect(routePosition(2, targets[index]!.cue, targets[index]!.progress)).toEqual(expected[index])
    }
    expect(routePosition(2, 2, -.5)).toEqual(routePosition(2, 2, 0))
    expect(routePosition(2, 2, 1.5)).toEqual(routePosition(2, 2, 1))
    expect(routePosition(2, 2, NaN)).toEqual(routePosition(2, 2, 0))
  })
})
