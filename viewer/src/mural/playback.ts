import { annotations, type StoryChapter, type StoryCue } from './story.ts'
import {getSceneBeat,type SceneBeat} from './scene-beats.ts'

export type NarrationTrack = { id: string; file: string; seconds: number; text: string; bytes: number; sha256: string }
export type PlaybackCue = StoryCue & { audioFile: string; audioSeconds: number;visualSeconds:number;audioStart:number;beat?:SceneBeat }
export type PlaybackChapter = Omit<StoryChapter, 'cues'> & { cues: PlaybackCue[]; annotationIds: string[] }
export type PlaybackTimeline = { chapters: PlaybackChapter[]; duration: number }

/** Reading time and the actual spoken length both matter; neither can cut the other short. */
export function buildPlaybackTimeline(definitions: readonly StoryChapter[], tracks: readonly NarrationTrack[]): PlaybackTimeline {
  const audio = new Map(tracks.map(track => [track.id, track]))
  if (audio.size !== tracks.length) throw new Error('旁白清单含重复句子')
  const expectedIds = new Set(definitions.flatMap(chapter => chapter.cues.map(cue => cue.id)))
  if (tracks.length && (audio.size !== expectedIds.size || [...audio.keys()].some(id => !expectedIds.has(id)))) throw new Error('旁白清单与故事句子不一致')
  let storyTime = 0
  const chapters = definitions.map((definition, chapterIndex) => {
    let chapterTime = 0
    const cues = definition.cues.map(cue => {
      const track = audio.get(cue.id)
      if (track && (track.text !== cue.text || !Number.isFinite(track.seconds) || track.seconds <= 0 || !/^\/mural-assets\/narration-v[2-9][0-9]*\/[\w-]+\.mp3$/.test(track.file))) throw new Error(`旁白与正文不匹配：${cue.id}`)
      const beat=getSceneBeat(cue.id),visualSeconds=beat?.visualSeconds??0
      const seconds = visualSeconds+Math.max(cue.readingSeconds, track ? track.seconds + 1.5 : cue.end - cue.start)
      const result = { ...cue, start: chapterTime, end: chapterTime + seconds, audioFile: track?.file ?? '', audioSeconds: track?.seconds ?? 0,visualSeconds,audioStart:chapterTime+visualSeconds,beat }
      chapterTime += seconds
      return result
    })
    const chapter = { ...definition, start: storyTime, end: storyTime + chapterTime, cues, annotationIds: annotations.filter(annotation => annotation.chapterIndex === chapterIndex).map(annotation => annotation.id) }
    storyTime = chapter.end
    return chapter
  })
  return { chapters, duration: storyTime }
}

export function locateMoment(timeline: PlaybackTimeline, requested: number) {
  const time = Math.max(0, Math.min(timeline.duration, requested))
  const foundChapter = timeline.chapters.findIndex(chapter => time >= chapter.start && time < chapter.end)
  const chapterIndex = foundChapter < 0 ? timeline.chapters.length - 1 : foundChapter
  const chapter = timeline.chapters[chapterIndex]!
  // Use the same absolute boundaries as seeking. Subtracting a fractional
  // chapter start can move an exact clicked boundary into the previous cue.
  const foundCue = chapter.cues.findIndex(cue => time >= chapter.start + cue.start && time < chapter.start + cue.end)
  const cueIndex = foundCue < 0 ? chapter.cues.length - 1 : foundCue
  const cue=chapter.cues[cueIndex]!,cueLocalSeconds=Math.max(0,time-chapter.start-cue.start)
  return { chapter, chapterIndex, cue, cueIndex,cueLocalSeconds,phase:cueLocalSeconds<cue.visualSeconds?'visual' as const:'narration' as const }
}
