import { describe, expect, it } from 'vitest'
import { annotations, chapters, compileChapters, duration, sources } from '../viewer/src/mural/story.ts'

describe('mural narrative and evidence boundaries', () => {
  it('keeps an eight-chapter story with one readable subtitle at a time', () => {
    expect(chapters).toHaveLength(8)
    const cues = chapters.flatMap(chapter => chapter.cues)
    expect(cues).toHaveLength(24)
    expect(new Set(cues.map(cue => cue.id)).size).toBe(cues.length)
    let previousEnd = 0
    for (const chapter of chapters) {
      expect(chapter.start).toBe(previousEnd)
      expect(chapter.cues).toHaveLength(3)
      expect(chapter.cues[0]!.start).toBe(0)
      let cueEnd = 0
      for (const cue of chapter.cues) {
        expect(cue.start).toBe(cueEnd)
        expect(cue.end - cue.start).toBeGreaterThanOrEqual(cue.readingSeconds)
        // The text must fit a short subtitle, and a long sentence may not rush.
        expect(Array.from(cue.text).length).toBeLessThanOrEqual(54)
        expect(cue.readingSeconds).toBeGreaterThanOrEqual(Array.from(cue.text).length / 4 + 1.5)
        cueEnd = cue.end
      }
      expect(chapter.end - chapter.start).toBe(cueEnd)
      expect(chapter.text).toBe(chapter.cues.map(cue => cue.text).join(''))
      expect(chapter.takeaway.length).toBeGreaterThan(0)
      previousEnd = chapter.end
    }
    expect(duration).toBe(previousEnd)
    expect(duration).toBeGreaterThan(112)
  })

  it('finishes the diplomatic story before interpreting the later painting', () => {
    const spoken = chapters.flatMap(chapter => chapter.cues).map(cue => cue.text).join('')
    expect(spoken).not.toMatch(/《史记》|《汉书》|敦煌研究院|史书说/)
    expect(chapters.map(chapter => chapter.id)).toEqual([
      'mission', 'first-captivity', 'escape-westward', 'alliance-refused',
      'daxia-discovery', 'return-home', 'later-contacts', 'mural-memory',
    ])
    for (const cue of chapters.slice(0, 7).flatMap(chapter => chapter.cues)) {
      expect(cue.sourceKind).toBe('history')
      expect(cue.text).not.toMatch(/左上|右上|往下看|回到原画|金人|佛像/)
    }
    expect(chapters[0]!.text).toContain('共同对抗匈奴')
    expect(chapters[1]!.text).toContain('十余年')
    expect(chapters[3]!.text).toContain('汉朝太远')
    expect(chapters[4]!.text).toContain('推想')
    expect(chapters[5]!.text).toContain('再次被扣留')
    expect(chapters[5]!.text).toContain('妻子和甘父')
    expect(chapters[5]!.text).toContain('十三年')
    expect(chapters[6]!.text).toContain('没有立即答应')
    expect(chapters[7]!.text).toContain('后世佛教')
    expect(annotations.find(annotation => annotation.id === 'alliance-result')!.detail).toContain('没有明确的月氏接见场景')
  })

  it('makes every claim traceable and every image anchor valid on the complete mural', () => {
    const sourceIds = new Set(sources.map(source => source.id))
    expect(sourceIds.size).toBe(sources.length)
    expect(new Set(annotations.map(annotation => annotation.id)).size).toBe(annotations.length)
    for (const source of sources) expect(source.url).toMatch(/^https:\/\//)
    for (const claim of [...chapters.flatMap(chapter => chapter.cues), ...annotations]) {
      expect(claim.sourceIds.length).toBeGreaterThan(0)
      for (const id of claim.sourceIds) expect(sourceIds.has(id)).toBe(true)
    }
    for (const [chapterIndex, chapter] of chapters.entries()) {
      const { x, y, width, height } = chapter.focus
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(width).toBeGreaterThan(0)
      expect(height).toBeGreaterThan(0)
      expect(x + width).toBeLessThanOrEqual(1)
      expect(y + height).toBeLessThanOrEqual(1)
      const chapterAnnotations = annotations.filter(annotation => annotation.chapterIndex === chapterIndex)
      expect(chapterAnnotations.length).toBeGreaterThan(0)
      expect(chapterAnnotations.length).toBeLessThanOrEqual(3)
      for (const annotation of chapterAnnotations) {
        expect(annotation.x).toBeGreaterThanOrEqual(x)
        expect(annotation.x).toBeLessThanOrEqual(x + width)
        expect(annotation.y).toBeGreaterThanOrEqual(y)
        expect(annotation.y).toBeLessThanOrEqual(y + height)
      }
    }
    for (const annotation of annotations) {
      expect(annotation.chapterIndex).toBeGreaterThanOrEqual(0)
      expect(annotation.chapterIndex).toBeLessThan(chapters.length)
    }
  })

  it('extends a slow recorded cue without gaps or shortening the reading floor', () => {
    const cue = chapters[3]!.cues[1]!
    const extra = 9
    const retimed = compileChapters({ [cue.id]: cue.readingSeconds + extra, 'c0-0': 0.5 })
    expect(retimed[0]!.cues[0]!.end).toBe(chapters[0]!.cues[0]!.end)
    expect(retimed[3]!.cues[1]!.end - retimed[3]!.cues[1]!.start).toBe(cue.readingSeconds + extra)
    expect(retimed[4]!.start).toBe(chapters[4]!.start + extra)
    expect(retimed.at(-1)!.end).toBe(duration + extra)
    expect(chapters[3]!.cues[1]!.end).toBe(cue.end)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => compileChapters({ [cue.id]: bad })).toThrow('Invalid cue duration')
  })
})
