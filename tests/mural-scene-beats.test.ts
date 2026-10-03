import { describe, expect, it } from 'vitest'
import { chapterDefinitions } from '../viewer/src/mural/story.ts'
import { getSceneBeat, isNarrationReady, sceneBeatProgress } from '../viewer/src/mural/scene-beats.ts'

// This contract follows the events in the story, not the chapter's mural framing.
// A chapter may switch between a historical scene and its route explanation.
const expectedBeats = {
  'c0-0': 'opening',
  'c1-0': 'departure', 'c1-1': 'detention', 'c1-2': 'retained-credential',
  'c2-0': 'westward',
  'c3-0': 'audience', 'c3-1': 'audience',
  'c4-0': 'market', 'c4-1': 'goods', 'c4-2': 'goods',
  'c7-2': 'tower',
} as const
const allCues = chapterDefinitions.flatMap(chapter => chapter.cues)
const visualCues = allCues.filter(cue => Object.hasOwn(expectedBeats, cue.id))

describe('cue-specific 3D scenes before their narration', () => {
  it('assigns scenes to the 11 corresponding story cues and leaves route cues without a fabricated scene', () => {
    expect(allCues).toHaveLength(24)
    expect(visualCues).toHaveLength(11)
    for (const cue of visualCues) {
      const beat = getSceneBeat(cue.id)
      expect(beat, cue.id).toBeDefined()
      expect(beat!.id, cue.id).toBe(expectedBeats[cue.id as keyof typeof expectedBeats])
      expect(beat!.sourceKind, cue.id).toBe(cue.sourceKind)
      expect(Number.isFinite(beat!.visualSeconds)).toBe(true)
      expect(beat!.visualSeconds).toBeGreaterThan(0)
      expect(isNarrationReady(0, beat!)).toBe(false)
    }
    for (const cue of allCues.filter(cue => !Object.hasOwn(expectedBeats, cue.id))) {
      expect(getSceneBeat(cue.id), cue.id).toBeUndefined()
    }
    for (const unknown of ['c8-0', 'c3-9', '', 'constructor', '__proto__']) expect(getSceneBeat(unknown)).toBeUndefined()
  })

  it('depicts detention and keeping the credential distinctly from continuing to walk', () => {
    const detention = getSceneBeat('c1-1')!, westward = getSceneBeat('c2-0')!
    const retained = getSceneBeat('c1-2')!
    expect(detention.id).toBe('detention')
    expect(detention.title).toContain('任务中断')
    expect(detention.id).not.toBe(westward.id)
    expect(retained.id).toBe('retained-credential')
    expect(retained.title).toContain('仍保留汉节')
    expect(retained.id).not.toBe(westward.id)
    expect(getSceneBeat('c3-0')!.id).toBe('audience')
    expect(getSceneBeat('c3-1')!.title).toContain('求盟未成')
    expect(getSceneBeat('c4-1')!.id).toBe('goods')
  })

  it('labels the added historical encounters and goods without claiming the mural painted them', () => {
    for (const cue of visualCues.filter(cue => cue.sourceKind === 'history')) {
      const beat = getSceneBeat(cue.id)!
      expect(beat.boundaryNote, cue.id).toContain('史书补充')
      expect(beat.boundaryNote, cue.id).toContain('非原画直接画出')
    }
    expect(getSceneBeat('c7-2')!.id).toBe('tower')
    expect(getSceneBeat('c7-2')!.boundaryNote).toContain('壁画叙事')
    expect(getSceneBeat('c7-2')!.boundaryNote).toContain('不能当作汉代问佛现场')
    expect(getSceneBeat('c7-2')!.boundaryNote).toContain('不是汉代现场实录')
    expect(getSceneBeat('c7-2')!.boundaryNote).toContain('后世佛教叙事')
    for (const id of ['c6-0', 'c6-1', 'c6-2', 'c7-0', 'c7-1']) expect(getSceneBeat(id)).toBeUndefined()
  })

  it('withholds each voice until the exact visual boundary and stays ready during its narration tail', () => {
    for (const cue of visualCues) {
      const beat = getSceneBeat(cue.id)!, before = beat.visualSeconds - .000001
      expect(sceneBeatProgress(before, beat)).toBeLessThan(1)
      expect(isNarrationReady(before, beat)).toBe(false)
      expect(sceneBeatProgress(beat.visualSeconds, beat)).toBe(1)
      expect(isNarrationReady(beat.visualSeconds, beat)).toBe(true)
      // Finishing a visual is permission to begin this sentence, not a cue end.
      expect(sceneBeatProgress(beat.visualSeconds + 30, beat)).toBe(1)
      expect(isNarrationReady(beat.visualSeconds + 30, beat)).toBe(true)
    }
  })

  it('clamps backward seeks and resets the voice gate for a new cue instead of inheriting the previous beat', () => {
    const prior = getSceneBeat('c1-0')!, next = getSceneBeat('c1-1')!
    expect(isNarrationReady(prior.visualSeconds + 10, prior)).toBe(true)
    expect(sceneBeatProgress(0, next)).toBe(0)
    expect(isNarrationReady(0, next)).toBe(false)
    expect(sceneBeatProgress(next.visualSeconds / 2, next)).toBe(.5)
    for (const seconds of [-100, -Infinity]) {
      expect(sceneBeatProgress(seconds, next)).toBe(0)
      expect(isNarrationReady(seconds, next)).toBe(false)
    }
    expect(sceneBeatProgress(Infinity, next)).toBe(1)
    expect(sceneBeatProgress(NaN, next)).toBe(0)
    expect(isNarrationReady(NaN, next)).toBe(false)
  })
})
