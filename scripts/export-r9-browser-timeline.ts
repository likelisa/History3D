import { readFile, writeFile } from 'node:fs/promises'
import { chapters } from '../viewer/src/mural/story.ts'
import { buildPlaybackTimeline } from '../viewer/src/mural/playback.ts'

const narration = JSON.parse(await readFile('viewer/public/mural-assets/narration-v12/manifest.json', 'utf8'))
const timeline = buildPlaybackTimeline(chapters, narration.tracks)
const output = { duration: timeline.duration, cues: timeline.chapters.flatMap((chapter, chapterIndex) =>
  chapter.cues.map((cue, cueIndex) => ({ id: cue.id, chapterIndex, cueIndex, start: chapter.start + cue.start,
    end: chapter.start + cue.end, audioStart: chapter.start + cue.audioStart, audioSeconds: cue.audioSeconds, text: cue.text, subtitlePoints: cue.subtitlePoints, visualSeconds: cue.visualSeconds, beat: cue.beat?.id ?? null }))) }
const destination = process.argv[2]
if (!destination) throw new Error('A new output path is required')
await writeFile(destination, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ destination, duration: output.duration, cues: output.cues.length }))
