import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../processing/src/yuezhi-package.ts'

type GltfMaterial = { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicRoughnessTexture?: { index: number; texCoord?: number }; baseColorFactor?: number[]; roughnessFactor?: number }; normalTexture?: { index: number; texCoord?: number } }
type Gltf = { nodes: Array<{ name: string; mesh?: number }>; meshes: Array<{ primitives: Array<{ indices?: number; attributes: Record<string, number>; material: number }> }>; accessors: Array<{ count: number; bufferView: number; byteOffset?: number; componentType: number; type: string }>; materials: GltfMaterial[]; images: Array<{ uri?: string; bufferView?: number }>; bufferViews: Array<{ byteLength: number; byteOffset?: number; byteStride?: number }> }
const readGlb = async (file: string) => {
  const bytes = await readFile(path.resolve('viewer/public/yuezhi', file))
  const length = bytes.readUInt32LE(12)
  return { bytes, data: JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Gltf, binaryOffset: 20 + length + 8 }
}
function accessorValues(glb: Awaited<ReturnType<typeof readGlb>>, id: number): number[][] {
  const accessor = glb.data.accessors[id]!, view = glb.data.bufferViews[accessor.bufferView]!
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type]!
  const size = accessor.componentType === 5123 ? 2 : 4
  const stride = view.byteStride ?? components * size
  return Array.from({ length: accessor.count }, (_, index) => Array.from({ length: components }, (_, component) => {
    const offset = glb.binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * stride + component * size
    return accessor.componentType === 5126 ? glb.bytes.readFloatLE(offset) : accessor.componentType === 5123 ? glb.bytes.readUInt16LE(offset) : glb.bytes.readUInt32LE(offset)
  }))
}

