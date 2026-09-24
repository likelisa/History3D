import type { Vec3 } from './types.ts'

export interface ExperienceBeat {
  id: string
  label: string
  startSeconds: number
  endSeconds: number
  focusObjectIds: string[]
  evidenceType: 'documented' | 'inferred' | 'illustrative'
}

export interface TransformTrack {
  id: string
  type: 'transform'
  objectId: string
  keyframes: Array<{ timeSeconds: number; position: Vec3; yawRad: number }>
  evidenceType: 'documented' | 'inferred' | 'illustrative'
}

export interface VisibilityTrack {
  id: string
  type: 'visibility'
  objectId: string
  keyframes: Array<{ timeSeconds: number; visible: boolean }>
  evidenceType: 'documented' | 'inferred' | 'illustrative'
}

export interface AttachmentTrack {
  id: string
  type: 'attachment'
  childObjectId: string
  parentObjectId: string
  localPosition: Vec3
  localYawRad: number
  startSeconds: number
  endSeconds: number
  evidenceType: 'documented' | 'inferred' | 'illustrative'
}

export type ExperienceTrack = TransformTrack | VisibilityTrack | AttachmentTrack

export interface EnvironmentKeyframe {
  timeSeconds: number
  fogColor: string
  fogNearM: number
  fogFarM: number
  lightIntensity: number
}

export interface ExperienceFile {
  experienceVersion: '1.0.0'
  storyId: string
  sceneRevision: number
  durationSeconds: number
  beats: ExperienceBeat[]
  tracks: ExperienceTrack[]
  cameraCues: Array<{ id: string; timeSeconds: number; position: Vec3; target: Vec3; evidenceType: 'documented' | 'inferred' | 'illustrative' }>
  environment: { keyframes: EnvironmentKeyframe[] }
  audio: Array<{ id: string; path: string; startSeconds: number; endSeconds: number; loop: boolean; volume: number; defaultEnabled: false; rights: string }>
}
