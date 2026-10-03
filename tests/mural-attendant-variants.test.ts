import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { attendantVariantSource, attachAttendantEquipment, prepareAttendantVariant } from '../viewer/src/mural/attendant-variants.ts'
import { bindWalkRig } from '../viewer/src/mural/walking.ts'
import { capturedStride } from '../viewer/src/mural/captured-walk.ts'

// Parse the actual preserved GLB geometry in Node. Textures are read-only
// texture handles for material-preservation assertions; this is not a render.
function attendant(height: number) {
  const bytes = readFileSync(`viewer/public${attendantVariantSource.file}`)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(attendantVariantSource.sha256)
  const length = bytes.readUInt32LE(12), binary = 28 + length
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'))
  const textures = gltf.textures.map((texture: any) => {
    const t = new THREE.Texture(); t.userData.gltfTexture = texture; return t
  })
  const materials = gltf.materials.map((source: any) => {
    const pbr = source.pbrMetallicRoughness, factor = pbr?.baseColorFactor ?? [1, 1, 1, 1]
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().fromArray(factor), opacity: factor[3],
      roughness: pbr?.roughnessFactor ?? 1, metalness: pbr?.metallicFactor ?? 1,
      map: pbr?.baseColorTexture ? textures[pbr.baseColorTexture.index] : null,
      normalMap: source.normalTexture ? textures[source.normalTexture.index] : null,
      roughnessMap: pbr?.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : null,
      metalnessMap: pbr?.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : null,
    })
  })
  const nodes = gltf.nodes.map((node: any) => {
    const object = new THREE.Group()
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale) }
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.fromArray(node.rotation)
    if (node.scale) object.scale.fromArray(node.scale)
    if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
      const geometry = new THREE.BufferGeometry()
      for (const [source, target, components] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
        const a = gltf.accessors[primitive.attributes[source]], view = gltf.bufferViews[a.bufferView]
        const data = new Float32Array(a.count * components)
        for (let i = 0; i < a.count; i++) for (let k = 0; k < components; k++) data[i * components + k] = bytes.readFloatLE(binary + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? components * 4) + k * 4)
        geometry.setAttribute(target, new THREE.Float32BufferAttribute(data, components))
      }
      const a = gltf.accessors[primitive.indices], view = gltf.bufferViews[a.bufferView], stride = a.componentType === 5123 ? 2 : 4
      geometry.setIndex(Array.from({ length: a.count }, (_, i) => stride === 2 ? bytes.readUInt16LE(binary + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride) : bytes.readUInt32LE(binary + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride)))
      object.add(new THREE.Mesh(geometry, materials[primitive.material]))
    }
    return object
  })
  gltf.nodes.forEach((node: any, i: number) => { for (const child of node.children ?? []) nodes[i].add(nodes[child]) })
  const scene = new THREE.Group()
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) scene.add(nodes[node])
  const box = new THREE.Box3().setFromObject(scene), scale = height / (box.max.y - box.min.y), center = box.getCenter(new THREE.Vector3())
  scene.scale.setScalar(scale); scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  const root = new THREE.Group(); root.add(scene); return root
}
function meshes(body: THREE.Group) {
  const found: THREE.Mesh[] = []; body.traverse(object => { if (object instanceof THREE.Mesh) found.push(object) }); return found
}

