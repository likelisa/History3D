import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { readGlbBounds } from '../contracts/src/glb.ts'

function fixturePath(name: string): string {
  return path.resolve('contracts', 'fixtures', 'glb', name)
}

async function readBounds(name: string) {
  const buffer = await readFile(fixturePath(name))
  return readGlbBounds(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  )
}

describe('GLB 包围盒', () => {
  it('基准立方体为 1 × 1 × 1 米，且原点在底部中心', async () => {
    const bounds = await readBounds('unit-cube.glb')
    expect(bounds).not.toBeNull()
    expect(bounds?.dimensions[0]).toBeCloseTo(1, 5)
    expect(bounds?.dimensions[1]).toBeCloseTo(1, 5)
    expect(bounds?.dimensions[2]).toBeCloseTo(1, 5)
    expect(bounds?.min[1]).toBeCloseTo(0, 5)
    expect(bounds?.max[1]).toBeCloseTo(1, 5)
    expect(bounds?.min[0]).toBeCloseTo(-0.5, 5)
    expect(bounds?.max[0]).toBeCloseTo(0.5, 5)
  })

  it('行囊占位体为 1.2 × 0.8 × 0.6 米', async () => {
    const bounds = await readBounds('pack-bundle.glb')
    expect(bounds?.dimensions[0]).toBeCloseTo(1.2, 5)
    expect(bounds?.dimensions[1]).toBeCloseTo(0.8, 5)
    expect(bounds?.dimensions[2]).toBeCloseTo(0.6, 5)
  })

  it('不是 GLB 时返回 null，而不是抛错', () => {
    expect(readGlbBounds(new ArrayBuffer(16))).toBeNull()
  })
})
