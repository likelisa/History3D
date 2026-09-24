import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { storeBundle } from '../processing/src/bundles.ts'
import { submitWorldFeedback, type WorldFeedback } from '../processing/src/feedback.ts'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { reviewViewerPatch } from '../processing/src/asset-patch.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateScenePackage } from '../contracts/src/validate.ts'

const roots: string[] = []
async function temp() { const root = await mkdtemp(path.join(os.tmpdir(), 'history3d-feedback-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('viewer feedback', () => {
  it('keeps a candidate, rejects stale parents, and never promotes on acceptance', async () => {
    const data = await temp()
    const importReceipt = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu')
    const release = await buildWorldRelease(importReceipt.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const lineage = JSON.parse(await readFile(path.join(release.path, 'asset-lineage.json'), 'utf8'))
    const base = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
    const zipPath = path.join(data, 'patch.zip')
    const script = 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w") as z: z.write(sys.argv[1],"assets/cargo-patch.glb")'
    const made = spawnSync('/usr/bin/python3', ['-c', script, path.resolve('processing/fixtures/assets/staff-demo.glb'), zipPath])
    expect(made.status).toBe(0)
    const bundle = await storeBundle(zipPath, data)
    const input: WorldFeedback = {
      handoffVersion: '1.0.0', feedbackId: 'jin-001', storyId: release.storyId, releaseId: release.releaseId, sceneRevision: 2,
      viewerBuild: 'viewer-test-sha', result: 'changes_requested', bundleId: bundle.bundleId,
      issues: [{ issueId: 'viewer-cargo-01', owner: 'processor', objectId: 'obj-pack-a', severity: 'warning', message: 'cargo shape', reproduce: 'beat 2', expectedChange: 'review patch' }],
      assetPatches: [{ assetId: 'asset-pack-bundle', baseAssetRevision: base.adoptedRevision, baseSha256: base.sha256, candidatePath: 'assets/cargo-patch.glb', operations: ['technical candidate'], preservesDimensions: false }],
      planChanges: [], measurements: { device: 'test', viewport: [1440, 900] },
    }
    const receipt = await submitWorldFeedback(input, data)
    expect(receipt.patchResults[0].status).toBe('needs_review')
    expect(await submitWorldFeedback(input, data)).toEqual(receipt)
    const stale = { ...input, feedbackId: 'jin-002', assetPatches: [{ ...input.assetPatches[0], baseSha256: '0'.repeat(64) }] }
    const conflict = await submitWorldFeedback(stale, data)
    expect(conflict.patchResults[0].code).toBe('ASSET_REVISION_CONFLICT')
    await expect(submitWorldFeedback({ ...input, result: 'accepted' }, data)).rejects.toThrow('FEEDBACK_ID_CONFLICT')
    await expect(readFile(path.join(data, 'registry', release.storyId, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('integrates an approved material-only patch into a new immutable candidate', async () => {
    const data = await temp()
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-patch')
    const base = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const lineage = JSON.parse(await readFile(path.join(base.path, 'asset-lineage.json'), 'utf8'))
    const parent = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
    const source = await readFile(path.join(base.path, 'assets/pack-bundle.glb'))
    const jsonLength = source.readUInt32LE(12)
    const before = source.subarray(20, 20 + jsonLength).toString('utf8')
    const after = before.replace('0.4341536361747489', '0.5341536361747489')
    expect(after).not.toBe(before)
    Buffer.from(after).copy(source, 20)
    const candidatePath = path.join(data, 'cargo-material.glb')
    await writeFile(candidatePath, source)
    const zipPath = path.join(data, 'material-patch.zip')
    const zipped = spawnSync('/usr/bin/python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w") as z: z.write(sys.argv[1],"assets/cargo-material.glb")', candidatePath, zipPath])
    expect(zipped.status).toBe(0)
    const bundle = await storeBundle(zipPath, data)
    const feedback: WorldFeedback = {
      handoffVersion: '1.0.0', feedbackId: 'jin-material-001', storyId: base.storyId, releaseId: base.releaseId, sceneRevision: 2,
      viewerBuild: 'viewer-test', result: 'changes_requested', bundleId: bundle.bundleId, issues: [],
      assetPatches: [{ assetId: 'asset-pack-bundle', baseAssetRevision: 1, baseSha256: parent.sha256, candidatePath: 'assets/cargo-material.glb', operations: ['material tint'], preservesDimensions: true }],
      planChanges: [], measurements: { device: 'test', viewport: [1440, 900] },
    }
    const receipt = await submitWorldFeedback(feedback, data)
    expect(receipt.patchResults[0].status).toBe('needs_review')
    const decision = { decisionId: 'b-adopt-001', action: 'integrate' as const, operator: 'processing-test', reason: 'material-only candidate for formal recheck', storyId: base.storyId, feedbackId: feedback.feedbackId, assetId: 'asset-pack-bundle', candidateHash: receipt.patchResults[0].candidateHash!, baseReleaseId: base.releaseId, baseAssetRevision: 1, baseSha256: parent.sha256 }
    const staleLock = path.join(data, 'locks', `${base.storyId}-asset-pack-bundle.lock`)
    await mkdir(staleLock, { recursive: true })
    await writeFile(path.join(staleLock, 'owner.json'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 60_000 }))
    const selected = await reviewViewerPatch(decision, data)
    expect(selected.status).toBe('integrated_candidate')
    expect(selected.assetRevision).toBe(2)
    expect((await reviewViewerPatch(decision, data)).releaseId).toBe(selected.releaseId)
    await rm(path.join(data, 'decisions', base.storyId, `${decision.decisionId}.json`))
    await rm(path.join(data, 'registry', base.storyId, 'selected-assets', 'asset-pack-bundle.json'))
    expect((await reviewViewerPatch(decision, data)).releaseId).toBe(selected.releaseId)
    const nextDir = path.join(data, 'releases', base.storyId, selected.releaseId!)
    const nextLineage = JSON.parse(await readFile(path.join(nextDir, 'asset-lineage.json'), 'utf8'))
    expect(nextLineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle').adoptedRevision).toBe(2)
    expect(JSON.parse(await readFile(path.join(nextDir, 'experience.json'), 'utf8')).sceneRevision).toBe(3)
    expect((await validateScenePackage(createNodeReader(nextDir), { checkGlbBounds: true })).diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect((await readFile(path.join(base.path, 'assets/pack-bundle.glb'))).equals(source)).toBe(false)
    await expect(readFile(path.join(data, 'registry', base.storyId, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(submitWorldFeedback({ ...feedback, feedbackId: 'jin-missing-bundle', bundleId: 'bundle-aaaaaaaaaaaaaaaaaaaa' }, data)).rejects.toThrow('BUNDLE_NOT_FOUND')
    const competing = await readFile(path.join(base.path, 'assets/pack-bundle.glb'))
    const competingJson = competing.subarray(20, 20 + competing.readUInt32LE(12)).toString('utf8').replace('0.4341536361747489', '0.6341536361747489')
    Buffer.from(competingJson).copy(competing, 20)
    const competingFile = path.join(data, 'competing.glb')
    await writeFile(competingFile, competing)
    const competingZip = path.join(data, 'competing.zip')
    expect(spawnSync('/usr/bin/python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w") as z: z.write(sys.argv[1],"assets/competing.glb")', competingFile, competingZip]).status).toBe(0)
    const competingBundle = await storeBundle(competingZip, data)
    const competingFeedback = { ...feedback, feedbackId: 'jin-material-002', bundleId: competingBundle.bundleId, assetPatches: [{ ...feedback.assetPatches[0], candidatePath: 'assets/competing.glb' }] }
    const competingReceipt = await submitWorldFeedback(competingFeedback, data)
    expect(competingReceipt.patchResults[0].status).toBe('needs_review')
    await expect(reviewViewerPatch({ ...decision, decisionId: 'b-adopt-002', feedbackId: competingFeedback.feedbackId, candidateHash: competingReceipt.patchResults[0].candidateHash! }, data)).rejects.toThrow('ASSET_REVISION_CONFLICT')
  })
})
