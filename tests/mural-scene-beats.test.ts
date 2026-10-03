import { describe, expect, it } from 'vitest'
import { chapterDefinitions } from '../viewer/src/mural/story.ts'
import { getSceneBeat, isNarrationReady, sceneBeatProgress } from '../viewer/src/mural/scene-beats.ts'

const spatialCues = chapterDefinitions.filter(chapter => chapter.mode === 'spatial').flatMap(chapter => chapter.cues)

describe('cue-specific 3D scenes before their narration', () => {
  it('gives all 12 spatial cues a visual beat and opens with a 3D introduction', () => {
    expect(spatialCues).toHaveLength(12)
    for (const cue of spatialCues) {
      const beat = getSceneBeat(cue.id)
      expect(beat, cue.id).toBeDefined()
      expect(beat!.sourceKind, cue.id).toBe(cue.sourceKind)
      expect(Number.isFinite(beat!.visualSeconds)).toBe(true)
      expect(beat!.visualSeconds).toBeGreaterThan(0)
      expect(isNarrationReady(0, beat!)).toBe(false)
    }
    for (const chapter of chapterDefinitions.filter(chapter => chapter.mode !== 'spatial')) {
      for (const cue of chapter.cues) {
        if (cue.id === 'c0-0') expect(getSceneBeat(cue.id)?.id).toBe('opening')
        else expect(getSceneBeat(cue.id)).toBeUndefined()
      }
    }
    for (const unknown of ['c8-0', 'c3-9', '', 'constructor', '__proto__']) expect(getSceneBeat(unknown)).toBeUndefined()
  })

  it('depicts detention and keeping the credential distinctly from continuing to walk', () => {
    const detention = getSceneBeat('c3-1')!, westward = getSceneBeat('c3-2')!
    const credential = getSceneBeat('c4-0')!, retained = getSceneBeat('c4-1')!
    expect(detention.id).toBe('detention')
    expect(detention.title).toContain('驻足')
    expect(detention.id).not.toBe(westward.id)
    expect(credential.id).toBe('credential')
    expect(retained.id).toBe('retained-credential')
    expect(retained.title).toContain('仍保留汉节')
    expect(retained.id).not.toBe(westward.id)
    expect(getSceneBeat('c4-2')!.id).toBe('audience')
    expect(getSceneBeat('c4-2')!.title).toContain('求盟未成')
  })

  it('labels the added historical encounters and goods without claiming the mural painted them', () => {
    for (const cue of spatialCues.filter(cue => cue.sourceKind === 'history')) {
      const beat = getSceneBeat(cue.id)!
      expect(beat.boundaryNote, cue.id).toContain('史书补充')
      expect(beat.boundaryNote, cue.id).toContain('非原画直接画出')
    }
    expect(getSceneBeat('c6-1')!.id).toBe('tower')
    expect(getSceneBeat('c6-1')!.boundaryNote).toContain('壁画叙事')
    expect(getSceneBeat('c6-1')!.boundaryNote).toContain('不能当作汉代问佛现场')
    expect(getSceneBeat('c6-0')!.boundaryNote).toContain('不是汉代现场实录')
    expect(getSceneBeat('c6-2')!.boundaryNote).toContain('后世佛教叙事')
  })

  it('withholds each voice until the exact visual boundary and stays ready during its narration tail', () => {
    for (const cue of spatialCues) {
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
    const prior = getSceneBeat('c3-0')!, next = getSceneBeat('c3-1')!
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
