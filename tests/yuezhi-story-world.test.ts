import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { groundStoryObject, verifyStoryAsset } from '../viewer/src/yuezhi/story-world.ts'

describe('combined Blender and Tripo scene', () => {
  it('moves a rotated, authored-scale object onto the real floor without resizing it', () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, .2, 20), new THREE.MeshBasicMaterial())
    floor.position.y = .25
    floor.updateMatrixWorld(true)
    const object = new THREE.Group()
    object.name = 'example-Tripo-character'
    const body = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.7, .6), new THREE.MeshBasicMaterial())
    body.position.set(.08, .85, .1)
    object.add(body)
    object.position.set(2, 4, -3)
    object.rotation.set(.03, 1.3, .02)
    object.scale.set(1.1, 1, 1.1)
    object.updateMatrixWorld(true)
    const before = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    const groundY = groundStoryObject(object, [floor])
    const after = new THREE.Box3().setFromObject(object)
    expect(groundY).toBeCloseTo(.35, 6)
    expect(after.min.y).toBeCloseTo(.35, 6)
    expect(after.getSize(new THREE.Vector3()).distanceTo(before)).toBeLessThan(.000001)
    expect(object.position.x).toBe(2)
    expect(object.position.z).toBe(-3)
  })

  it('refuses a placement beyond the authored Blender floor instead of silently floating it', () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2, .1, 2), new THREE.MeshBasicMaterial())
    floor.updateMatrixWorld(true)
    const object = new THREE.Group()
    object.name = 'outside-floor'
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    object.position.x = 10
    expect(() => groundStoryObject(object, [floor])).toThrow('没有 Blender 地面')
  })

  it('accepts the actual compiled Tripo GLB and rejects a one-byte change', async () => {
    const manifest = JSON.parse(await readFile('packages/zhang-qian-yuezhi/asset-provenance.json', 'utf8')) as { assets: Array<{ assetId: string; path: string; sha256: string; taskId: string | null }> }
    const source = manifest.assets.find((asset) => asset.assetId === 'asset-envoy')!
    expect(source.taskId).toBeTruthy()
    const bytes = await readFile(`packages/zhang-qian-yuezhi/${source.path}`)
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    expect(await verifyStoryAsset(payload, source.sha256, source.assetId)).toBe(createHash('sha256').update(bytes).digest('hex'))
    const changed = payload.slice(0)
    new Uint8Array(changed)[changed.byteLength - 1]! ^= 1
    await expect(verifyStoryAsset(changed, source.sha256, source.assetId)).rejects.toThrow('SHA-256 不一致')
  })
})
