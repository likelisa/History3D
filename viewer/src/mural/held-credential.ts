import * as THREE from 'three'
import type { WalkRig } from './walking.ts'

/** Adopt the user's selected Tripo slender shaft, positioned from the actual
 * posed fingers. It is a visual carrier for the envoy's credential, not a claim
 * that the traded Qiong bamboo and a Han credential had identical manufacture.
 */
export function attachSlenderCredential(model: THREE.Group, rig: WalkRig, template: THREE.Group) {
  if (!rig.rightHand) throw new Error('持节道具缺少真实手部骨骼')
  rig.update(0, 0, true)
  model.updateMatrixWorld(true); rig.skeleton.update()
  const handIndex = rig.skeleton.bones.indexOf(rig.rightHand)
  const point = new THREE.Vector3(), centre = new THREE.Vector3()
  let count = 0
  const inverse = model.matrixWorld.clone().invert()
  for (const mesh of rig.meshes) {
    const p = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    for (let index = 0; index < p.count; index++) {
      let handWeight = 0
      for (let channel = 0; channel < 4; channel++) if (indices.getComponent(index, channel) === handIndex) handWeight += weights.getComponent(index, channel)
      if (handWeight < .8) continue
      mesh.applyBoneTransform(index, point.fromBufferAttribute(p, index)).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse)
      centre.add(point); count++
    }
  }
  if (count < 10) throw new Error('持节道具无法定位真实手部网格')
  centre.multiplyScalar(1 / count)
  const grip = new THREE.Group(); grip.name = 'Measured credential hand grip'
  grip.position.copy(rig.rightHand.worldToLocal(model.localToWorld(centre.clone())))
  // Keep the long shaft upright even though the authored forearm is inclined.
  grip.quaternion.copy(rig.rightHand.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(model.getWorldQuaternion(new THREE.Quaternion())))
  rig.rightHand.add(grip)
  const shaft = template.clone(true); shaft.name = 'Tripo selected slender credential shaft'
  shaft.position.y = -centre.y + .055
  grip.add(shaft)
  shaft.userData.credentialShaft = { source: '/mural-assets/tripo-story-r9/qiong-bamboo.glb',
    handVertices: count, measuredHandCentre: centre.toArray(), restBottomMeters: .055,
    role: 'Illustrative carried credential shaft; not an archaeological Han credential reconstruction' }
  model.updateMatrixWorld(true)
  return shaft
}
