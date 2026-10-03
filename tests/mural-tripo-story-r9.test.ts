import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { bindWalkRig } from '../viewer/src/mural/walking.ts'
import { capturedStride, capturedWalkSource } from '../viewer/src/mural/captured-walk.ts'
import { verifiedStoryTripoAssets } from '../viewer/src/mural/tripo-story-assets.ts'
import { createGuardVariant, guardVariantSource, updateGuardMotion } from '../viewer/src/mural/guard-variants.ts'
import { sampleDetentionMotion } from '../viewer/src/mural/detention-motion.ts'
import { attendantVariantSource, prepareAttendantVariant } from '../viewer/src/mural/attendant-variants.ts'
import { attachSlenderCredential } from '../viewer/src/mural/held-credential.ts'

const directory = 'viewer/public/mural-assets/tripo-story-r9/'
const generated = JSON.parse(readFileSync(directory + 'manifest.json', 'utf8'))
const normalized = JSON.parse(readFileSync(directory + 'normalized-manifest.json', 'utf8'))
const ids = ['zhangqian', 'ganfu', 'qiong-bamboo'] as const
const heights = { zhangqian: 1.75, ganfu: 1.69, 'qiong-bamboo': 1.55 }
type AssetId = typeof ids[number]
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// Load the actual self-contained GLB geometry, node transforms and material
// handles in Node. No replacement primitive, rescaling or synthetic pose.
function actualGLB(file: string) {
  const bytes = readFileSync('viewer/public' + file)
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF')
  expect(bytes.readUInt32LE(4)).toBe(2)
  expect(bytes.readUInt32LE(8)).toBe(bytes.length)
  const jsonLength = bytes.readUInt32LE(12)
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a)
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
  let offset = 20 + jsonLength, binary = -1, binaryLength = 0
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4)
    expect(offset + 8 + length).toBeLessThanOrEqual(bytes.length)
    if (type === 0x004e4942) { binary = offset + 8; binaryLength = length }
    offset += length + 8
  }
  expect(binary).toBeGreaterThan(0)
  expect(offset).toBe(bytes.length)
  function embeddedImage(index: number) {
    const image = doc.images[index], view = doc.bufferViews[image.bufferView]
    expect(image.uri).toBeUndefined()
    expect(view.buffer).toBe(0)
    expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(binaryLength)
    return bytes.subarray(binary + (view.byteOffset ?? 0), binary + (view.byteOffset ?? 0) + view.byteLength)
  }
  for (const buffer of doc.buffers) expect(buffer.uri).toBeUndefined()
  const textures = doc.textures.map((source: any) => {
    const texture = new THREE.Texture()
    texture.userData.embeddedSha256 = digest(embeddedImage(source.source))
    return texture
  })
  const materials = doc.materials.map((source: any) => {
    const pbr = source.pbrMetallicRoughness, factor = pbr?.baseColorFactor ?? [1, 1, 1, 1]
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().fromArray(factor), opacity: factor[3],
      roughness: pbr?.roughnessFactor ?? 1, metalness: pbr?.metallicFactor ?? 1,
      map: pbr?.baseColorTexture ? textures[pbr.baseColorTexture.index] : null,
      normalMap: source.normalTexture ? textures[source.normalTexture.index] : null,
      normalScale: new THREE.Vector2(source.normalTexture?.scale ?? 1, source.normalTexture?.scale ?? 1),
      roughnessMap: pbr?.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : null,
      metalnessMap: pbr?.metallicRoughnessTexture ? textures[pbr.metallicRoughnessTexture.index] : null,
      side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    })
  })
  const nodes = doc.nodes.map((node: any) => {
    const object = new THREE.Group()
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale) }
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.fromArray(node.rotation)
    if (node.scale) object.scale.fromArray(node.scale)
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) {
      const geometry = new THREE.BufferGeometry()
      expect(primitive.mode ?? 4).toBe(4)
      for (const [source, target, components] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]] as const) {
        const accessor = doc.accessors[primitive.attributes[source]], view = doc.bufferViews[accessor.bufferView]
        expect(accessor.componentType).toBe(5126)
        const values = new Float32Array(accessor.count * components)
        for (let i = 0; i < accessor.count; i++) for (let component = 0; component < components; component++) {
          values[i * components + component] = bytes.readFloatLE(binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? components * 4) + component * 4)
        }
        geometry.setAttribute(target, new THREE.Float32BufferAttribute(values, components))
      }
      if (primitive.indices !== undefined) {
        const accessor = doc.accessors[primitive.indices], view = doc.bufferViews[accessor.bufferView]
        const size = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 4
        expect([5121, 5123, 5125]).toContain(accessor.componentType)
        geometry.setIndex(Array.from({ length: accessor.count }, (_, i) => {
          const position = binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * size
          return size === 1 ? bytes.readUInt8(position) : size === 2 ? bytes.readUInt16LE(position) : bytes.readUInt32LE(position)
        }))
      }
      object.add(new THREE.Mesh(geometry, materials[primitive.material]))
    }
    return object
  })
  doc.nodes.forEach((node: any, i: number) => { for (const child of node.children ?? []) nodes[i].add(nodes[child]) })
  const scene = new THREE.Group()
  for (const index of doc.scenes[doc.scene ?? 0].nodes) scene.add(nodes[index])
  scene.updateMatrixWorld(true)
  return { bytes, doc, scene }
}
function meshes(scene: THREE.Group) {
  const result: THREE.Mesh[] = []
  scene.traverse(object => { if (object instanceof THREE.Mesh) result.push(object) })
  return result
}
function sortedUVs(scene: THREE.Group) {
  return meshes(scene).flatMap(mesh => {
    const uv = mesh.geometry.getAttribute('uv')
    return Array.from({ length: uv.count }, (_, index) => [uv.getX(index), uv.getY(index)] as const)
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}
function materialSignature(material: THREE.MeshStandardMaterial) {
  const texture = (value: THREE.Texture | null) => value?.userData.embeddedSha256
  return { baseColor: texture(material.map), normal: texture(material.normalMap),
    roughnessImage: texture(material.roughnessMap), metallicImage: texture(material.metalnessMap),
    color: material.color.toArray(), opacity: material.opacity, roughness: material.roughness,
    metalness: material.metalness, normalScale: material.normalScale.toArray(), side: material.side }
}
function loadNormalized(id: AssetId) {
  const asset = normalized.assets.find((item: any) => item.id === id)
  expect(asset, id + ' must have a delivered normalized manifest entry').toBeDefined()
  return { asset, ...actualGLB(asset.path) }
}
function average(points: THREE.Vector3[]) {
  return points.reduce((total, point) => total.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length)
}

function actualCredentialBearer(height: number, yaw: number, parentYaw: number) {
  const source = actualGLB(attendantVariantSource.file)
  expect(digest(source.bytes)).toBe(attendantVariantSource.sha256)
  const bounds = new THREE.Box3().setFromObject(source.scene), scale = height / bounds.getSize(new THREE.Vector3()).y
  const centre = bounds.getCenter(new THREE.Vector3())
  // The loader normalizes the child before actor translation/heading. Keep
  // that outer actor group so bindWalkRig cannot cancel the source scale.
  source.scene.scale.setScalar(scale)
  source.scene.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale)
  const model = new THREE.Group(), parent = new THREE.Group()
  model.add(source.scene); parent.add(model)
  model.position.set(-1, .03, 1.8); model.rotation.y = yaw
  parent.position.set(-2, .12, 7); parent.rotation.y = parentYaw
  parent.updateMatrixWorld(true)
  prepareAttendantVariant(model, 'staff-bearer')
  const rig = bindWalkRig(model, height, 'human', true, -Math.PI / 3)
  rig.update(0, 0, true)
  const handIndex = rig.skeleton.bones.indexOf(rig.rightHand!)
  const selected = rig.meshes.map(mesh => {
    const position = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    return Array.from({ length: position.count }, (_, index) => index).filter(index => {
      let weight = 0
      for (let channel = 0; channel < 4; channel++) if (indices.getComponent(index, channel) === handIndex) weight += weights.getComponent(index, channel)
      return weight >= .8
    })
  })
  expect(selected.flat().length).toBeGreaterThan(10)
  const handPoints = () => rig.meshes.flatMap((mesh, meshIndex) => {
    const position = mesh.geometry.getAttribute('position')
    return selected[meshIndex]!.map(index => mesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(position, index)).applyMatrix4(mesh.matrixWorld))
  })
  return { model, parent, rig, handPoints }
}

