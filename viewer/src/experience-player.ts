import * as THREE from 'three'
import type { ExperienceFile } from '../../contracts/src/experience.ts'
import type { SceneFile } from '../../contracts/src/types.ts'
import { createExperienceSampler, type SampledExperience } from '../../processing/src/experience-compile.ts'
import type { HotspotMarker } from './hotspots.ts'
import type { World } from './world.ts'

export class ExperiencePlayer {
  readonly durationSeconds: number
  private readonly sample: (timeSeconds: number) => SampledExperience
  private readonly groups: Map<string, THREE.Group>
  private readonly lightBases: Array<{ light: THREE.Light; intensity: number }>

  constructor(private scene: SceneFile, readonly experience: ExperienceFile, world: World, private scene3d: THREE.Scene, private markers: HotspotMarker[]) {
    this.sample = createExperienceSampler(scene, experience)
    this.durationSeconds = experience.durationSeconds
    this.groups = new Map(world.objects.map((item) => [item.definition.id, item.group]))
    this.lightBases = []
    world.root.traverse((object) => { if (object instanceof THREE.Light) this.lightBases.push({ light: object, intensity: object.intensity }) })
  }

  apply(timeSeconds: number): SampledExperience {
    const sampled = this.sample(timeSeconds)
    for (const [objectId, state] of Object.entries(sampled.objects)) {
      const group = this.groups.get(objectId)
      if (!group) continue
      group.position.set(...state.position)
      group.rotation.y = state.yawRad
      group.visible = state.visible
    }
    for (const marker of this.markers) {
      const binding = this.scene.hotspotBindings.find((item) => item.hotspotId === marker.hotspot.id)
      if (binding?.anchor.type !== 'object') continue
      const group = this.groups.get(binding.anchor.objectId)
      if (!group) continue
      const offset = new THREE.Vector3(...binding.anchor.offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y)
      marker.marker.position.copy(group.position).add(offset)
      marker.marker.visible = group.visible
    }
    const environment = sampled.environment
    if (this.scene3d.fog instanceof THREE.Fog) {
      this.scene3d.fog.color.set(environment.fogColor)
      this.scene3d.fog.near = environment.fogNearM
      this.scene3d.fog.far = environment.fogFarM
    }
    if (this.scene3d.background instanceof THREE.Color) this.scene3d.background.set(environment.fogColor)
    else this.scene3d.background = new THREE.Color(environment.fogColor)
    for (const { light, intensity } of this.lightBases) light.intensity = intensity * environment.lightIntensity
    return sampled
  }
}
