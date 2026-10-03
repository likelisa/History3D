import { describe, expect, it } from 'vitest'
import { cueView, cueFocus, focusVisible, goldenFigureRegions } from '../viewer/src/mural/cue-presentation.ts'
import { annotations, chapterDefinitions } from '../viewer/src/mural/story.ts'
import { getSceneBeat } from '../viewer/src/mural/scene-beats.ts'

describe('the images and scenes support the story being told', () => {
  it('uses the actual cue scenes for historical events and route maps for the other first seven chapters', () => {
    const expected = {
      'c0-0': 'spatial', 'c0-1': 'map', 'c0-2': 'map',
      'c1-0': 'spatial', 'c1-1': 'spatial', 'c1-2': 'spatial',
      'c2-0': 'spatial', 'c2-1': 'map', 'c2-2': 'map',
      'c3-0': 'spatial', 'c3-1': 'spatial', 'c3-2': 'map',
      'c4-0': 'spatial', 'c4-1': 'spatial', 'c4-2': 'spatial',
      'c5-0': 'map', 'c5-1': 'map', 'c5-2': 'map',
      'c6-0': 'map', 'c6-1': 'map', 'c6-2': 'map',
    } as const
    const cues = chapterDefinitions.slice(0, 7).flatMap(chapter => chapter.cues)
    expect(cues).toHaveLength(21)
    for (const cue of cues) {
      for (const seconds of [0, 1, 30]) {
        expect(cueView(cue.id, seconds, !!getSceneBeat(cue.id)), cue.id).toBe(expected[cue.id as keyof typeof expected])
      }
    }
  })
  it('shows the mural when its positions are discussed and reserves the tower for the final interpretation', () => {
    for (const id of ['c7-0', 'c7-1']) {
      expect(getSceneBeat(id)).toBeUndefined()
      expect(cueView(id, 10, false)).toBe('mural')
    }
    expect(getSceneBeat('c7-2')?.id).toBe('tower')
    expect(cueView('c7-2', 10, true)).toBe('spatial')
    // A missing 3D beat falls back to a route view, never an unrelated scene.
    expect(cueView('c4-1', 10, false)).toBe('map')
  })
  it('does not introduce the escape annotation before the initial departure and captivity', () => {
    for (const id of ['c0-0', 'c1-0']) {
      expect(cueFocus(id)).not.toContain('westward-party')
    }
    expect(cueFocus('c2-0')).toContain('westward-party')
  })
  it('only highlights briefly at narration onset, including on seek', () => {
    const beat = getSceneBeat('c1-1')!
    expect(focusVisible('c1-1', beat.visualSeconds - .01, beat.visualSeconds)).toBe(false)
    expect(focusVisible('c1-1', beat.visualSeconds, beat.visualSeconds)).toBe(true)
    expect(focusVisible('c1-1', beat.visualSeconds + 3.49, beat.visualSeconds)).toBe(true)
    expect(focusVisible('c1-1', beat.visualSeconds + 3.5, beat.visualSeconds)).toBe(false)
    expect(focusVisible('c7-1', 1, 0)).toBe(true)
    expect(focusVisible('c7-1', 4, 0)).toBe(false)
    expect(focusVisible('c5-0', 1, 0)).toBe(false)
  })
  it('identifies both distinct painted golden figures and valid explanatory anchors', () => {
    expect(cueFocus('c7-1')).toContain('golden-figures')
    expect(cueFocus('c1-0')).not.toContain('golden-figures')
    expect(goldenFigureRegions).toHaveLength(2)
    expect(goldenFigureRegions[0]!.x + goldenFigureRegions[0]!.width).toBeLessThan(goldenFigureRegions[1]!.x)
    for (const cue of chapterDefinitions.flatMap(chapter => chapter.cues)) {
      for (const focus of cueFocus(cue.id)) expect(annotations.some(item => item.id === focus), `${cue.id}: ${focus}`).toBe(true)
    }
  })
})