describe('real selected bamboo shaft grips the actual attendant through actor transforms and gait', () => {
  for (const [height, yaw, parentYaw] of [[1.72, Math.PI, .37], [1.66, -.63, -.85]] as const) {
    it(height + 'm bearer retains the verified GLB vertices, UVs and embedded PBR while gripping its real hand', () => {
      const delivered = loadNormalized('qiong-bamboo')
      const verified = verifiedStoryTripoAssets(normalized, generated).find(asset => asset.id === 'qiong-bamboo')!
      expect(verified.path).toBe(delivered.asset.path)
      expect(digest(delivered.bytes)).toBe(verified.sha256)
      const sourceMeshes = meshes(delivered.scene), snapshots = sourceMeshes.map(mesh => ({
        mesh, geometry: mesh.geometry, positions: Array.from(mesh.geometry.getAttribute('position').array),
        normals: Array.from(mesh.geometry.getAttribute('normal').array), uv: Array.from(mesh.geometry.getAttribute('uv').array),
        indices: Array.from(mesh.geometry.getIndex()!.array), material: mesh.material,
        pbr: materialSignature(mesh.material as THREE.MeshStandardMaterial),
      }))
      const { model, rig, handPoints } = actualCredentialBearer(height, yaw, parentYaw)
      const shaft = attachSlenderCredential(model, rig, delivered.scene), held = meshes(shaft)
      expect(shaft.userData.credentialShaft.source).toBe(verified.path)
      expect(shaft.userData.credentialShaft.handVertices).toBe(handPoints().length)
      expect(shaft.parent?.parent).toBe(rig.rightHand)
      expect(held).toHaveLength(snapshots.length)
      for (const [index, mesh] of held.entries()) {
        const before = snapshots[index]!
        expect(mesh).not.toBe(before.mesh)
        expect(mesh.geometry).toBe(before.geometry); expect(mesh.material).toBe(before.material)
        expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(before.positions)
        expect(Array.from(mesh.geometry.getAttribute('normal').array)).toEqual(before.normals)
        expect(Array.from(mesh.geometry.getAttribute('uv').array)).toEqual(before.uv)
        expect(Array.from(mesh.geometry.getIndex()!.array)).toEqual(before.indices)
        expect(materialSignature(mesh.material as THREE.MeshStandardMaterial)).toEqual(before.pbr)
      }
      const hand = average(handPoints()), inverse = model.matrixWorld.clone().invert()
      const localHand = hand.clone().applyMatrix4(inverse)
      const bottom = shaft.localToWorld(new THREE.Vector3(0, 0, 0)), top = shaft.localToWorld(new THREE.Vector3(0, 1.55, 0))
      const projected = new THREE.Line3(bottom, top).closestPointToPoint(hand, true, new THREE.Vector3())
      expect(projected.distanceTo(hand)).toBeLessThan(.00001)
      expect(localHand.x).toBeGreaterThan(height * .14)
      expect(localHand.y).toBeGreaterThan(height * .30); expect(localHand.y).toBeLessThan(height * .55)
      expect(top.clone().sub(bottom).normalize().distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(.00001)
      const shaftBounds = new THREE.Box3().setFromObject(shaft)
      expect(shaftBounds.min.y - model.localToWorld(new THREE.Vector3()).y).toBeCloseTo(.055, 5)
      expect(shaftBounds.max.y).toBeGreaterThan(hand.y + .3)
    })

    it(height + 'm bearer keeps the shaft beside its posed fingers and above the floor while walking, rotating and stopping', () => {
      const { scene } = loadNormalized('qiong-bamboo'), { model, parent, rig, handPoints } = actualCredentialBearer(height, yaw, parentYaw)
      const shaft = attachSlenderCredential(model, rig, scene), geometry = meshes(shaft)[0]!.geometry
      const stride = (rig.legs[0]!.upperLength + rig.legs[0]!.lowerLength) * capturedStride
      let maximumGripError = 0, minimumFloor = Infinity, maximumFloor = -Infinity, maximumTilt = 0
      const handRelativeToShaft: THREE.Vector3[][] = []
      for (let step = 0; step <= 80; step++) {
        model.position.x = -1 + .018 * step; model.position.z = 1.8 - .04 * step
        model.rotation.y = yaw + .4 * Math.sin(step / 80 * Math.PI)
        parent.rotation.y = parentYaw + .8 * step / 80
        // Refresh the changed ancestor before CPU skin sampling, just as the
        // renderer refreshes scene matrices. Mixing an old mesh world matrix
        // with localToWorld's new ancestor matrix would manufacture drift.
        parent.updateMatrixWorld(true)
        rig.update(stride * (3 + step / 40), .31, step === 0 || step === 80)
        const points = handPoints(), hand = average(points)
        const bottom = shaft.localToWorld(new THREE.Vector3(0, 0, 0)), top = shaft.localToWorld(new THREE.Vector3(0, 1.55, 0))
        const projected = new THREE.Line3(bottom, top).closestPointToPoint(hand, true, new THREE.Vector3())
        maximumGripError = Math.max(maximumGripError, projected.distanceTo(hand))
        maximumTilt = Math.max(maximumTilt, top.clone().sub(bottom).normalize().distanceTo(new THREE.Vector3(0, 1, 0)))
        const inverse = shaft.matrixWorld.clone().invert()
        handRelativeToShaft.push(points.map(point => point.applyMatrix4(inverse)))
        // The actor is deliberately raised .03m in cinema-world. Its origin
        // is not the terrain plane; preserve that real placement clearance.
        const ground = parent.localToWorld(new THREE.Vector3(model.position.x, 0, model.position.z)).y
        const floor = new THREE.Box3().setFromObject(shaft).min.y - ground
        minimumFloor = Math.min(minimumFloor, floor); maximumFloor = Math.max(maximumFloor, floor)
      }
      // Counter-rotation keeps the actual shaft vertical rather than adopting
      // the authored forearm inclination. Every selected finger vertex must
      // remain fixed in the shaft's frame as the actors turn and step.
      let maximumFingerDrift = 0
      for (const frame of handRelativeToShaft) for (const [index, point] of frame.entries()) maximumFingerDrift = Math.max(maximumFingerDrift, point.distanceTo(handRelativeToShaft[0]![index]!))
      console.info('real credential grip geometry', JSON.stringify({ height, selectedHandVertices: handRelativeToShaft[0]!.length,
        maximumAxisToHandCentreMeters: maximumGripError, maximumFingerDriftMeters: maximumFingerDrift,
        minimumShaftFloorMeters: minimumFloor, maximumShaftFloorMeters: maximumFloor, maximumVerticalDirectionError: maximumTilt }))
      expect(maximumGripError).toBeLessThan(.00001)
      expect(maximumFingerDrift).toBeLessThan(.00001)
      expect(maximumTilt).toBeLessThan(.00001)
      expect(minimumFloor).toBeGreaterThan(0)
      expect(maximumFloor).toBeLessThan(.12)
      expect(meshes(shaft)[0]!.geometry).toBe(geometry)
    })
  }
})

describe('r9 real Tripo deliveries and captured fixed-arm gait', () => {
  it('retains three auditable real tasks, distinct character source bytes and exactly 150 consumed credits', () => {
    expect(generated.assets.map((item: any) => item.id).sort()).toEqual([...ids].sort())
    expect(normalized.assets.map((item: any) => item.id).sort()).toEqual([...ids].sort())
    expect(new Set(generated.assets.map((item: any) => item.taskId)).size).toBe(3)
    expect(generated.assets.reduce((total: number, item: any) => total + item.creditsConsumed, 0)).toBe(150)
    const hashes = ids.map(id => {
      const asset = generated.assets.find((item: any) => item.id === id), bytes = readFileSync('viewer/public' + asset.path)
      expect(digest(bytes)).toBe(asset.sha256); expect(bytes.length).toBe(asset.bytes)
      expect(asset.creditsConsumed).toBe(50)
      return asset.sha256
    })
    expect(hashes[0]).not.toBe(hashes[1])
    expect(new Set(hashes).size).toBe(3)
  })

  it('accepts the real provenance chain and rejects altered task, raw digest, path, height and duplicate IDs', () => {
    expect(verifiedStoryTripoAssets(normalized, generated).map(asset => asset.id).sort()).toEqual([...ids].sort())
    for (const mutation of [
      (value: any) => { value.assets[0].taskId = 'unrelated-task' },
      (value: any) => { value.assets[0].rawSha256 = '0'.repeat(64) },
      (value: any) => { value.assets[0].path = '/mural-assets/tripo-story-r9/ganfu.glb' },
      (value: any) => { value.assets[0].heightMeters = 2.3 },
      (value: any) => { value.assets[1].id = value.assets[0].id },
    ]) {
      const altered = structuredClone(normalized)
      mutation(altered)
      expect(() => verifiedStoryTripoAssets(altered, generated)).toThrow()
    }
  })

  for (const id of ids) it(id + ' normalized bytes preserve actual UVs and each original embedded PBR channel', () => {
    const output = loadNormalized(id), raw = actualGLB(output.asset.rawPath)
    expect(digest(output.bytes)).toBe(output.asset.sha256); expect(output.bytes.length).toBe(output.asset.bytes)
    expect(digest(raw.bytes)).toBe(output.asset.rawSha256)
    expect(output.asset.rawSha256).toBe(generated.assets.find((item: any) => item.id === id).sha256)
    const box = new THREE.Box3().setFromObject(output.scene), size = box.getSize(new THREE.Vector3())
    expect(Math.abs(box.min.y)).toBeLessThan(.00001)
    expect(size.y).toBeCloseTo(heights[id], 5)
    expect(Math.abs(box.getCenter(new THREE.Vector3()).x)).toBeLessThan(.00001)
    expect(Math.abs(box.getCenter(new THREE.Vector3()).z)).toBeLessThan(.00001)
    if (id === 'qiong-bamboo') { expect(Math.max(size.x, size.z)).toBeCloseTo(.032, 5); expect(size.y / Math.max(size.x, size.z)).toBeGreaterThan(45) }
    const beforeUV = sortedUVs(raw.scene), afterUV = sortedUVs(output.scene)
    expect(afterUV).toHaveLength(beforeUV.length)
    let uvError = 0
    for (let i = 0; i < beforeUV.length; i++) uvError = Math.max(uvError, Math.abs(beforeUV[i]![0] - afterUV[i]![0]), Math.abs(beforeUV[i]![1] - afterUV[i]![1]))
    expect(uvError).toBeLessThan(.000001)
    const original = meshes(raw.scene), delivered = meshes(output.scene)
    expect(delivered).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) {
      const before = original[i]!.material as THREE.MeshStandardMaterial, after = delivered[i]!.material as THREE.MeshStandardMaterial
      expect(after.map).not.toBeNull(); expect(after.normalMap).not.toBeNull(); expect(after.roughnessMap).not.toBeNull(); expect(after.metalnessMap).not.toBeNull()
      expect(materialSignature(after)).toEqual(materialSignature(before))
      expect(delivered[i]!.geometry.getIndex()!.count).toBe(original[i]!.geometry.getIndex()!.count)
    }
  })

  for (const id of ['zhangqian', 'ganfu'] as const) {
    it(id + ' binds the actual +Z model without twisting its upper body or changing UV/PBR', () => {
      const { scene } = loadNormalized(id), source = meshes(scene)
      const snapshots = source.map(mesh => ({ mesh, uv: Array.from(mesh.geometry.getAttribute('uv').array),
        transform: scene.matrixWorld.clone().invert().multiply(mesh.matrixWorld), positions: mesh.geometry.getAttribute('position') }))
      const rig = bindWalkRig(scene, heights[id], 'human', false, 0)
      expect(rig.meshes).toHaveLength(source.length)
      let unchangedUpperBody = 0, maxDisplacement = 0
      for (let m = 0; m < rig.meshes.length; m++) {
        const skin = rig.meshes[m]!, before = snapshots[m]!, after = skin.geometry.getAttribute('position')
        expect(skin.material).toBe(before.mesh.material)
        expect(Array.from(skin.geometry.getAttribute('uv').array)).toEqual(before.uv)
        for (let i = 0; i < after.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(before.positions, i).applyMatrix4(before.transform)
          if (point.y > heights[id] * .60) {
            unchangedUpperBody++
            maxDisplacement = Math.max(maxDisplacement, point.distanceTo(new THREE.Vector3().fromBufferAttribute(after, i)))
          }
        }
      }
      expect(unchangedUpperBody).toBeGreaterThan(1000)
      expect(maxDisplacement).toBeLessThan(.00001)
    })

    it(id + ' keeps render-reviewed low finger vertices fixed independently of assigned skin weights', () => {
      const h = heights[id], { scene } = loadNormalized(id), source = meshes(scene)[0]!
      const original = source.geometry.getAttribute('position')
      const matrix = scene.matrixWorld.clone().invert().multiply(source.matrixWorld)
      // Bounds identify the visible lower hands in the delivered front-plus-z
      // review images. Selection uses original geometry, never bone weights;
      // otherwise a hand incorrectly assigned to a leg would escape this test.
      const region = id === 'ganfu' ? { x: [.22, .33], y: [.35, .43] } : { x: [.14, .18], y: [.40, .47] }
      const hands = [-1, 1].map(side => Array.from({ length: original.count }, (_, index) => index).filter(index => {
        const point = new THREE.Vector3().fromBufferAttribute(original, index).applyMatrix4(matrix)
        return point.x * side > h * region.x[0]! && point.x * side < h * region.x[1]! && point.y > h * region.y[0]! && point.y < h * region.y[1]!
      }).filter((_, index) => index % 5 === 0))
      expect(hands.every(indices => indices.length > 10)).toBe(true)
      const rig = bindWalkRig(scene, h, 'human', false, 0), skin = rig.meshes[0]!, position = skin.geometry.getAttribute('position')
      const spine = rig.skeleton.bones.find(bone => bone.name === 'walk-spine')!
      const stride = (rig.legs[0]!.upperLength + rig.legs[0]!.lowerLength) * capturedStride
      let baseline: THREE.Vector3[][] | undefined, displacement = 0, worst: unknown
      for (let step = 0; step <= 40; step++) {
        rig.update(stride * (3 + step / 40))
        const inverse = spine.matrixWorld.clone().invert()
        const current = hands.map(points => points.map(index => skin.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(position, index)).applyMatrix4(skin.matrixWorld).applyMatrix4(inverse)))
        baseline ??= current
        current.forEach((points, side) => points.forEach((point, index) => {
          const movement = point.distanceTo(baseline![side]![index]!)
          if (movement > displacement) {
            displacement = movement
            const vertex = hands[side]![index]!, indices = skin.geometry.getAttribute('skinIndex'), weights = skin.geometry.getAttribute('skinWeight')
            worst = { vertex, side, phase: step / 40, rest: new THREE.Vector3().fromBufferAttribute(position, vertex).multiplyScalar(1 / h).toArray(),
              influences: Array.from({ length: 4 }, (_, channel) => ({ bone: rig.skeleton.bones[indices.getComponent(vertex, channel)]!.name, weight: weights.getComponent(vertex, channel) })) }
          }
        }))
      }
      console.info('r9 low hand geometry', JSON.stringify({ id, selectedVertices: hands.map(indices => indices.length), maxSpineRelativeDisplacementMeters: displacement }))
      expect(displacement, JSON.stringify(worst)).toBeLessThan(.00001)
    })

    it(id + ' alternates real boots on separate forward tracks, contacts the floor and fixes both real hands', () => {
      const h = heights[id], { scene } = loadNormalized(id), rig = bindWalkRig(scene, h, 'human', false, 0)
      expect(rig.meshes).toHaveLength(1)
      const skin = rig.meshes[0]!, position = skin.geometry.getAttribute('position')
      const feet = [-1, 1].map(side => Array.from({ length: position.count }, (_, i) => i).filter(i => position.getY(i) < h * .055 && position.getX(i) * side > 0))
      expect(feet.every(indices => indices.length > 20)).toBe(true)
      const armBones = new Set(rig.skeleton.bones.flatMap((bone, index) => ['left-arm', 'right-arm', 'forearm', 'hand'].includes(bone.name) ? [index] : []))
      const indices = skin.geometry.getAttribute('skinIndex'), weights = skin.geometry.getAttribute('skinWeight')
      const hands = [-1, 1].map(side => Array.from({ length: position.count }, (_, i) => i).filter(i => {
        let armWeight = 0
        for (let channel = 0; channel < 4; channel++) if (armBones.has(indices.getComponent(i, channel))) armWeight += weights.getComponent(i, channel)
        return position.getX(i) * side > 0 && position.getY(i) < h * .64 && position.getY(i) > h * .38 && armWeight > .5
      }).filter((_, index) => index % 8 === 0))
      expect(hands.every(points => points.length > 10)).toBe(true)
      const spine = rig.skeleton.bones.find(bone => bone.name === 'walk-spine')!
      const relativeHands = () => {
        const inverse = spine.matrixWorld.clone().invert()
        return hands.map(points => points.map(i => skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i)).applyMatrix4(skin.matrixWorld).applyMatrix4(inverse)))
      }
      const stride = (rig.legs[0]!.upperLength + rig.legs[0]!.lowerLength) * capturedStride
      const separation: number[] = [], elevations: number[][] = [[], []], forwards: number[][] = [[], []]
      let worstHand: unknown
      let handDisplacement = 0, groundMinimum = Infinity, groundMaximum = -Infinity, contactMinimum = Infinity, baseline: THREE.Vector3[][] | undefined
      for (let step = 0; step <= 40; step++) {
        rig.update(stride * (3 + step / 40))
        expect(rig.state().source).toBe(capturedWalkSource)
        const footprints = feet.map(points => points.map(i => skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i))))
        expect(Math.max(...footprints[0]!.map(point => point.x))).toBeLessThan(-.02)
        expect(Math.min(...footprints[1]!.map(point => point.x))).toBeGreaterThan(.02)
        const allY = footprints.flatMap(points => points.map(point => point.y)), floor = Math.min(...allY)
        groundMinimum = Math.min(groundMinimum, floor); groundMaximum = Math.max(groundMaximum, floor)
        contactMinimum = Math.min(contactMinimum, allY.filter(y => Math.abs(y) < .01).length)
        const centers = footprints.map(average)
        separation.push(centers[0]!.z - centers[1]!.z)
        footprints.forEach((points, foot) => {
          elevations[foot]!.push(Math.min(...points.map(point => point.y))); forwards[foot]!.push(centers[foot]!.z)
          let xx = 0, zz = 0, xz = 0
          for (const point of points) { xx += (point.x - centers[foot]!.x) ** 2; zz += (point.z - centers[foot]!.z) ** 2; xz += (point.x - centers[foot]!.x) * (point.z - centers[foot]!.z) }
          expect(Math.abs(.5 * Math.atan2(2 * xz, zz - xx))).toBeLessThan(THREE.MathUtils.degToRad(5))
        })
        const currentHands = relativeHands()
        baseline ??= currentHands
        currentHands.forEach((points, side) => points.forEach((point, index) => {
          const displacement = point.distanceTo(baseline![side]![index]!)
          if (displacement > handDisplacement) {
            handDisplacement = displacement
            const vertex = hands[side]![index]!
            worstHand = { side, vertex, phase: step / 40, rest: new THREE.Vector3().fromBufferAttribute(position, vertex).toArray(),
              influences: Array.from({ length: 4 }, (_, channel) => ({ bone: rig.skeleton.bones[indices.getComponent(vertex, channel)]!.name, weight: weights.getComponent(vertex, channel) })) }
          }
        }))
      }
      expect(groundMinimum).toBeGreaterThan(-.005)
      expect(groundMaximum).toBeLessThan(.005)
      expect(contactMinimum).toBeGreaterThan(20)
      expect(Math.min(...separation)).toBeLessThan(-.07); expect(Math.max(...separation)).toBeGreaterThan(.07)
      for (const values of forwards) expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(.12)
      for (const values of elevations) expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(.03)
      console.info('r9 captured stride geometry', JSON.stringify({ id, maxArmRegionDisplacementMeters: handDisplacement, minimumFloorMeters: groundMinimum, maximumSupportFloorMeters: groundMaximum, minimumContactVertices: contactMinimum, forwardSeparationMeters: [Math.min(...separation), Math.max(...separation)] }))
      expect(handDisplacement, JSON.stringify(worstHand)).toBeLessThan(.00001)
      // Replay at identical route distance must freeze the actual deformed shoe,
      // not merely produce an equal bookkeeping state.
      const footPoint = () => skin.applyBoneTransform(feet[0]![0]!, new THREE.Vector3().fromBufferAttribute(position, feet[0]![0]!))
      rig.update(stride * 3.37); const first = footPoint()
      rig.update(stride * 3.37); expect(footPoint().distanceTo(first)).toBeLessThan(.000001)
    })
  }
})
function actualGuard(variant: 'older-mantle' | 'younger-bow', height: number) {
  const source = actualGLB(guardVariantSource.file)
  expect(digest(source.bytes)).toBe(guardVariantSource.sha256)
  const guard = createGuardVariant(source.scene, variant, height)
  const skins = meshes(guard).filter((mesh): mesh is THREE.SkinnedMesh => mesh instanceof THREE.SkinnedMesh && mesh.userData.guardSourceBody)
  expect(skins).toHaveLength(1)
  const skin = skins[0]!, position = skin.geometry.getAttribute('position')
  const soles = [-1, 1].map(side => Array.from({ length: position.count }, (_, index) => index).filter(index => position.getY(index) < height * .055 && position.getX(index) * side > 0))
  expect(soles.every(indices => indices.length > 20)).toBe(true)
  const footprints = () => soles.map(indices => indices.map(index => skin.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(position, index)).applyMatrix4(skin.matrixWorld)))
  return { guard, skin, soles, footprints }
}

