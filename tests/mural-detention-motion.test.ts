import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { sampleDetentionMotion } from '../viewer/src/mural/detention-motion.ts'

const turnWindows = [[.08, .16], [.32, .38], [.43, .59]] as const
const walkingWindows = [[.16, .32], [.60, .92]] as const
const delta = 1e-6
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// Check the actual camp obstacle triangles, beyond its descriptive manifest.
function campObstacles() {
  const manifest = JSON.parse(readFileSync('viewer/public/mural-assets/detention-camp-manifest.json', 'utf8'))
  const bytes = readFileSync('viewer/public/mural-assets/detention-camp.glb')
  expect(hash(bytes)).toBe(manifest.sha256); expect(bytes.length).toBe(manifest.bytes)
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF')
  const length = bytes.readUInt32LE(12), binary = 28 + length
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + length))
  const nodes = doc.nodes.map((node: any) => {
    const object = new THREE.Group()
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale) }
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.fromArray(node.rotation)
    if (node.scale) object.scale.fromArray(node.scale)
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) {
      const name = doc.materials[primitive.material].name as string
      // Ground and grass are traversable surfaces, not solid scene obstacles.
      if (/earth soil|dry grass/i.test(name)) continue
      const geometry = new THREE.BufferGeometry(), accessor = doc.accessors[primitive.attributes.POSITION], view = doc.bufferViews[accessor.bufferView]
      expect(accessor.componentType).toBe(5126)
      const positions = new Float32Array(accessor.count * 3)
      for (let i = 0; i < accessor.count; i++) for (let component = 0; component < 3; component++) positions[i * 3 + component] = bytes.readFloatLE(binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12) + component * 4)
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const indices = doc.accessors[primitive.indices], indexView = doc.bufferViews[indices.bufferView], size = indices.componentType === 5123 ? 2 : 4
      geometry.setIndex(Array.from({ length: indices.count }, (_, i) => {
        const offset = binary + (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0) + i * size
        return size === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset)
      }))
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.name = name; object.add(mesh)
    }
    return object
  })
  doc.nodes.forEach((node: any, index: number) => { for (const child of node.children ?? []) nodes[index].add(nodes[child]) })
  const scene = new THREE.Group()
  for (const node of doc.scenes[doc.scene ?? 0].nodes) scene.add(nodes[node])
  scene.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []; scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object) })
  expect(meshes.length).toBeGreaterThan(3)
  return { scene, manifest }
}

