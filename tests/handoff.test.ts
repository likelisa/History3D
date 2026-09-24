import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollectionHandoff } from '../contracts/src/handoff-validate.ts'

const root = path.resolve('contracts/fixtures/handoff/collection')

describe('collection handoff', () => {
  it('accepts the complete fixture with actual file digests', async () => {
    expect(await validateCollectionHandoff(createNodeReader(root))).toEqual([])
  })

  it('rejects a changed file without trusting the manifest', async () => {
    const reader = createNodeReader(root)
    const altered = {
      ...reader,
      readBinary: async (relPath: string) => relPath === 'plan.md'
        ? new TextEncoder().encode('changed').buffer
        : reader.readBinary(relPath),
    }
    expect(await validateCollectionHandoff(altered)).toContainEqual({ path: 'plan.md', message: 'file digest mismatch' })
  })

  it('rejects traversal before reading it', async () => {
    const reader = createNodeReader(root)
    const original = await reader.readText('handoff.json')
    const handoff = JSON.parse(original!)
    handoff.files[0].path = '../outside.json'
    const altered = { ...reader, readText: async (relPath: string) => relPath === 'handoff.json' ? JSON.stringify(handoff) : reader.readText(relPath) }
    expect((await validateCollectionHandoff(altered)).some((problem) => problem.message.includes('invalid file entry'))).toBe(true)
  })
})
