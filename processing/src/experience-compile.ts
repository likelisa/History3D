import type { AttachmentTrack, ExperienceFile, TransformTrack, VisibilityTrack } from '../../contracts/src/experience.ts'
import type { SceneFile, Vec3 } from '../../contracts/src/types.ts'
import Ajv2020 from 'ajv/dist/2020.js'
import experienceSchema from '../../contracts/schemas/handoff/experience.schema.json'

export interface SampledObject { position: Vec3; yawRad: number; visible: boolean }
export interface SampledExperience {
  timeSeconds: number
  beatId: string | null
  objects: Record<string, SampledObject>
  environment: { fogColor: string; fogNearM: number; fogFarM: number; lightIntensity: number }
}

const schemaValidator = new Ajv2020({ allErrors: true, strict: false }).compile(experienceSchema)

export function validateExperience(scene: SceneFile, experience: ExperienceFile): string[] {
  const errors: string[] = []
  if (!schemaValidator(experience)) return (schemaValidator.errors ?? []).map((error) => `EXPERIENCE_SCHEMA_INVALID: ${error.instancePath} ${error.message}`)
  if (experience.experienceVersion !== '1.0.0' || experience.storyId !== scene.storyId || experience.sceneRevision !== scene.sceneRevision) errors.push('EXPERIENCE_REVISION_MISMATCH')
  if (!Number.isFinite(experience.durationSeconds) || experience.durationSeconds <= 0) errors.push('EXPERIENCE_DURATION_INVALID')
  const objectIds = new Set(scene.objects.map((item) => item.id))
  const trackIds = new Set<string>()
  const propertyTracks = new Set<string>()
  const attachments = new Map<string, string>()
  for (const track of experience.tracks) {
    if (!track.id || trackIds.has(track.id)) errors.push(`TRACK_ID_DUPLICATE: ${track.id}`)
    trackIds.add(track.id)
    if (track.type === 'attachment') {
      if (!objectIds.has(track.childObjectId) || !objectIds.has(track.parentObjectId) || track.childObjectId === track.parentObjectId) errors.push(`ATTACHMENT_OBJECT_INVALID: ${track.id}`)
      if (!validTime(track.startSeconds, experience.durationSeconds) || !validTime(track.endSeconds, experience.durationSeconds) || track.startSeconds >= track.endSeconds) errors.push(`ATTACHMENT_RANGE_INVALID: ${track.id}`)
      if (!vec3Valid(track.localPosition) || !Number.isFinite(track.localYawRad)) errors.push(`ATTACHMENT_TRANSFORM_INVALID: ${track.id}`)
      if (Boolean(track.parentAnchorM) !== Boolean(track.childAnchorM)) errors.push(`ATTACHMENT_ANCHOR_INCOMPLETE: ${track.id}`)
      if (track.parentAnchorM && track.childAnchorM) {
        if (!vec3Valid(track.parentAnchorM) || !vec3Valid(track.childAnchorM)) errors.push(`ATTACHMENT_ANCHOR_INVALID: ${track.id}`)
        else {
          const childAnchor = rotateYaw(track.childAnchorM, track.localYawRad)
          const gap = Math.hypot(...track.parentAnchorM.map((value, axis) => value - track.localPosition[axis] - childAnchor[axis]))
          if (gap > 0.05) errors.push(`ATTACHMENT_ANCHOR_MISMATCH: ${track.id}`)
        }
      }
      if (attachments.has(track.childObjectId)) errors.push(`ATTACHMENT_CONFLICT: ${track.childObjectId}`)
      attachments.set(track.childObjectId, track.parentObjectId)
      continue
    }
    if (!objectIds.has(track.objectId)) errors.push(`TRACK_OBJECT_UNKNOWN: ${track.id}`)
    const key = `${track.type}:${track.objectId}`
    if (propertyTracks.has(key)) errors.push(`TRACK_CONFLICT: ${key}`)
    propertyTracks.add(key)
    if (!track.keyframes.length || track.keyframes[0].timeSeconds !== 0 || track.keyframes.at(-1)?.timeSeconds !== experience.durationSeconds) errors.push(`TRACK_RANGE_INVALID: ${track.id}`)
    let prior = -1
    for (const frame of track.keyframes) {
      if (!validTime(frame.timeSeconds, experience.durationSeconds) || frame.timeSeconds <= prior) errors.push(`TRACK_TIME_INVALID: ${track.id}`)
      prior = frame.timeSeconds
      if (track.type === 'transform' && (!vec3Valid((frame as TransformTrack['keyframes'][number]).position) || !Number.isFinite((frame as TransformTrack['keyframes'][number]).yawRad))) errors.push(`TRACK_TRANSFORM_INVALID: ${track.id}`)
      if (track.type === 'visibility' && typeof (frame as VisibilityTrack['keyframes'][number]).visible !== 'boolean') errors.push(`TRACK_VISIBILITY_INVALID: ${track.id}`)
    }
  }
  for (const child of attachments.keys()) {
    if (propertyTracks.has(`transform:${child}`)) errors.push(`ATTACHED_CHILD_HAS_WORLD_TRACK: ${child}`)
    const seen = new Set<string>()
    let cursor: string | undefined = child
    while (cursor && attachments.has(cursor)) {
      if (seen.has(cursor)) { errors.push(`ATTACHMENT_CYCLE: ${child}`); break }
      seen.add(cursor)
      cursor = attachments.get(cursor)
    }
  }
  const beatIds = new Set<string>()
  let end = 0
  for (const beat of experience.beats) {
    if (!beat.id || beatIds.has(beat.id) || beat.startSeconds < end || beat.endSeconds <= beat.startSeconds || beat.endSeconds > experience.durationSeconds || beat.focusObjectIds.some((id) => !objectIds.has(id))) errors.push(`BEAT_INVALID: ${beat.id}`)
    beatIds.add(beat.id)
    end = beat.endSeconds
  }
  const environment = experience.environment.keyframes
  if (!environment.length || environment[0].timeSeconds !== 0 || environment.at(-1)?.timeSeconds !== experience.durationSeconds) errors.push('ENVIRONMENT_RANGE_INVALID')
  let priorEnvironmentTime = -1
  for (const frame of environment) {
    if (!validTime(frame.timeSeconds, experience.durationSeconds) || frame.timeSeconds <= priorEnvironmentTime || frame.fogNearM < 0 || frame.fogFarM <= frame.fogNearM || frame.lightIntensity < 0 || !/^#[a-fA-F0-9]{6}$/.test(frame.fogColor)) errors.push('ENVIRONMENT_FRAME_INVALID')
    priorEnvironmentTime = frame.timeSeconds
  }
  for (const cue of experience.cameraCues) if (!validTime(cue.timeSeconds, experience.durationSeconds) || !vec3Valid(cue.position) || !vec3Valid(cue.target)) errors.push(`CAMERA_CUE_INVALID: ${cue.id}`)
  for (const audio of experience.audio) if (!audio.id || !safeAudioPath(audio.path) || audio.defaultEnabled !== false || audio.startSeconds < 0 || audio.endSeconds > experience.durationSeconds || audio.startSeconds >= audio.endSeconds || audio.volume < 0 || audio.volume > 1) errors.push(`AUDIO_INVALID: ${audio.id}`)
  return errors
}

export function sampleExperience(scene: SceneFile, experience: ExperienceFile, requestedTime: number): SampledExperience {
  return createExperienceSampler(scene, experience)(requestedTime)
}

export function createExperienceSampler(scene: SceneFile, experience: ExperienceFile): (requestedTime: number) => SampledExperience {
  const problems = validateExperience(scene, experience)
  if (problems.length) throw new Error(problems.join('; '))
  return (requestedTime: number) => sampleValidated(scene, experience, requestedTime)
}

function sampleValidated(scene: SceneFile, experience: ExperienceFile, requestedTime: number): SampledExperience {
  if (!Number.isFinite(requestedTime)) throw new Error('EXPERIENCE_TIME_INVALID')
  const time = Math.max(0, Math.min(experience.durationSeconds, requestedTime))
  const objects: Record<string, SampledObject> = Object.fromEntries(scene.objects.map((item) => [item.id, { position: [...item.position] as Vec3, yawRad: item.rotation[1], visible: true }]))
  for (const track of experience.tracks) {
    if (track.type === 'transform') {
      const frame = interpolate(track.keyframes, time)
      objects[track.objectId] = { ...objects[track.objectId], position: frame.position, yawRad: frame.yawRad }
    } else if (track.type === 'visibility') {
      objects[track.objectId].visible = step(track.keyframes, time).visible
    }
  }
  const attachments = new Map(experience.tracks.filter((track): track is AttachmentTrack => track.type === 'attachment').map((track) => [track.childObjectId, track]))
  const resolved = new Set<string>()
  const applyAttachment = (childId: string): void => {
    if (resolved.has(childId)) return
    const track = attachments.get(childId)
    if (!track) return
    if (attachments.has(track.parentObjectId)) applyAttachment(track.parentObjectId)
    if (time >= track.startSeconds && time <= track.endSeconds) {
      const parent = objects[track.parentObjectId]
      const local = rotateYaw(track.localPosition, parent.yawRad)
      objects[track.childObjectId] = { position: [parent.position[0] + local[0], parent.position[1] + local[1], parent.position[2] + local[2]], yawRad: parent.yawRad + track.localYawRad, visible: parent.visible && objects[track.childObjectId].visible }
    }
    resolved.add(childId)
  }
  for (const childId of attachments.keys()) applyAttachment(childId)
  const env = interpolate(experience.environment.keyframes, time)
  const beat = experience.beats.find((item) => time >= item.startSeconds && (time < item.endSeconds || (time === experience.durationSeconds && item.endSeconds === time)))
  return { timeSeconds: time, beatId: beat?.id ?? null, objects, environment: env }
}

function validTime(value: number, duration: number): boolean { return Number.isFinite(value) && value >= 0 && value <= duration }
function safeAudioPath(value: string): boolean { return Boolean(value) && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some((part) => !part || part === '.' || part === '..') && !value.includes(':') }
function vec3Valid(value: unknown): value is Vec3 { return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item)) }
function rotateYaw([x, y, z]: Vec3, yaw: number): Vec3 { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c + z * s, y, z * c - x * s] }
function step<T extends { timeSeconds: number }>(frames: T[], time: number): T { return [...frames].reverse().find((frame) => frame.timeSeconds <= time) ?? frames[0] }
function interpolate<T extends { timeSeconds: number }>(frames: T[], time: number): T {
  const left = step(frames, time)
  const right = frames.find((frame) => frame.timeSeconds >= time) ?? frames.at(-1)!
  if (left === right || right.timeSeconds === left.timeSeconds) return structuredClone(left)
  const factor = (time - left.timeSeconds) / (right.timeSeconds - left.timeSeconds)
  const result: Record<string, unknown> = { timeSeconds: time }
  for (const [key, value] of Object.entries(left)) {
    if (key === 'timeSeconds') continue
    const next = (right as Record<string, unknown>)[key]
    if (Array.isArray(value) && Array.isArray(next) && value.length !== next.length) throw new Error(`EXPERIENCE_KEYFRAME_SHAPE_INVALID: ${key}`)
    result[key] = typeof value === 'number' && typeof next === 'number' ? value + (next - value) * factor
      : Array.isArray(value) && Array.isArray(next) ? value.map((item, index) => item + (next[index] - item) * factor)
      : value
  }
  return result as unknown as T
}
