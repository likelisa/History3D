import { describe, expect, it } from 'vitest'
import { annotations, chapters, compileChapters, duration, sources } from '../viewer/src/mural/story.ts'

describe('mural narrative and evidence boundaries', () => {
  it('keeps an eight-chapter image route with one readable subtitle at a time', () => {
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

  it('uses a direct guide voice while retaining the distinction between painting and journey', () => {
    const spoken = chapters.flatMap(chapter => chapter.cues).map(cue => cue.text).join('')
    expect(spoken).not.toMatch(/《史记》|《汉书》|敦煌研究院|史书说/)
    expect(chapters[1]!.text).toContain('在这幅画里')
    expect(chapters[1]!.text).toContain('佛像')
    expect(chapters[2]!.text).toContain('共同对抗匈奴')
    expect(chapters[3]!.text).toContain('扣留十余年')
    expect(chapters[3]!.text).toContain('营地场景')
    expect(chapters[4]!.text).toContain('愿望却没有实现')
    expect(chapters[6]!.text).toContain('后世的历史记忆')
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
      // The detention chapter adds two explanatory anchors to the two image anchors.
      expect(chapterAnnotations.length).toBeLessThanOrEqual(chapterIndex === 3 ? 4 : 3)
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
