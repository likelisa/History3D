import type { Vec3 } from './types.ts'

export interface GlbBounds {
  min: Vec3
  max: Vec3
  dimensions: Vec3
  nodeCount: number
}

type Mat4 = number[]

interface GlbAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

interface GlbBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GlbJson {
  asset?: { version?: string }
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: {
    children?: number[]
    mesh?: number
    matrix?: number[]
    translation?: number[]
    rotation?: number[]
    scale?: number[]
  }[]
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[]
  accessors?: GlbAccessor[]
  bufferViews?: GlbBufferView[]
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/**
 * 读取 GLB 的 POSITION 包围盒。
 * 这是结构性检查，用于复核 `assets[].dimensionsM` 声明，不等同于在浏览器里真正加载模型。
 */
export function readGlbBounds(buffer: ArrayBuffer): GlbBounds | null {
  const view = new DataView(buffer)
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) return null
  if (view.getUint32(4, true) !== 2) return null

  const totalLength = Math.min(view.getUint32(8, true), buffer.byteLength)
  let offset = 12
  let json: GlbJson | null = null
  let binary: Uint8Array | null = null

  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd > totalLength) break
    if (chunkType === CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, dataStart, chunkLength))
      try {
        json = JSON.parse(text.trim()) as GlbJson
      } catch {
        return null
      }
    } else if (chunkType === CHUNK_BIN) {
      binary = new Uint8Array(buffer, dataStart, chunkLength)
    }
    offset = dataEnd + ((4 - (chunkLength % 4)) % 4)
  }

  if (!json) return null

  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let nodeCount = 0

  const rootNodes =
    json.scenes?.[json.scene ?? 0]?.nodes ??
    (json.nodes ?? []).map((_, index) => index)

  const visit = (nodeIndex: number, parent: Mat4): void => {
    const node = json?.nodes?.[nodeIndex]
    if (!node) return
    const local = node.matrix
      ? (node.matrix as Mat4)
      : composeMatrix(
          (node.translation as Vec3) ?? [0, 0, 0],
          (node.rotation as number[]) ?? [0, 0, 0, 1],
          (node.scale as Vec3) ?? [1, 1, 1],
        )
    const world = multiplyMatrix(parent, local)

    if (typeof node.mesh === 'number') {
      const primitives = json?.meshes?.[node.mesh]?.primitives ?? []
      for (const primitive of primitives) {
        const accessorIndex = primitive.attributes?.POSITION
        if (typeof accessorIndex !== 'number') continue
        const positions = readPositions(json as GlbJson, binary, accessorIndex)
        for (const position of positions) {
          const point = transformPoint(world, position)
          nodeCount += 1
          for (let axis = 0; axis < 3; axis += 1) {
            if (point[axis] < min[axis]) min[axis] = point[axis]
            if (point[axis] > max[axis]) max[axis] = point[axis]
          }
        }
      }
    }

    for (const child of node.children ?? []) visit(child, world)
  }

  for (const nodeIndex of rootNodes) visit(nodeIndex, identityMatrix())
  if (nodeCount === 0) return null

  return {
    min,
    max,
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    nodeCount,
  }
}

function readPositions(
  json: GlbJson,
  binary: Uint8Array | null,
  accessorIndex: number,
): Vec3[] {
  const accessor = json.accessors?.[accessorIndex]
  if (!accessor) return []
  if (accessor.type !== 'VEC3') return []

  const positions: Vec3[] = []
  const bufferView =
    typeof accessor.bufferView === 'number' ? json.bufferViews?.[accessor.bufferView] : undefined

  if (!binary || !bufferView || accessor.componentType !== 5126) {
    const fallback = readAccessorMinMax(accessor)
    return fallback ? fallback : []
  }

  const dataView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const stride = bufferView.byteStride ?? 12
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  for (let index = 0; index < accessor.count; index += 1) {
    const start = base + index * stride
    if (start + 12 > binary.byteLength) break
    positions.push([
      dataView.getFloat32(start, true),
      dataView.getFloat32(start + 4, true),
      dataView.getFloat32(start + 8, true),
    ])
  }
  return positions
}

function readAccessorMinMax(accessor: GlbAccessor & { min?: number[]; max?: number[] }): Vec3[] | null {
  const min = accessor.min
  const max = accessor.max
  if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) {
    return null
  }
  const low = min.slice(0, 3) as Vec3
  const high = max.slice(0, 3) as Vec3
  const corners: Vec3[] = []
  for (const x of [low[0], high[0]]) {
    for (const y of [low[1], high[1]]) {
      for (const z of [low[2], high[2]]) {
        corners.push([x, y, z])
      }
    }
  }
  return corners
}

function identityMatrix(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiplyMatrix(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k]
      }
      out[column * 4 + row] = sum
    }
  }
  return out
}

function composeMatrix(translation: Vec3, rotation: number[], scale: Vec3): Mat4 {
  const [x, y, z, w] = [
    rotation[0] ?? 0,
    rotation[1] ?? 0,
    rotation[2] ?? 0,
    rotation[3] ?? 1,
  ]
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z

  return [
    (1 - 2 * (yy + zz)) * scale[0],
    2 * (xy + wz) * scale[0],
    2 * (xz - wy) * scale[0],
    0,
    2 * (xy - wz) * scale[1],
    (1 - 2 * (xx + zz)) * scale[1],
    2 * (yz + wx) * scale[1],
    0,
    2 * (xz + wy) * scale[2],
    2 * (yz - wx) * scale[2],
    (1 - 2 * (xx + yy)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ]
}

function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ]
}
