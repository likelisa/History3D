export type MediaClock = { cueId: string; currentTime: number; duration: number; paused: boolean; ended: boolean; ready: boolean }
export type CueClock = { id: string; audioStart: number; audioSeconds: number; end: number }

/** The media position drives speech. Wall time only drives visuals and reading pauses. */
export function advanceStoryClock(time: number, delta: number, speed: number, cue: CueClock, media: MediaClock, voice: boolean): number {
  const wallNext = Math.min(cue.end, time + Math.max(0, delta) * speed)
  if (!voice) return wallNext
  if (time < cue.audioStart) return Math.min(wallNext, cue.audioStart)
  // Seeking into the reading tail intentionally skips the finished recording.
  if (media.cueId !== cue.id) return time >= cue.audioStart + cue.audioSeconds ? wallNext : time
  if (!media.ready || !Number.isFinite(media.currentTime)) return Math.min(time, cue.end - .005)
  const position = Math.max(0, Math.min(cue.audioSeconds, media.currentTime))
  const spokenEnd = cue.audioStart + Math.min(cue.audioSeconds, Number.isFinite(media.duration) ? media.duration : cue.audioSeconds)
  if (!media.ended) return Math.min(cue.end - .005, cue.audioStart + position)
  // A delayed animation frame must catch up to the completed clip before its
  // reading pause; it cannot skip the following cue's visual action or audio.
  if (time < spokenEnd) return Math.min(cue.end, spokenEnd)
  return wallNext
}

export function subtitleMediaSeconds(cue: CueClock, storyTime: number, media: MediaClock, voice: boolean): number {
  const local = storyTime - cue.audioStart
  if (local < 0 || !voice || media.cueId !== cue.id || !media.ready || !Number.isFinite(media.currentTime)) return local
  return Math.max(0, Math.min(cue.audioSeconds, media.currentTime))
}
