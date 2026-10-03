import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { captureBrowserFrame, listBrowserFrames } from '../processing/src/review/browser-evidence.ts'
import { makePng } from './png-fixture.ts'
import { runWorldReview } from '../processing/src/review/world-review.ts'
import { DEFAULT_BLENDER_PATH } from '../processing/src/strategies/registry.ts'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('formal viewer frame evidence', () => {
  it('binds a PNG to a fixed release, viewport and beat time without editing the release', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-frame-'))
    dirs.push(data)
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-frame')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const png = makePng()
    const viewport: [number, number] = [png.readUInt32BE(16), png.readUInt32BE(20)]
    const meta = { viewerBuild: 'viewer-test-sha', timeSeconds: 0, viewport, dpr: 1, userAgent: 'test' }
    const frame = await captureBrowserFrame(release.storyId, release.releaseId, 'beat-1', png, meta, data)
    expect(frame.releaseSnapshotHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await listBrowserFrames(release.storyId, release.releaseId, data)).map((item) => item.viewId)).toEqual(['beat-1'])
    await expect(captureBrowserFrame(release.storyId, release.releaseId, 'beat-2', png, meta, data)).rejects.toThrow('FRAME_BEAT_MISMATCH')
    await expect(captureBrowserFrame(release.storyId, release.releaseId, 'beat-1', png, { ...meta, viewport: [viewport[0] + 100, viewport[1]] }, data)).rejects.toThrow('FRAME_VIEWPORT_MISMATCH')
    expect((await readFile(path.join(release.path, 'release.json'))).length).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH))('keeps formal frame paths when offline views are staged', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-world-evidence-'))
    dirs.push(data)
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-world-evidence')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const png = makePng()
    await captureBrowserFrame(release.storyId, release.releaseId, 'beat-1', png, { viewerBuild: 'test', timeSeconds: 0, viewport: [320, 240], dpr: 1, userAgent: 'test' }, data)
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ id: 'test-review', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'inconclusive', findings: [], unassessed: ['motion continuity'], suggestedStrategies: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) })) as unknown as typeof fetch
    const result = await runWorldReview(release.storyId, release.releaseId, null, data, { apiKey: 'test', fetchImpl: fakeFetch })
    expect(result.status, result.error ?? undefined).toBe('inconclusive')
    const evidence = JSON.parse(await readFile(path.join(data, 'world-reviews', release.storyId, release.releaseId, result.reviewId, 'evidence.json'), 'utf8'))
    const framePath = evidence.images.find((item: { viewId: string }) => item.viewId === 'beat-1').path as string
    expect(framePath.split(path.sep).join('/')).toContain('/browser-evidence/')
    expect(await readFile(framePath)).toEqual(png)
    // Real Blender rendering includes GPU/shader initialization on a cold run.
  }, 60000)
})
