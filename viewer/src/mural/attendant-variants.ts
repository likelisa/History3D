import * as THREE from 'three'
import type { WalkRig } from './walking.ts'

export type AttendantRole = 'staff-bearer' | 'pack-carrier'

export const attendantVariantSource = {
  file: '/yuezhi/figures/yuezhi.glb',
  sha256: '5051979679573bec5b1c4805480698de04654dea3d2ba221c708223e795411fa',
  historicalStatus: 'Anonymous story attendants; robe colours and baggage are authored illustration, not attested Han uniforms',
} as const

const robeMultipliers: Record<AttendantRole, readonly [number, number, number]> = {
  'staff-bearer': [.62, .80, 1.45],
  'pack-carrier': [1.32, .84, .56],
}

/** Apply before bindWalkRig, to a cloned, grounded and scaled Tripo body.
 * It changes only mapped robe colours. UVs, face, hands, leg/foot positions,
 * original PBR textures and the captured fixed-arm gait remain intact.
 * The default yaw is the verified standing heading of yuezhi.glb; the caller
 * must pass the same sourceYaw to bindWalkRig afterwards.
 */
export function prepareAttendantVariant(body: THREE.Group, role: AttendantRole, sourceYaw = -Math.PI / 3): void {
  if (body.userData.attendantVariant) throw new Error('随从变体已经准备，不能重复染色或重新绑定')
  body.updateMatrixWorld(true)
  const inverse = body.matrixWorld.clone().invert()
  const meshes: THREE.Mesh[] = []
  body.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object) })
  if (!meshes.length || meshes.some(mesh => mesh instanceof THREE.SkinnedMesh)) throw new Error('随从变体必须在真实身体绑定步行动作之前准备')
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const mesh of meshes) {
    const matrix = inverse.clone().multiply(mesh.matrixWorld)
    const position = mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) bounds.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(matrix))
  }
  const height = bounds.max.y - bounds.min.y
  if (!Number.isFinite(height) || height < .5) throw new Error('随从身体尺寸无效')
  const tint = robeMultipliers[role]
  let tintedVertices = 0
  for (const mesh of meshes) {
    // Shared clone() templates share geometry/materials. Detach both before
    // adding any variant attributes; texture objects remain read-only shared.
    mesh.geometry = mesh.geometry.clone()
    const position = mesh.geometry.getAttribute('position')
    const originalColours = mesh.geometry.getAttribute('color')
    const colours = new Float32Array(position.count * 3)
    const matrix = new THREE.Matrix4().makeRotationY(sourceYaw).multiply(inverse.clone().multiply(mesh.matrixWorld))
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix)
      const y = (point.y - bounds.min.y) / height, x = Math.abs(point.x) / height
      // Upper sleeves end above the wrists. Low forearms/hands, the belt,
      // trousers, boots and all head/neck vertices retain their source colour.
      const upperRobe = y > .59 && y < .80 && x < .225
      const lowerRobe = y > .31 && y < .51 && x < .175
      const garment = upperRobe || lowerRobe
      const edge = garment ? Math.min(1,
        upperRobe ? (y - .59) / .025 : (y - .31) / .025,
        upperRobe ? (.80 - y) / .025 : (.51 - y) / .025) : 0
      const weight = THREE.MathUtils.smoothstep(edge, 0, 1)
      if (weight > 0) tintedVertices++
      for (let channel = 0; channel < 3; channel++) {
        const original = originalColours ? originalColours.getComponent(i, channel) : 1
        colours[i * 3 + channel] = original * THREE.MathUtils.lerp(1, tint[channel]!, weight)
      }
    }
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
    const material = (source: THREE.Material) => {
      const clone = source.clone()
      if (clone instanceof THREE.MeshStandardMaterial) clone.vertexColors = true
      return clone
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material)
  }
  if (!tintedVertices) throw new Error('随从变体未定位到真实袍身')
  body.userData.attendantVariant = { role, height, source: attendantVariantSource,
    robeColour: role === 'staff-bearer' ? 'grey blue' : 'ochre brown',
    tintedVertices, originalFaceHandsFeetAndPBRPreserved: true, geometryPositionsUnchanged: true,
    equipmentAfterRig: role === 'pack-carrier' }
}

/** Attach only AFTER bindWalkRig. Accessory meshes have no soles and must
 * never enter neutralizeFeet or be rebound as leg meshes. They follow pelvis
 * bob, without changing either hand or any captured walking channel.
 */
export function attachAttendantEquipment(body: THREE.Group, rig: WalkRig, role: AttendantRole): THREE.Group | undefined {
  if (body.userData.attendantVariant?.role !== role) throw new Error('随从行囊与已准备的人物角色不符')
  if (role === 'staff-bearer') return undefined
  if (body.getObjectByName('Attendant travel baggage')) throw new Error('随从行囊已经挂接')
  const pelvis = rig.skeleton.bones.find(bone => bone.name === 'walk-pelvis')
  if (!pelvis) throw new Error('随从行囊缺少已绑定腰骨')
  const h = body.userData.attendantVariant.height as number
  const baggage = new THREE.Group(); baggage.name = 'Attendant travel baggage'
  baggage.userData = { authoredAccessory: true, historicalStatus: 'Illustrative plain travel baggage, not an excavated object' }
  const cloth = new THREE.MeshStandardMaterial({ color: '#826345', roughness: .97, metalness: 0 })
  const seam = new THREE.MeshStandardMaterial({ color: '#483626', roughness: 1, metalness: 0 })
  const leather = new THREE.MeshStandardMaterial({ color: '#59402b', roughness: .89, metalness: 0 })
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: number[], scale?: number[]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name
    mesh.position.fromArray(position); if (scale) mesh.scale.fromArray(scale)
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.attendantAccessory = true
    baggage.add(mesh); return mesh
  }
  // A soft side bundle and a small water bag give a readable silhouette while
  // leaving knees, shoes and the lowered hands clear of decoration.
  add('Pack carrier folded cloth bundle', new THREE.SphereGeometry(1, 24, 16), cloth,
    [-h * .205, h * .045, -h * .005], [h * .075, h * .10, h * .062])
  add('Pack carrier bundle fold', new THREE.SphereGeometry(1, 20, 12), cloth,
    [-h * .205, h * .095, h * .003], [h * .077, h * .040, h * .064])
  add('Pack carrier water bag', new THREE.SphereGeometry(1, 20, 14), leather,
    [h * .19, -h * .012, h * .042], [h * .045, h * .068, h * .038])
  add('Pack carrier water bag neck', new THREE.CylinderGeometry(h * .015, h * .018, h * .035, 12), leather,
    [h * .19, h * .06, h * .042])
  const tube = (name: string, points: number[][], radius: number, material: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(points.map(values => new THREE.Vector3().fromArray(values).multiplyScalar(h)))
    add(name, new THREE.TubeGeometry(curve, 24, h * radius, 6, false), material, [0, 0, 0])
  }
  tube('Pack carrier cloth bundle binding', [[-.28, .04, .055], [-.205, .065, .06], [-.13, .04, .055]], .004, seam)
  tube('Pack carrier diagonal carrying strap', [[-.145, .245, .14], [-.09, .18, .155], [0, .09, .16], [.105, -.03, .15]], .011, leather)
  tube('Pack carrier water bag attachment', [[.15, .10, .105], [.18, .065, .055], [.19, .055, .042]], .004, seam)
  pelvis.add(baggage)
  body.userData.attendantVariant.features = ['ochre brown robe', 'folded cloth side bundle', 'small water bag', 'diagonal leather carrying strap']
  body.updateMatrixWorld(true); rig.skeleton.update()
  return baggage
}
