import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { hasBlockingError } from '../contracts/src/diagnostics.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollection, type PackageReader } from '../contracts/src/validate.ts'

const fixture = path.resolve('contracts/fixtures/collection/silk-road-demo')

function changedReader(
  file: 'story.json' | 'sources.json',
  change: (data: Record<string, unknown>) => void,
  missing: string[] = [],
): PackageReader {
  const base = createNodeReader(fixture)
  return {
    ...base,
    async readText(relPath) {
      const text = await base.readText(relPath)
      if (relPath !== file || text === null) return text
      const data = JSON.parse(text) as Record<string, unknown>
      change(data)
      return JSON.stringify(data)
    },
    async exists(relPath) {
      return !missing.includes(relPath) && base.exists(relPath)
    },
  }
}

describe('采集交接契约', () => {
  it('演示三件套可校验，且只代表结构样例', async () => {
    const result = await validateCollection(createNodeReader(fixture))
    expect(hasBlockingError(result.diagnostics)).toBe(false)
    expect(result.story?.storyId).toBe('silk-road-demo')
    expect(result.story?.status).toBe('draft')
    expect(result.sources?.contentRevision).toBe(result.story?.contentRevision)
  })

  it('两份 JSON 版本不同会拦截', async () => {
    const reader = changedReader('sources.json', (data) => {
      data.contentRevision = 2
    })
    const result = await validateCollection(reader)
    expect(result.diagnostics.some((item) => item.code === 'REVISION_MISMATCH')).toBe(true)
  })

  it('引用不存在的来源会拦截', async () => {
    const reader = changedReader('story.json', (data) => {
      const claims = data.claims as Array<Record<string, unknown>>
      claims[0].sourceIds = ['missing-source']
    })
    const result = await validateCollection(reader)
    expect(result.diagnostics.some((item) => item.code === 'REFERENCE_MISSING')).toBe(true)
  })

  it('本地素材缺失会拦截', async () => {
    const reader = changedReader('story.json', () => {}, ['references/route-overview.svg'])
    const result = await validateCollection(reader)
    expect(result.diagnostics.some((item) => item.field === 'routeOverview.imagePath')).toBe(true)
  })

  it('越界路径和额外字段会拦截', async () => {
    const reader = changedReader('story.json', (data) => {
      data.internalScore = 99
      data.routeOverview = { kind: 'schematic', imagePath: '../outside.svg' }
    })
    const result = await validateCollection(reader)
    expect(result.diagnostics.filter((item) => item.code === 'VALIDATION_FAILED').length).toBeGreaterThanOrEqual(2)
  })
})