describe('distinct attendants preserve the real Tripo body and fixed-arm walk', () => {
  it('detaches shared geometry/materials and preserves positions, UVs and PBR texture references', () => {
    const template = attendant(1.72), source = meshes(template)[0]!
    const position = Array.from(source.geometry.getAttribute('position').array), uv = Array.from(source.geometry.getAttribute('uv').array)
    const staff = template.clone(true), pack = template.clone(true)
    expect(meshes(staff)[0]!.geometry).toBe(source.geometry)
    prepareAttendantVariant(staff, 'staff-bearer'); prepareAttendantVariant(pack, 'pack-carrier')
    expect(source.geometry.getAttribute('color')).toBeUndefined()
    const original = source.material as THREE.MeshStandardMaterial
    expect(original.vertexColors).toBe(false)
    expect(original.map).not.toBeNull(); expect(original.normalMap).not.toBeNull()
    for (const body of [staff, pack]) {
      const changed = meshes(body)[0]!, material = changed.material as THREE.MeshStandardMaterial
      expect(changed.geometry).not.toBe(source.geometry); expect(material).not.toBe(original)
      expect(Array.from(changed.geometry.getAttribute('position').array)).toEqual(position)
      expect(Array.from(changed.geometry.getAttribute('uv').array)).toEqual(uv)
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'roughness', 'metalness'] as const) expect(material[key]).toBe(original[key])
      expect(material.color).toEqual(original.color)
      expect(body.getObjectByName('Attendant travel baggage')).toBeUndefined()
    }
    expect(meshes(staff)[0]!.geometry.getAttribute('color').array).not.toEqual(meshes(pack)[0]!.geometry.getAttribute('color').array)
  })

  it('leaves actual head, hands, boots and trousers untinted while mapping enough robe vertices', () => {
    const h = 1.72, body = attendant(h)
    prepareAttendantVariant(body, 'pack-carrier'); body.updateMatrixWorld(true)
    const inverse = body.matrixWorld.clone().invert(), point = new THREE.Vector3(), counts = { head: 0, hands: 0, legs: 0, tinted: 0 }
    for (const mesh of meshes(body)) {
      const transform = new THREE.Matrix4().makeRotationY(-Math.PI / 3).multiply(inverse.clone().multiply(mesh.matrixWorld))
      const p = mesh.geometry.getAttribute('position'), colour = mesh.geometry.getAttribute('color')
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(transform)
        const y = point.y / h, x = Math.abs(point.x) / h
        const region = y > .84 ? 'head' : y < .30 ? 'legs' : y < .58 && x > .18 ? 'hands' : null
        if (region) {
          counts[region]++; expect([colour.getX(i), colour.getY(i), colour.getZ(i)]).toEqual([1, 1, 1])
        }
        if (colour.getX(i) !== 1 || colour.getY(i) !== 1 || colour.getZ(i) !== 1) counts.tinted++
      }
    }
    expect(counts.head).toBeGreaterThan(100); expect(counts.hands).toBeGreaterThan(20); expect(counts.legs).toBeGreaterThan(100)
    expect(counts.tinted).toBeGreaterThan(1000)
  })

  it('adds travel equipment only to the pelvis after binding and keeps feet/arms identical to the undecorated rig', () => {
    const h = 1.66, source = attendant(h), bare = source.clone(true), decorated = source.clone(true)
    prepareAttendantVariant(bare, 'pack-carrier'); prepareAttendantVariant(decorated, 'pack-carrier')
    const a = bindWalkRig(bare, h, 'human', false, -Math.PI / 3), b = bindWalkRig(decorated, h, 'human', false, -Math.PI / 3)
    const count = b.meshes.length, skin = b.meshes[0]!, positions = skin.geometry.getAttribute('position')
    const baggage = attachAttendantEquipment(decorated, b, 'pack-carrier')!
    expect(baggage.parent?.name).toBe('walk-pelvis'); expect(b.meshes).toHaveLength(count)
    expect(meshes(baggage).every(mesh => !(mesh instanceof THREE.SkinnedMesh) && mesh.userData.attendantAccessory)).toBe(true)
    const sole = Array.from({ length: positions.count }, (_, i) => i).filter(i => positions.getY(i) < h * .055)
    const stride = (b.legs[0]!.upperLength + b.legs[0]!.lowerLength) * capturedStride
    for (let step = 0; step <= 20; step++) {
      const distance = stride * (3 + step / 20)
      a.update(distance); b.update(distance)
      expect(b.state()).toEqual(a.state())
      for (const name of ['left-arm', 'right-arm', 'forearm', 'hand']) {
        const rotations = (rig: typeof a) => rig.skeleton.bones.filter(bone => bone.name === name).map(bone => bone.quaternion.toArray())
        expect(rotations(b)).toEqual(rotations(a))
      }
      for (const i of sole) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i)
        expect(skin.applyBoneTransform(i, point.clone()).distanceTo(a.meshes[0]!.applyBoneTransform(i, point))).toBeLessThan(.000001)
      }
    }
  })

  it('rejects repeated tinting, late preparation and incorrect or repeated equipment attachment', () => {
    const body = attendant(1.72); prepareAttendantVariant(body, 'staff-bearer')
    expect(() => prepareAttendantVariant(body, 'pack-carrier')).toThrow()
    const staffRig = bindWalkRig(body, 1.72, 'human', true, -Math.PI / 3)
    expect(attachAttendantEquipment(body, staffRig, 'staff-bearer')).toBeUndefined()
    expect(() => attachAttendantEquipment(body, staffRig, 'pack-carrier')).toThrow()
    const late = attendant(1.72); bindWalkRig(late, 1.72, 'human', false, -Math.PI / 3)
    expect(() => prepareAttendantVariant(late, 'pack-carrier')).toThrow()
    const pack = attendant(1.66); prepareAttendantVariant(pack, 'pack-carrier')
    const packRig = bindWalkRig(pack, 1.66, 'human', false, -Math.PI / 3)
    attachAttendantEquipment(pack, packRig, 'pack-carrier')
    expect(() => attachAttendantEquipment(pack, packRig, 'pack-carrier')).toThrow()
  })
})
