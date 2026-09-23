#!/usr/bin/env node
// 生成契约用基准 GLB：米制、Y 向上、右手系、正面朝 +Z、原点在包围盒底部中心。
// 手写 glTF 2.0 二进制，避免为技术样例引入建模工具或运行时依赖。
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const FACES = [
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
]

function hexToLinearRgb(hex) {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
  return channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
}

export function makeBoxGlb({ width, height, depth, color = '#b08968' }) {
  const positions = []
  const normals = []
  const indices = []

  for (const [faceIndex, face] of FACES.entries()) {
    const base = faceIndex * 4
    for (const corner of face.corners) {
      positions.push(
        (corner[0] - 0.5) * width,
        corner[1] * height,
        (corner[2] - 0.5) * depth,
      )
      normals.push(face.normal[0], face.normal[1], face.normal[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const indexBytes = Buffer.from(new Uint16Array(indices).buffer)
  const positionBytes = Buffer.from(new Float32Array(positions).buffer)
  const normalBytes = Buffer.from(new Float32Array(normals).buffer)
  const binary = Buffer.concat([indexBytes, positionBytes, normalBytes])

  const json = {
    asset: { version: '2.0', generator: 'history3d fixture script (make-fixture-glb.mjs)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'fixture-box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }] }],
    materials: [
      {
        name: 'fixture-material',
        pbrMetallicRoughness: {
          baseColorFactor: [...hexToLinearRgb(color), 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [-width / 2, 0, -depth / 2],
        max: [width / 2, height, depth / 2],
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
        min: [-1, -1, -1],
        max: [1, 1, 1],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes.byteLength, target: 34963 },
      {
        buffer: 0,
        byteOffset: indexBytes.byteLength,
        byteLength: positionBytes.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: indexBytes.byteLength + positionBytes.byteLength,
        byteLength: normalBytes.byteLength,
        target: 34962,
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
  }

  const jsonChunk = padBuffer(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binChunk = padBuffer(binary, 0x00)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.byteLength, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
}

function padBuffer(buffer, padByte) {
  const remainder = buffer.byteLength % 4
  if (remainder === 0) return buffer
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, padByte)])
}

const FIXTURES = [
  { name: 'unit-cube.glb', width: 1, height: 1, depth: 1, color: '#8ecae6' },
  { name: 'pack-bundle.glb', width: 1.2, height: 0.8, depth: 0.6, color: '#b08968' },
]

export const FIXTURE_TARGETS = [
  path.join(repoRoot, 'contracts', 'fixtures', 'glb'),
  path.join(repoRoot, 'packages', 'silk-road-demo', 'assets'),
]

async function main() {
  for (const target of FIXTURE_TARGETS) {
    await mkdir(target, { recursive: true })
    for (const fixture of FIXTURES) {
      const buffer = makeBoxGlb(fixture)
      const destination = path.join(target, fixture.name)
      await writeFile(destination, buffer)
      process.stdout.write(`wrote ${path.relative(repoRoot, destination)} (${buffer.byteLength} bytes)\n`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
