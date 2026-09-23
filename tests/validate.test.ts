import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { DiagnosticCode } from '../contracts/src/diagnostics.ts'
import { hasBlockingError } from '../contracts/src/diagnostics.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollection, validateScenePackage } from '../contracts/src/validate.ts'

async function validateFixture(relPath: string) {
  return validateScenePackage(createNodeReader(path.resolve(relPath)), { checkGlbBounds: true })
}

function codesOf(diagnostics: Array<{ code: DiagnosticCode }>): DiagnosticCode[] {
  return diagnostics.map((item) => item.code)
}

describe('有效样例', () => {
  it('最小样例通过校验', async () => {
    const result = await validateFixture('contracts/fixtures/valid/minimal')
    expect(result.diagnostics).toEqual([])
    expect(result.scene?.storyId).toBe('minimal-fixture')
  })

  it('正式 demo 包通过校验', async () => {
    const result = await validateFixture('packages/silk-road-demo')
    expect(result.diagnostics).toEqual([])
  })

  it('记录多个实例的数量与 count 判断一致', async () => {
    const result = await validateFixture('packages/silk-road-demo')
    const packBrief = result.story?.objectBriefs.find((brief) => brief.id === 'brief-pack')
    expect(packBrief).toBeDefined()
    const instances = result.scene?.objects.filter((object) => object.briefId === 'brief-pack')
    expect(instances).toHaveLength(2)
  })

  it('资料包样例通过采集层校验', async () => {
    const result = await validateCollection(
      createNodeReader(path.resolve('contracts/fixtures/collection/silk-road-demo')),
    )
    expect(hasBlockingError(result.diagnostics)).toBe(false)
  })
})

describe('定向失败样例', () => {
  const cases: Array<[string, DiagnosticCode]> = [
    ['schema-unsupported', 'SCHEMA_UNSUPPORTED'],
    ['unknown-field', 'VALIDATION_FAILED'],
    ['revision-mismatch', 'REVISION_MISMATCH'],
    ['missing-reference', 'REFERENCE_MISSING'],
    ['missing-asset', 'REFERENCE_MISSING'],
  ]

  for (const [name, expected] of cases) {
    it(`${name} 报出 ${expected}`, async () => {
      const result = await validateFixture(path.join('contracts', 'fixtures', 'invalid', name))
      expect(hasBlockingError(result.diagnostics)).toBe(true)
      expect(codesOf(result.diagnostics)).toContain(expected)
    })
  }

  it('未知字段会指向具体字段名', async () => {
    const result = await validateFixture('contracts/fixtures/invalid/unknown-field')
    const unknownField = result.diagnostics.find((item) =>
      item.message.includes('additional properties'),
    )
    expect(unknownField?.field).toBe('draftNotes')
  })
})

describe('业务规则', () => {
  it('尺寸声明与 GLB 实测不一致时会被拦下', async () => {
    const result = await validateFixture('contracts/fixtures/valid/minimal')
    expect(result.diagnostics).toEqual([])

    const reader = createNodeReader(path.resolve('contracts/fixtures/valid/minimal'))
    const original = reader.readText
    reader.readText = async (relPath: string) => {
      const text = await original(relPath)
      if (relPath !== 'scene.json' || !text) return text
      const data = JSON.parse(text) as { assets: Array<{ dimensionsM: number[] }> }
      data.assets[0].dimensionsM = [2, 1, 1]
      return JSON.stringify(data)
    }

    const mutated = await validateScenePackage(reader, { checkGlbBounds: true })
    expect(codesOf(mutated.diagnostics)).toContain('VALIDATION_FAILED')
  })

  it('出生点落在阻挡区时会被拦下', async () => {
    const reader = createNodeReader(path.resolve('contracts/fixtures/valid/minimal'))
    const original = reader.readText
    reader.readText = async (relPath: string) => {
      const text = await original(relPath)
      if (relPath !== 'scene.json' || !text) return text
      const data = JSON.parse(text) as {
        blockers: Array<{ id: string; min: number[]; max: number[] }>
      }
      data.blockers = [{ id: 'blk-spawn', min: [-2, 4], max: [2, 8] }]
      return JSON.stringify(data)
    }

    const mutated = await validateScenePackage(reader, { checkGlbBounds: true })
    expect(codesOf(mutated.diagnostics)).toContain('VALIDATION_FAILED')
    expect(
      mutated.diagnostics.some((item) => item.field.includes('spawnFeet')),
    ).toBe(true)
  })

  it('unknown 判断带值会被拦下', async () => {
    const reader = createNodeReader(path.resolve('packages/silk-road-demo'))
    const original = reader.readText
    reader.readText = async (relPath: string) => {
      const text = await original(relPath)
      if (relPath !== 'story.json' || !text) return text
      const data = JSON.parse(text) as { claims: Array<Record<string, unknown>> }
      const unknown = data.claims.find((claim) => claim.id === 'claim-beast-dimensions-real')
      if (unknown) unknown.value = [1, 1, 1]
      return JSON.stringify(data)
    }

    const mutated = await validateScenePackage(reader, { checkGlbBounds: true })
    expect(
      mutated.diagnostics.some((item) => item.message.includes('unknown 但带有值')),
    ).toBe(true)
  })
})