function planarTileSizes(glb: Awaited<ReturnType<typeof readGlb>>, name: string, normalAxis: number, normalSign: number) {
  const node = glb.data.nodes.find(item => item.name === name)!
  const primitive = glb.data.meshes[node.mesh!]!.primitives[0]!
  const position = accessorValues(glb, primitive.attributes.POSITION!), normal = accessorValues(glb, primitive.attributes.NORMAL!)
  const uv = accessorValues(glb, primitive.attributes.TEXCOORD_0!), indices = accessorValues(glb, primitive.indices!).flat()
  const tiles: number[] = []
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3)
    if (!triangle.every(vertex => normal[vertex]![normalAxis]! * normalSign > .999)) continue
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!
      const metres = Math.hypot(...position[a]!.map((value, axis) => value - position[b]![axis]!))
      const repeats = Math.hypot(...uv[a]!.map((value, axis) => value - uv[b]![axis]!))
      if (metres > .1 && repeats > 0) tiles.push(metres / repeats)
    }
  }
  return { material: glb.data.materials[primitive.material]!, tiles }
}
describe('离线Blender环境精修成品', () => {
  it('上游原件未替换、实际工具版本和成品hash都有记录', async () => {
    const original = await readGlb('environment.glb'), refined = await readGlb('environment-refined.glb')
    const manifest = JSON.parse(await readFile(path.resolve('viewer/public/yuezhi/environment-refined-manifest.json'), 'utf8'))
    expect(manifest.refinement.upstreamSha256).toBe(sha256(original.bytes))
    expect(manifest.sha256).toBe(sha256(refined.bytes))
    expect(manifest.bytes).toBe(refined.bytes.length)
    expect(manifest.blenderVersion).toBe('4.5.14 LTS')
    expect(Object.keys(manifest.refinement.preservedMeshAndMaterialSignatures)).toHaveLength(37)
    expect(Object.keys(manifest.refinement.preservedGroundGeometrySignatures)).toEqual(['Illustrative valley terrain'])
  })
  it('60个原石块变成更细的岩体，没有新增帐篷；地面草木对象数保持一致', async () => {
    const original = (await readGlb('environment.glb')).data, refined = (await readGlb('environment-refined.glb')).data
    expect(refined.nodes.map(node => node.name).sort()).toEqual(original.nodes.map(node => node.name).sort())
    const rocks = refined.nodes.filter(node => node.name.startsWith('Procedural weathered stone'))
    expect(rocks).toHaveLength(60)
    for (const node of rocks) {
      const triangles = refined.meshes[node.mesh!].primitives.reduce((total, primitive) => total + refined.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0)
      expect(triangles).toBe(320)
    }
    expect(refined.nodes.some(node => /tent|yurt/i.test(node.name))).toBe(false)
  })
  it('岩体、山脊具备真正导出的PBR图像，地面细节使用独立UV避免60m拉伸', async () => {
    const refined = (await readGlb('environment-refined.glb')).data
    for (const name of ['rock', 'ridge']) {
      const material = refined.materials.find(item => item.name === `Refined illustrative ${name} - embedded PBR`)!
      expect(material.pbrMetallicRoughness?.baseColorTexture).toBeDefined()
      expect(material.pbrMetallicRoughness?.metallicRoughnessTexture).toBeDefined()
      expect(material.normalTexture).toBeDefined()
    }
    const ground = refined.materials.find(item => item.name.includes('ground - original atlas'))!
    expect(ground.normalTexture?.texCoord).toBe(1)
    expect(ground.pbrMetallicRoughness?.metallicRoughnessTexture?.texCoord).toBe(1)
    const groundNode = refined.nodes.find(node => node.name === 'Illustrative valley terrain')!
    expect(refined.meshes[groundNode.mesh!].primitives[0].attributes.TEXCOORD_1).toBeDefined()
    expect(refined.images).toHaveLength(15)
    for (const image of refined.images) {
      expect(image.uri).toBeUndefined()
      expect(refined.bufferViews[image.bufferView!].byteLength).toBeGreaterThan(100)
    }
    const river = refined.materials.find(item => item.name === 'Refined illustrative dark shallow water')!
    expect(river.pbrMetallicRoughness!.roughnessFactor).toBeGreaterThan(.65)
    expect(Math.max(...river.pbrMetallicRoughness!.baseColorFactor!.slice(0, 3))).toBeLessThan(.1)
  })
  it('两块原布景保留来源并导出土墙、木梁和布棚的纹理、粗糙度与法线', async () => {
    const manifest = JSON.parse(await readFile(path.resolve('viewer/public/yuezhi/sets/refined-manifest.json'), 'utf8')) as { assets: Array<{ id: string; file: string; sha256: string; refinement: { upstreamFile: string; upstreamSha256: string; geometryModified: boolean } }> }
    for (const record of manifest.assets) {
      const original = await readGlb('sets/' + record.refinement.upstreamFile), refined = await readGlb('sets/' + record.file)
      expect(record.sha256).toBe(sha256(refined.bytes)); expect(record.refinement.upstreamSha256).toBe(sha256(original.bytes))
      expect(record.refinement.geometryModified).toBe(false)
      expect(refined.data.nodes.map(node => node.name).sort()).toEqual(original.data.nodes.map(node => node.name).sort())
      for (const material of refined.data.materials.filter(item => item.name.startsWith('Refined illustrative'))) {
        expect(material.normalTexture).toBeDefined()
        expect(material.pbrMetallicRoughness?.baseColorTexture).toBeDefined()
        expect(material.pbrMetallicRoughness?.metallicRoughnessTexture).toBeDefined()
      }
    }
  })
  it('院地使用压实土材质，地面与土墙的真实GLB纹理按米重复而非铺满整张大面', async () => {
    for (const [file, floor] of [['meeting-refined.glb', 'Courtyard floor'], ['market-refined.glb', 'Market courtyard']]) {
      const glb = await readGlb('sets/' + file)
      const ground = planarTileSizes(glb, floor!, 1, 1)
      expect(ground.material.name).toContain('earth - embedded PBR')
      expect(ground.tiles.length).toBeGreaterThan(0)
      for (const tile of ground.tiles) expect(tile).toBeCloseTo(1.5, 4)
    }
    const meeting = await readGlb('sets/meeting-refined.glb')
    for (const name of ['Reception wall left', 'Reception wall right', 'Shadowed inner wall']) {
      const wall = planarTileSizes(meeting, name, 2, -1)
      expect(wall.material.name).toContain('plaster - embedded PBR')
      expect(wall.tiles.length).toBeGreaterThan(0)
      for (const tile of wall.tiles) expect(tile).toBeCloseTo(1, 4)
    }
  })
})
