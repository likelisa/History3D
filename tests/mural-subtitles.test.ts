import { describe, expect, it } from 'vitest'
import { chapters } from '../viewer/src/mural/story.ts'
import { englishSubtitles } from '../viewer/src/mural/subtitles.ts'

describe('bilingual guide subtitles', () => {
  it('provides an English translation for every narrated cue without extra tracks', () => {
    const ids = chapters.flatMap(chapter => chapter.cues.map(cue => cue.id))
    expect(Object.keys(englishSubtitles).sort()).toEqual(ids.sort())
    for (const id of ids) expect(englishSubtitles[id]!.length).toBeGreaterThan(20)
  })
})
