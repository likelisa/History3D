import { describe, expect, it } from 'vitest'
import { cueView, cueFocus, focusVisible, goldenFigureRegions } from '../viewer/src/mural/cue-presentation.ts'
import { annotations } from '../viewer/src/mural/story.ts'

describe('a guide points to the object being discussed', () => {
  it('keeps image-position narration on the image rather than a 3D landscape', () => {
    expect(cueView('c3-0', 10, true)).toBe('mural')
    expect(cueView('c5-0', 10, true)).toBe('mural')
    expect(cueView('c6-0', 10, true)).toBe('mural')
    expect(cueView('c5-1', 10, true)).toBe('spatial')
  })
  it('intersperses a route map without losing the later westward scene', () => {
    expect(cueView('c3-2', 0, true)).toBe('map')
    expect(cueView('c3-2', 30, true)).toBe('map')
    expect(cueView('c7-1', 10, false)).toBe('map')
    expect(cueView('c0-0', 1, true)).toBe('spatial')
  })
  it('only highlights briefly at narration onset, including on seek', () => {
    expect(focusVisible('c1-0', 0, 0)).toBe(true)
    expect(focusVisible('c1-0', 4, 0)).toBe(false)
    expect(focusVisible('c3-1', 11, 12)).toBe(false)
    expect(focusVisible('c3-1', 13, 12)).toBe(true)
    expect(focusVisible('c3-1', 16, 12)).toBe(false)
    expect(focusVisible('c7-1', 1, 0)).toBe(false)
  })
  it('identifies both distinct painted golden figures and valid explanatory anchors', () => {
    expect(cueFocus('c1-0')).toContain('golden-figures')
    expect(goldenFigureRegions).toHaveLength(2)
    expect(goldenFigureRegions[0]!.x + goldenFigureRegions[0]!.width).toBeLessThan(goldenFigureRegions[1]!.x)
    for (const id of ['c1-0', 'c3-1', 'c5-2', 'c6-0']) {
      for (const focus of cueFocus(id)) expect(annotations.some(item => item.id === focus)).toBe(true)
    }
  })
})
