import { describe, expect, it } from 'vitest'
import sceneFixture from '../packages/silk-road-demo/scene.json'
import type { SceneFile } from '../contracts/src/types.ts'
import type { ExperienceFile } from '../contracts/src/experience.ts'
import { sampleExperience, validateExperience } from '../processing/src/experience-compile.ts'

function fixture(): { scene: SceneFile; experience: ExperienceFile } {
  const scene = structuredClone(sceneFixture) as SceneFile
  const tool = structuredClone(scene.objects.find((item) => item.id === 'obj-crate')!)
  tool.id = 'obj-tool'
  tool.position = [-2.5, 1, 16]
  scene.objects.push(tool)
  const experience: ExperienceFile = {
    experienceVersion: '1.0.0', storyId: scene.storyId, sceneRevision: scene.sceneRevision, durationSeconds: 30,
    beats: [
      { id: 'departure', label: '出发', startSeconds: 0, endSeconds: 10, focusObjectIds: ['obj-beast', 'obj-pack-a'], evidenceType: 'illustrative' },
      { id: 'load', label: '载物', startSeconds: 10, endSeconds: 20, focusObjectIds: ['obj-human-scale', 'obj-tool'], evidenceType: 'illustrative' },
      { id: 'weather', label: '环境', startSeconds: 20, endSeconds: 30, focusObjectIds: ['obj-road-ahead'], evidenceType: 'illustrative' },
    ],
    tracks: [
      { id: 'beast-move', type: 'transform', objectId: 'obj-beast', evidenceType: 'illustrative', keyframes: [{ timeSeconds: 0, position: [0, 0, 2], yawRad: 0 }, { timeSeconds: 10, position: [1, 0, 0], yawRad: Math.PI / 2 }, { timeSeconds: 30, position: [1, 0, -5], yawRad: Math.PI / 2 }] },
      { id: 'cargo-on-beast', type: 'attachment', childObjectId: 'obj-pack-a', parentObjectId: 'obj-beast', localPosition: [0, 2, 0], localYawRad: 0, startSeconds: 0, endSeconds: 30, evidenceType: 'illustrative' },
      { id: 'human-move', type: 'transform', objectId: 'obj-human-scale', evidenceType: 'illustrative', keyframes: [{ timeSeconds: 0, position: [-3, 0, 16], yawRad: 0 }, { timeSeconds: 10, position: [-2, 0, 14], yawRad: Math.PI / 2 }, { timeSeconds: 30, position: [-2, 0, 14], yawRad: Math.PI / 2 }] },
      { id: 'tool-with-human', type: 'attachment', childObjectId: 'obj-tool', parentObjectId: 'obj-human-scale', localPosition: [0.5, 1, 0], localYawRad: 0, startSeconds: 0, endSeconds: 30, evidenceType: 'illustrative' },
      { id: 'road-visible', type: 'visibility', objectId: 'obj-road-ahead', evidenceType: 'illustrative', keyframes: [{ timeSeconds: 0, visible: false }, { timeSeconds: 20, visible: true }, { timeSeconds: 30, visible: true }] },
    ],
    cameraCues: [],
    environment: { keyframes: [{ timeSeconds: 0, fogColor: '#16233a', fogNearM: 80, fogFarM: 220, lightIntensity: 1 }, { timeSeconds: 20, fogColor: '#5b6673', fogNearM: 40, fogFarM: 150, lightIntensity: 0.7 }, { timeSeconds: 30, fogColor: '#5b6673', fogNearM: 40, fogFarM: 150, lightIntensity: 0.7 }] },
    audio: [],
  }
  return { scene, experience }
}

describe('experience sampler', () => {
  it('samples independent carrier, human, attachment and environment channels from any time', () => {
    const { scene, experience } = fixture()
    expect(validateExperience(scene, experience)).toEqual([])
    const middle = sampleExperience(scene, experience, 10)
    expect(middle.beatId).toBe('load')
    expect(middle.objects['obj-pack-a'].position).toEqual([1, 2, 0])
    expect(middle.objects['obj-tool'].position[2]).toBeCloseTo(13.5)
    expect(middle.objects['obj-road-ahead'].visible).toBe(false)
    const end = sampleExperience(scene, experience, 25)
    expect(end.objects['obj-pack-a'].position[2]).toBeCloseTo(-3.75)
    expect(end.objects['obj-road-ahead'].visible).toBe(true)
    expect(end.environment.fogNearM).toBe(40)
    const reset = sampleExperience(scene, experience, 0)
    expect(reset.objects['obj-pack-a'].position).toEqual([0, 2, 2])
    expect(reset.objects['obj-tool'].position).toEqual([-2.5, 1, 16])
  })

  it('rejects conflicting or cyclical attachment tracks', () => {
    const { scene, experience } = fixture()
    experience.tracks.push({ id: 'loop', type: 'attachment', childObjectId: 'obj-beast', parentObjectId: 'obj-pack-a', localPosition: [0, 0, 0], localYawRad: 0, startSeconds: 0, endSeconds: 30, evidenceType: 'illustrative' })
    expect(validateExperience(scene, experience).some((item) => item.startsWith('ATTACHMENT_CYCLE'))).toBe(true)
  })

  it('resolves two-level attachments in order and leaves inactive children at baseline', () => {
    const { scene, experience } = fixture()
    const satchel = structuredClone(scene.objects.find((item) => item.id === 'obj-crate')!)
    satchel.id = 'obj-satchel'
    satchel.position = [8, 0, 8]
    scene.objects.push(satchel)
    experience.tracks.push({ id: 'satchel-on-tool', type: 'attachment', childObjectId: 'obj-satchel', parentObjectId: 'obj-tool', localPosition: [0.1, 0, 0], localYawRad: 0, startSeconds: 5, endSeconds: 25, evidenceType: 'illustrative' })
    expect(sampleExperience(scene, experience, 0).objects['obj-satchel'].position).toEqual([8, 0, 8])
    const middle = sampleExperience(scene, experience, 10)
    expect(middle.objects['obj-satchel'].position[0]).toBeCloseTo(middle.objects['obj-tool'].position[0])
    expect(middle.objects['obj-satchel'].position[2]).toBeCloseTo(middle.objects['obj-tool'].position[2] - 0.1)
    expect(sampleExperience(scene, experience, 30).objects['obj-satchel'].position).toEqual([8, 0, 8])
  })

  it('rejects audio paths that leave the release package', () => {
    const { scene, experience } = fixture()
    experience.audio.push({ id: 'bad-audio', path: '../outside.mp3', startSeconds: 0, endSeconds: 10, loop: false, volume: 0.5, defaultEnabled: false, rights: 'test' })
    expect(validateExperience(scene, experience).some((item) => item.includes('EXPERIENCE_SCHEMA_INVALID') || item.includes('AUDIO_INVALID'))).toBe(true)
  })
})