describe('actual Tripo guards pivot by alternating planted feet and retain their wardrobe', () => {
  for (const [variant, height, sideIndex] of [['older-mantle', 1.74, 0], ['younger-bow', 1.67, 1]] as const) {
    it(variant + ' lifts alternate real boots and keeps each pivot support centroid fixed', () => {
      const { guard, skin, footprints } = actualGuard(variant, height)
      const geometry = skin.geometry, skeleton = skin.skeleton, uv = Array.from(geometry.getAttribute('uv').array)
      const wardrobe = guard.getObjectByName('Distinct interpretive wardrobe')!
      const attachments = meshes(guard).filter(mesh => mesh !== skin).map(mesh => ({ mesh, parent: mesh.parent, geometry: mesh.geometry, material: mesh.material }))
      const armPitch = skeleton.bones.filter(bone => bone.name === 'left-arm' || bone.name === 'right-arm').map(bone => bone.rotation.x)
      const summaries: unknown[] = []
      for (const [from, to] of [[.08, .16], [.32, .38], [.43, .59]] as const) {
        let planted: number | undefined, reference: THREE.Vector3 | undefined, maximumDrift = 0, minimumFloor = Infinity
        const sequence: number[] = [], maximumLift = [0, 0]
        for (let step = 0; step <= 120; step++) {
          const progress = from + (to - from) * step / 120, motion = sampleDetentionMotion(progress).guards[sideIndex]!
          updateGuardMotion(guard, motion, sideIndex * .31)
          const feet = footprints(), floors = feet.map(points => Math.min(...points.map(point => point.y)))
          const low = Math.min(...floors)
          minimumFloor = Math.min(minimumFloor, low)
          expect(low).toBeGreaterThan(-.005); expect(low).toBeLessThan(.013)
          floors.forEach((floor, index) => { maximumLift[index] = Math.max(maximumLift[index]!, floor - low) })
          if (Math.abs(floors[0]! - floors[1]!) < .005) continue
          const support = floors[0]! < floors[1]! ? 0 : 1, centre = average(feet[support]!)
          if (planted !== support) {
            planted = support; reference = centre; sequence.push(support)
          }
          maximumDrift = Math.max(maximumDrift, Math.hypot(centre.x - reference!.x, centre.z - reference!.z))
        }
        expect(sequence.length).toBeGreaterThanOrEqual(2)
        for (let step = 1; step < sequence.length; step++) expect(sequence[step]).not.toBe(sequence[step - 1])
        expect(maximumLift[0]).toBeGreaterThan(.015); expect(maximumLift[1]).toBeGreaterThan(.015)
        expect(maximumDrift, JSON.stringify({ variant, turn: [from, to], sequence, maximumDrift })).toBeLessThan(.003)
        summaries.push({ turn: [from, to], supportSequence: sequence, maximumSupportDriftMeters: maximumDrift, maximumSwingClearanceMeters: maximumLift, minimumFloorMeters: minimumFloor })
      }
      expect(skin.geometry).toBe(geometry); expect(skin.skeleton).toBe(skeleton)
      expect(Array.from(skin.geometry.getAttribute('uv').array)).toEqual(uv)
      expect(guard.getObjectByName('Distinct interpretive wardrobe')).toBe(wardrobe)
      for (const attachment of attachments) { expect(attachment.mesh.parent).toBe(attachment.parent); expect(attachment.mesh.geometry).toBe(attachment.geometry); expect(attachment.mesh.material).toBe(attachment.material) }
      expect(skeleton.bones.filter(bone => bone.name === 'left-arm' || bone.name === 'right-arm').map(bone => bone.rotation.x)).toEqual(armPitch)
      console.info('real guard pivot geometry', JSON.stringify({ variant, summaries }))
    })

    it(variant + ' alternates the preserved boots while walking and starts/stops without a hard knee-angle jump', () => {
      const { guard, skin, footprints } = actualGuard(variant, height)
      const knees = skin.skeleton.bones.filter(bone => bone.name.endsWith('-shin'))
      const lifts: number[][] = [[], []]
      let minFloor = Infinity, maxSupportFloor = -Infinity
      for (const [from, to] of [[.16, .32], [.60, .92]] as const) {
        for (let step = 1; step < 100; step++) {
          const progress = from + (to - from) * step / 100
          updateGuardMotion(guard, sampleDetentionMotion(progress).guards[sideIndex]!, sideIndex * .31)
          const floors = footprints().map(points => Math.min(...points.map(point => point.y)))
          const floor = Math.min(...floors)
          minFloor = Math.min(minFloor, floor); maxSupportFloor = Math.max(maxSupportFloor, floor)
          floors.forEach((value, index) => lifts[index]!.push(value - floor))
        }
      }
      expect(minFloor).toBeGreaterThan(-.005); expect(maxSupportFloor).toBeLessThan(.013)
      for (const values of lifts) expect(Math.max(...values)).toBeGreaterThan(.025)
      const difference = lifts[0]!.map((value, index) => value - lifts[1]![index]!)
      expect(Math.min(...difference)).toBeLessThan(-.02); expect(Math.max(...difference)).toBeGreaterThan(.02)
      let maxAngleJump = 0, worstBoundary: unknown
      for (const boundary of [.16, .32, .60, .92]) {
        updateGuardMotion(guard, sampleDetentionMotion(boundary - 1e-4).guards[sideIndex]!, sideIndex * .31)
        const before = knees.map(bone => bone.rotation.x)
        updateGuardMotion(guard, sampleDetentionMotion(boundary + 1e-4).guards[sideIndex]!, sideIndex * .31)
        knees.forEach((bone, index) => {
          const jump = Math.abs(bone.rotation.x - before[index]!)
          if (jump > maxAngleJump) { maxAngleJump = jump; worstBoundary = { boundary, bone: bone.name, before: before[index], after: bone.rotation.x, jump } }
        })
      }
      console.info('real guard walking geometry', JSON.stringify({ variant, minimumFloorMeters: minFloor, maximumSupportFloorMeters: maxSupportFloor, maximumSwingClearanceMeters: lifts.map(values => Math.max(...values)), maximumBoundaryKneeJumpRadians: maxAngleJump, worstBoundary }))
      expect(maxAngleJump, JSON.stringify(worstBoundary)).toBeLessThan(.005)
    })
  }
})
