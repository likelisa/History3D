import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { auditRelease, decideRelease } from '../processing/src/release-registry.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('release registry', () => {
  it('keeps an unreviewed fixture as a candidate, even with a promote decision', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-registry-'))
    roots.push(data)
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'registry-fixture')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const audit = await auditRelease(release.storyId, release.releaseId, data)
    expect(audit.ready).toBe(false)
    expect(audit.gates.map((gate) => gate.code)).toContain('GENERATION')
    expect(audit.gates.map((gate) => gate.code)).toContain('WORLD_REVIEW')
    expect(audit.gates.map((gate) => gate.code)).toContain('ACCEPTANCE')
    const decision = { decisionId: 'fixture-promote-001', action: 'promote' as const, storyId: release.storyId,
      releaseId: release.releaseId, expectedReleaseHash: audit.snapshotHash, expectedCurrentReleaseId: null,
      operator: 'test', reason: 'test refusal' }
    await expect(decideRelease(decision, data)).rejects.toThrow('RELEASE_NOT_READY')
    await expect(readFile(path.join(data, 'registry', release.storyId, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const sceneFile = path.join(release.path, 'scene.json')
    await writeFile(sceneFile, `${await readFile(sceneFile, 'utf8')}tampered`)
    const damaged = await auditRelease(release.storyId, release.releaseId, data)
    expect(damaged.gates.map((gate) => gate.code)).toContain('FILE_HASH')
  })

  it('atomically selects a fully evidenced synthetic release and permits rollback only to an approved version', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-registry-'))
    roots.push(data)
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'registry-synthetic')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const put = async (file: string, value: unknown) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n') }
    const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
    const qualityPath = path.join(release.path, 'quality-report.json')
    const quality = JSON.parse(await readFile(qualityPath, 'utf8'))
    quality.unresolved = []
    await put(qualityPath, quality)
    const generationPath = path.join(release.path, 'generation-report.json')
    const generation = JSON.parse(await readFile(generationPath, 'utf8'))
    generation.realProviderGenerationPerformed = true
    await put(generationPath, generation)
    const manifestPath = path.join(release.path, 'release.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const file of manifest.files) { const bytes = await readFile(path.join(release.path, file.path)); file.sha256 = digest(bytes); file.bytes = bytes.length }
    await put(manifestPath, manifest)
    const snapshotHash = digest(await readFile(manifestPath))
    const receipt = JSON.parse(await readFile(path.join(data, 'imports', imported.importId, 'receipt.json'), 'utf8'))
    const assetId = 'asset-pack-bundle'
    const inputReview = path.join(data, 'imports', imported.importId, 'reviews', `review-${receipt.snapshotHash.slice(0, 20)}-${assetId}`)
    await put(path.join(inputReview, 'job.json'), { status: 'pass' })
    await put(path.join(inputReview, 'report.json'), { decision: 'pass', snapshotHash: receipt.snapshotHash })
    const worldReview = path.join(data, 'world-reviews', release.storyId, release.releaseId, `world-review-${snapshotHash.slice(0, 20)}`)
    await put(path.join(worldReview, 'job.json'), { status: 'pass' })
    await put(path.join(worldReview, 'report.json'), { decision: 'pass', snapshotHash, unassessed: [] })
    const viewerFeedbackId = 'synthetic-accepted-001'
    await put(path.join(data, 'viewer-feedback', release.storyId, viewerFeedbackId, 'record.json'), { input: {
      releaseId: release.releaseId, sceneRevision: manifest.sceneRevision, result: 'accepted', viewerBuild: 'synthetic-viewer',
      measurements: { viewport: [1440, 900] }, issues: [],
    } })
    await put(path.join(data, 'registry', release.storyId, 'acceptance', `${release.releaseId}.json`), {
      storyId: release.storyId, releaseId: release.releaseId, releaseSnapshotHash: snapshotHash, operator: 'synthetic-test',
      environment: { device: 'synthetic', browser: 'synthetic', viewport: [1440, 900], gpu: 'synthetic', dpr: 1 },
      coldLoadSeconds: [1, 1, 1], walkSeconds: 90, medianFps: 30, lowFps: 20, continuousPlaybackChecked: true,
      musicAudition: 'passed', collectorHistoricalApproval: 'synthetic-test', viewerFeedbackId, viewerBuild: 'synthetic-viewer',
      screenshotRefs: ['synthetic.png'], knownLimitations: [],
    })
    expect((await auditRelease(release.storyId, release.releaseId, data)).ready).toBe(true)
    const promote = { decisionId: 'synthetic-promote-001', action: 'promote' as const, storyId: release.storyId,
      releaseId: release.releaseId, expectedReleaseHash: snapshotHash, expectedCurrentReleaseId: null,
      operator: 'synthetic-test', reason: 'verify registry mechanics' }
    expect((await decideRelease(promote, data)).currentReleaseId).toBe(release.releaseId)
    expect(await decideRelease(promote, data)).toEqual({ currentReleaseId: release.releaseId, previousReleaseId: null })
    await expect(decideRelease({ ...promote, decisionId: 'bad-rollback', action: 'rollback', expectedCurrentReleaseId: null }, data))
      .rejects.toThrow('CURRENT_RELEASE_CONFLICT')
  })
})
