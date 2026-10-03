import { describe, expect, it } from 'vitest'
import { advanceStoryClock, subtitleMediaSeconds, type MediaClock } from '../viewer/src/mural/audio-clock.ts'

const cue = { id: 'c1-0', audioStart: 45, audioSeconds: 9.74, end: 62 }
const media = (overrides: Partial<MediaClock> = {}): MediaClock => ({ cueId: 'c1-0', currentTime: 2, duration: 9.74, paused: false, ended: false, ready: true, ...overrides })

describe('one media clock for spoken narration and subtitles', () => {
  it('follows actual speech after a slow rendering frame rather than accumulating capped frame deltas', () => {
    expect(advanceStoryClock(47, .1, 1, cue, media({ currentTime: 8 }), true)).toBe(53)
    expect(subtitleMediaSeconds(cue, 47, media({ currentTime: 8 }), true)).toBe(8)
  })
  it('does not multiply media time twice after a speed change', () => {
    expect(advanceStoryClock(47, .1, 1.5, cue, media({ currentTime: 4.5 }), true)).toBe(49.5)
    expect(subtitleMediaSeconds(cue, 47, media({ currentTime: 4.5 }), true)).toBe(4.5)
  })
  it('holds while the same cue buffers and follows the paused media position on resume', () => {
    expect(advanceStoryClock(45, .1, 1, cue, media({ ready: false, currentTime: 0, paused: true }), true)).toBe(45)
    expect(advanceStoryClock(48, .1, 1, cue, media({ currentTime: 3, paused: true }), true)).toBe(48)
  })
  it('ignores the previous audio after seeking and completes each visual stage before narration', () => {
    expect(advanceStoryClock(42, .1, 1, cue, media(), true)).toBe(42.1)
    expect(subtitleMediaSeconds(cue, 42, media(), true)).toBe(-3)
    expect(advanceStoryClock(47, .1, 1, cue, media({ cueId: 'c0-2', currentTime: 8 }), true)).toBe(47)
    expect(subtitleMediaSeconds(cue, 47, media({ cueId: 'c0-2' }), true)).toBe(2)
    expect(advanceStoryClock(42, 30, 1, cue, media(), true)).toBe(45)
  })
  it('catches a finished clip without skipping the next visual stage or dropping reading time', () => {
    const ended = media({ currentTime: 9.74, ended: true, paused: true })
    expect(advanceStoryClock(49, 30, 1, cue, ended, true)).toBe(54.74)
    expect(advanceStoryClock(54.74, .1, 1, cue, ended, true)).toBe(54.84)
    expect(advanceStoryClock(61, 30, 1, cue, ended, true)).toBe(62)
  })
  it('preserves a readable timeline when narration is disabled or unavailable', () => {
    expect(advanceStoryClock(47, .1, 1, cue, media({ currentTime: 8 }), false)).toBe(47.1)
    expect(subtitleMediaSeconds(cue, 47, media({ currentTime: 8 }), false)).toBe(2)
  })
  it('continues reading time after seeking beyond the audio instead of waiting for an intentionally skipped clip', () => {
    const unbound = media({ cueId: '', currentTime: 0, ready: false, paused: true })
    expect(advanceStoryClock(55.24, .5, 1, cue, unbound, true)).toBe(55.74)
    expect(advanceStoryClock(61.8, .5, 1, cue, unbound, true)).toBe(62)
    expect(advanceStoryClock(55.24, .5, 1, cue, media({ cueId: 'c0-2', currentTime: 8 }), true)).toBe(55.74)
  })
})