describe('detention blocking follows its real displacement without simultaneous pivot sliding', () => {
  it('faces the measured route tangent during both interception and escort, rather than moving backward', () => {
    for (const [from, to] of walkingWindows) for (let step = 1; step < 20; step++) {
      const progress = from + (to - from) * step / 20
      const before = sampleDetentionMotion(progress - delta), now = sampleDetentionMotion(progress), after = sampleDetentionMotion(progress + delta)
      now.guards.forEach((guard, index) => {
        const dx = after.guards[index]!.x - before.guards[index]!.x, dz = after.guards[index]!.z - before.guards[index]!.z
        const distance = Math.hypot(dx, dz)
        expect(distance).toBeGreaterThan(0)
        expect((Math.sin(guard.yaw) * dx + Math.cos(guard.yaw) * dz) / distance).toBeCloseTo(1, 8)
        expect(guard.action).toBe('walk'); expect(guard.weight).toBeGreaterThan(0)
        expect(after.guards[index]!.distance).toBeGreaterThan(before.guards[index]!.distance)
      })
    }
  })

  it('turns at a fixed route point with zero walk weight for all three separate turns', () => {
    for (const [from, to] of turnWindows) {
      const start = sampleDetentionMotion(from)
      for (const fraction of [.1, .25, .5, .75, .9]) {
        const sample = sampleDetentionMotion(from + (to - from) * fraction)
        sample.guards.forEach((guard, index) => {
          expect(guard.x).toBe(start.guards[index]!.x); expect(guard.z).toBe(start.guards[index]!.z)
          expect(guard.distance).toBe(start.guards[index]!.distance)
          expect(guard.weight).toBe(0); expect(guard.action).toBe('turn')
        })
      }
    }
    for (const progress of [.39, .41, .595, .95, 1]) for (const guard of sampleDetentionMotion(progress).guards) {
      expect(guard.action).toBe('halt'); expect(guard.weight).toBe(0)
    }
  })

  it('holds the intercepted party through the turn, then sends party and escorts into camp in the same direction', () => {
    for (const progress of [.28, .38, .43, .50, .59, .60]) {
      const sample = sampleDetentionMotion(progress)
      expect(sample.partyZ).toBeCloseTo(4.5, 10); expect(sample.partyWeight).toBe(0)
    }
    for (const progress of [.62, .70, .82, .90]) {
      const before = sampleDetentionMotion(progress - delta), after = sampleDetentionMotion(progress + delta)
      expect(after.partyZ).toBeLessThan(before.partyZ)
      after.guards.forEach((guard, index) => expect(guard.z).toBeLessThan(before.guards[index]!.z))
    }
    expect(sampleDetentionMotion(1).partyZ).toBeCloseTo(-.8, 10)
  })

  it('joins position, yaw, travelled distance and gait weight continuously at every start and stop', () => {
    for (const boundary of [0, .08, .16, .28, .32, .38, .43, .59, .60, .92, 1]) {
      const before = sampleDetentionMotion(boundary - delta), after = sampleDetentionMotion(boundary + delta)
      expect(Math.abs(after.partyZ - before.partyZ)).toBeLessThan(.0001)
      expect(Math.abs(after.partyDistance - before.partyDistance)).toBeLessThan(.0001)
      expect(Math.abs(after.partyWeight - before.partyWeight)).toBeLessThan(.0001)
      after.guards.forEach((guard, index) => {
        const prior = before.guards[index]!
        expect(Math.hypot(guard.x - prior.x, guard.z - prior.z)).toBeLessThan(.0001)
        expect(Math.abs(guard.yaw - prior.yaw)).toBeLessThan(.0001)
        expect(Math.abs(guard.distance - prior.distance)).toBeLessThan(.0001)
        expect(Math.abs(guard.weight - prior.weight)).toBeLessThan(.0001)
      })
    }
    for (let step = 0; step <= 100; step++) {
      const sample = sampleDetentionMotion(step / 100)
      expect(sample.partyWeight).toBeGreaterThanOrEqual(0); expect(sample.partyWeight).toBeLessThanOrEqual(1)
      for (const guard of sample.guards) { expect(guard.weight).toBeGreaterThanOrEqual(0); expect(guard.weight).toBeLessThanOrEqual(1) }
    }
  })

  it('gives the two guards opposite shortest half turns without a complete spin', () => {
    for (let guard = 0; guard < 2; guard++) {
      let total = 0, previous = sampleDetentionMotion(.43).guards[guard]!.yaw
      for (let step = 1; step <= 40; step++) {
        const current = sampleDetentionMotion(.43 + (.59 - .43) * step / 40).guards[guard]!
        total += Math.abs(current.yaw - previous); previous = current.yaw
        expect(current.yaw * current.side).toBeGreaterThanOrEqual(0)
      }
      expect(total).toBeCloseTo(Math.PI, 10)
      for (const turn of sampleDetentionMotion(1).guards[guard]!.turns) expect(Math.abs(turn.toYaw - turn.fromYaw)).toBeLessThanOrEqual(Math.PI)
    }
    expect(sampleDetentionMotion(.59).guards[0]!.yaw).toBeCloseTo(-sampleDetentionMotion(.59).guards[1]!.yaw, 10)
  })

  it('keeps retained captivity identical to the stopped detention endpoint and reconstructs seeks deterministically', () => {
    const endpoint = sampleDetentionMotion(1)
    expect(endpoint.phase).toBe('restricted'); expect(endpoint.partyWeight).toBe(0)
    for (const progress of [0, .3, .7, 1, NaN]) expect(sampleDetentionMotion(progress, true)).toEqual(endpoint)
    const targets = [.03, .12, .24, .35, .41, .52, .70, .94], expected = targets.map(progress => sampleDetentionMotion(progress))
    for (const index of [7, 0, 5, 2, 6, 1, 3, 4, 0, 7]) expect(sampleDetentionMotion(targets[index]!)).toEqual(expected[index])
    expect(sampleDetentionMotion(-1)).toEqual(sampleDetentionMotion(0))
    expect(sampleDetentionMotion(2)).toEqual(endpoint)
    expect(sampleDetentionMotion(NaN)).toEqual(sampleDetentionMotion(0))
  })

  it('keeps the actual routes and visible party footprints clear of camp shelter and solid prop triangles', () => {
    const { scene, manifest } = campObstacles(), ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0)
    expect(manifest.centralCharacterSpace.propsInside).toBe(false)
    const radius = .60, offsets = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius * .7, radius * .7], [-radius * .7, -radius * .7]]
    for (let step = 0; step <= 24; step++) {
      const motion = sampleDetentionMotion(step / 24)
      const actors = [...motion.guards.map(guard => ({ x: guard.x, z: guard.z })),
        { x: 0, z: motion.partyZ }, { x: -1, z: motion.partyZ + 1.8 }, { x: 1.05, z: motion.partyZ + 2.6 }]
      for (const actor of actors) {
        expect(Math.abs(actor.x) + radius).toBeLessThan(manifest.centralCharacterSpace.x[1])
        expect(actor.z - radius).toBeGreaterThan(manifest.shelterEntrance[2])
        for (const [dx, dz] of offsets) {
          ray.set(new THREE.Vector3(actor.x + dx!, .25, actor.z + dz!), up); ray.near = 0; ray.far = 1.8
          const collisions = ray.intersectObject(scene, true)
          expect(collisions.map(hit => hit.object.name), `solid camp obstruction at ${actor.x + dx!},${actor.z + dz!}`).toEqual([])
        }
      }
    }
  }, 15000)
})