import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
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

  it('rejects known dimensions that disagree with actual GLB bounds', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'history3d-handoff-'))
    try {
      await cp(root, temp, { recursive: true })
      const assetFile = path.join(temp, 'assets/asset-manifest.json')
      const assetManifest = JSON.parse(await readFile(assetFile, 'utf8'))
      assetManifest.assets[0].dimensionsM = [9, 0.8, 0.6]
      await writeFile(assetFile, JSON.stringify(assetManifest))
      const handoffFile = path.join(temp, 'handoff.json')
      const handoff = JSON.parse(await readFile(handoffFile, 'utf8'))
      const bytes = await readFile(assetFile)
      const listed = handoff.files.find((item: { path: string }) => item.path === 'assets/asset-manifest.json')
      listed.bytes = bytes.length
      listed.sha256 = createHash('sha256').update(bytes).digest('hex')
      await writeFile(handoffFile, JSON.stringify(handoff))
      expect((await validateCollectionHandoff(createNodeReader(temp))).some((problem) => problem.message.includes('known dimensions do not match'))).toBe(true)
    } finally { await rm(temp, { recursive: true, force: true }) }
  })

  it('does not cascade unknown brief errors when sources cannot be read', async () => {
    const reader = createNodeReader(root)
    const altered = { ...reader, readText: async (relPath: string) => relPath === 'sources.json' ? null : reader.readText(relPath) }
    const problems = await validateCollectionHandoff(altered)
    expect(problems.some((problem) => problem.path === 'sources.json')).toBe(true)
    expect(problems.some((problem) => problem.message.includes('unknown brief'))).toBe(false)
  })
})
