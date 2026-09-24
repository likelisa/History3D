import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { storeBundle } from '../processing/src/bundles.ts'
import { submitWorldFeedback, type WorldFeedback } from '../processing/src/feedback.ts'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'

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
})
