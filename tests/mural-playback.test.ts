import { describe, expect, it } from 'vitest'
import { chapters } from '../viewer/src/mural/story.ts'
import { buildPlaybackTimeline, locateMoment, type NarrationTrack } from '../viewer/src/mural/playback.ts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const tracks = (): NarrationTrack[] => chapters.flatMap(chapter => chapter.cues.map(cue => ({ id: cue.id, text: cue.text, seconds: 8, file: `/mural-assets/narration-v2/${cue.id}.mp3`, bytes: 100, sha256: 'a'.repeat(64) })))
describe('readable and spoken mural timeline', () => {
  it('reserves reading time even when a recording is shorter, and leaves a pause after long speech', () => {
    const recordings = tracks()
    recordings[0]!.seconds = 40
    const result = buildPlaybackTimeline(chapters, recordings)
    expect(result.chapters[0]!.cues[0]!.end).toBeGreaterThanOrEqual(41.5)
    for (const chapter of result.chapters) for (const cue of chapter.cues) expect(cue.end - cue.start).toBeGreaterThanOrEqual(cue.readingSeconds)
    expect(result.duration).toBeGreaterThan(112)
  })
  it('finds the next spoken cue and chapter at exact boundaries, with a stable ending for replay', () => {
    const result = buildPlaybackTimeline(chapters, tracks())
    for (let i = 0; i < result.chapters.length; i++) {
      const chapter = result.chapters[i]!
      expect(locateMoment(result, chapter.start).chapterIndex).toBe(i)
      for (let j = 0; j < chapter.cues.length; j++) expect(locateMoment(result, chapter.start + chapter.cues[j]!.start).cueIndex).toBe(j)
    }
    expect(locateMoment(result, -5).chapterIndex).toBe(0)
    expect(locateMoment(result, result.duration).chapterIndex).toBe(7)
    expect(locateMoment(result, result.duration).cueIndex).toBe(2)
  })
  it('finishes each 3D beat before its narration, then preserves the whole recorded sentence',()=>{
    const result=buildPlaybackTimeline(chapters,tracks())
    const chapter=result.chapters[4]!,cue=chapter.cues[1]!
    expect(cue.beat?.id).toBe('retained-credential')
    expect(locateMoment(result,chapter.start+cue.start).phase).toBe('visual')
    expect(locateMoment(result,chapter.start+cue.audioStart-.001).phase).toBe('visual')
    expect(locateMoment(result,chapter.start+cue.audioStart).phase).toBe('narration')
    expect(cue.audioStart-cue.start).toBe(cue.visualSeconds)
    expect(cue.end-cue.audioStart).toBeGreaterThanOrEqual(cue.audioSeconds+1.5)
    expect(locateMoment(result,chapter.start+cue.start).cue.beat?.id).toBe('retained-credential')
  })
  it('rejects stale narration, missing clips and duplicate cue records instead of pairing old voice with new text', () => {
    const stale = tracks(); stale[0]!.text = 'old recording'
    expect(() => buildPlaybackTimeline(chapters, stale)).toThrow('不匹配')
    expect(() => buildPlaybackTimeline(chapters, tracks().slice(1))).toThrow('不一致')
    const duplicate = tracks(); duplicate[1] = duplicate[0]!
    expect(() => buildPlaybackTimeline(chapters, duplicate)).toThrow('重复')
  })
  it('plays the 24 delivered recordings with exact current text, measured durations and verified bytes', () => {
    const manifest = JSON.parse(readFileSync('viewer/public/mural-assets/narration-v4/manifest.json', 'utf8')) as { tracks: NarrationTrack[]; voice: string; privateReferenceUsed: boolean; voiceCloningUsed: boolean; model: { weightsIncludedInDelivery: boolean } }
    const result = buildPlaybackTimeline(chapters, manifest.tracks)
    expect(manifest.tracks).toHaveLength(24)
    expect(manifest.voice).toContain('zm_010')
    expect(manifest.privateReferenceUsed).toBe(false)
    expect(manifest.voiceCloningUsed).toBe(false)
    expect(manifest.model.weightsIncludedInDelivery).toBe(false)
    // Real measured clip durations include fractions; clicking a cue must select
    // that exact sentence even while paused, rather than its preceding sentence.
    for (const [chapterIndex, chapter] of result.chapters.entries()) {
      for (const [cueIndex, cue] of chapter.cues.entries()) {
        const selected = locateMoment(result, chapter.start + cue.start)
        expect([selected.chapterIndex, selected.cueIndex]).toEqual([chapterIndex, cueIndex])
        expect(selected.cue.id).toBe(cue.id)
      }
    }
    for (const track of manifest.tracks) {
      const bytes = readFileSync('viewer/public' + track.file)
      expect(bytes.length).toBe(track.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(track.sha256)
      expect(track.seconds).toBeGreaterThan(5)
    }
    expect(result.duration).toBeGreaterThan(240)
  })
})
