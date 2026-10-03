import type { locateMoment } from './playback.ts'
import { sceneBeatProgress, type SceneBeat } from './scene-beats.ts'
import type { PresentationView } from './cue-presentation.ts'

type Moment = ReturnType<typeof locateMoment>
export type SpatialFrame = {
  beat: SceneBeat
  progress: number
  ambientSeconds: number
  cueId: string
}
export type PresentationFrame = { key: string; mode: PresentationView; spatial?: SpatialFrame }
export type PresentationState = {
  displayed: PresentationFrame
  pending: PresentationFrame | null
  elapsed: number
  opacity: number
}
export const sceneTransitionSeconds = 1.1
const coveredAt = sceneTransitionSeconds / 2
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** Reconstruct from the timeline, so seeking does not depend on previous frames. */
export function presentationFrame(moment: Moment, mode: PresentationView): PresentationFrame {
  if (mode !== 'spatial' || !moment.cue.beat) {
    const resolved = mode === 'spatial' ? 'map' : mode
    return { key: resolved, mode: resolved }
  }
  let first = moment.cueIndex
  while (first > 0 && moment.chapter.cues[first - 1]!.beat?.id === moment.cue.beat.id) first--
  const firstCue = moment.chapter.cues[first]!
  const elapsed = moment.cue.start + moment.cueLocalSeconds - firstCue.start
  return {
    key: `spatial:${moment.chapterIndex}:${firstCue.id}`,
    mode: 'spatial',
    spatial: {
      beat: firstCue.beat!,
      progress: sceneBeatProgress(elapsed, firstCue.beat!),
      ambientSeconds: moment.cue.start + moment.cueLocalSeconds,
      cueId: moment.cue.id,
    },
  }
}

/** Seek/replay enter their reconstructed frame directly, clearing pending cuts. */
export function resetPresentation(frame: PresentationFrame): PresentationState {
  return { displayed: frame, pending: null, elapsed: sceneTransitionSeconds, opacity: 0 }
}

/** Freeze the outgoing scene until an opaque frame hides the actual scene cut. */
export function advancePresentation(state: PresentationState, requested: PresentationFrame, deltaSeconds: number): PresentationState {
  let displayed = state.displayed, pending = state.pending, elapsed = state.elapsed
  if (requested.key === displayed.key) {
    if (pending) {
      // A manual toggle back before the cut reverses the same cover smoothly.
      elapsed = sceneTransitionSeconds - Math.min(elapsed, coveredAt)
      pending = null
    }
    displayed = requested
  } else if (pending?.key !== requested.key) {
    pending = requested
    elapsed = state.elapsed >= sceneTransitionSeconds ? 0 : Math.asin(clamp(state.opacity, 0, 1)) / Math.PI * sceneTransitionSeconds
  } else pending = requested
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
  elapsed = Math.min(sceneTransitionSeconds, elapsed + dt)
  let cut = false
  if (pending && elapsed >= coveredAt) {
    displayed = pending
    pending = null
    cut = true
  }
  const opacity = cut ? 1 : elapsed < sceneTransitionSeconds ? Math.sin(elapsed / sceneTransitionSeconds * Math.PI) : 0
  return { displayed, pending, elapsed, opacity }
}

/** Both map sizes use the same cue clock, regardless of the rendered view. */
export function cueRouteProgress(moment: Moment): number {
  const duration = moment.cue.end - moment.cue.start
  return duration > 0 && Number.isFinite(moment.cueLocalSeconds) ? clamp(moment.cueLocalSeconds / duration, 0, 1) : 0
}
