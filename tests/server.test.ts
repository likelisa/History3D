import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { type AddressInfo } from 'node:net'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createProcessingServer } from '../processing/src/server.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'

const tempDirs: string[] = []
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), 'history3d-server-')); tempDirs.push(dir); return dir }
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('processing HTTP API', () => {
  it('uploads, imports, serves feedback and fixed releases without promoting them', async () => {
    const dataDir = await temp()
    const zipPath = path.join(dataDir, 'collection.zip')
    const code = 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for p in root.rglob("*"):\n  if p.is_file(): z.write(p,p.relative_to(root))'
    expect(spawnSync('/usr/bin/python3', ['-c', code, path.resolve('contracts/fixtures/handoff/collection'), zipPath]).status).toBe(0)
    const server = createProcessingServer({ dataDir, reviewApiKey: '' })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/processing/v1`
    try {
      const form = new FormData()
      form.append('file', new Blob([await readFile(zipPath)], { type: 'application/zip' }), 'collection.zip')
      const uploaded = await fetch(`${base}/bundles`, { method: 'POST', body: form })
      expect(uploaded.status).toBe(201)
      const bundle = await uploaded.json() as { bundleId: string }
      const request = { bundleId: bundle.bundleId, submissionId: 'fixture-collection-001', storyId: 'silk-road-demo', sourceContentRevision: 1, profileId: 'desktop-demo-v1' }
      const imported = await fetch(`${base}/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'fu-http-001' }, body: JSON.stringify(request) })
      expect(imported.status).toBe(202)
      const importReceipt = await imported.json() as { importId: string; jobId: string }
      let job: { status: string; stage: string } | null = null
      for (let attempt = 0; attempt < 20; attempt++) {
        job = await (await fetch(`${base}/jobs/${importReceipt.jobId}`)).json() as { status: string; stage: string }
        if (job.status !== 'processing') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(job?.status).toBe('needs_input')
      const feedbackResponse = await fetch(`${base}/imports/${importReceipt.importId}/feedback`)
      expect(feedbackResponse.status).toBe(200)
      const feedback = await feedbackResponse.json() as { informationRequests: unknown[]; packageBaseUrl: string }
      expect(feedback.informationRequests.length).toBeGreaterThan(0)
      const glb = await fetch(`${base}/artifacts/${importReceipt.importId}/feedback/assets/pack-bundle.glb`)
      expect(glb.status).toBe(200)
      expect((await glb.arrayBuffer()).byteLength).toBe(1632)
      const release = await buildWorldRelease(importReceipt.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), dataDir, path.resolve('.'))
      const strategies = await (await fetch(`${base}/strategies`)).json() as { policy: { maxCostUsd: number }; strategies: Array<{ id: string; available: boolean }> }
      expect(strategies.policy.maxCostUsd).toBe(0)
      expect(strategies.strategies.find((item) => item.id === 'generate-3d')?.available).toBe(false)
      const lineage = JSON.parse(await readFile(path.join(release.path, 'asset-lineage.json'), 'utf8'))
      const cargo = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
      const tasked = await fetch(`${base}/asset-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'task-http-001' }, body: JSON.stringify({ strategyId: 'generate-3d', storyId: release.storyId, releaseId: release.releaseId, assetId: 'asset-pack-bundle', expectedBaseSha256: cargo.sha256, issueIds: [], repairGoal: 'repair cargo', parameters: {}, maxCostUsd: 1 }) })
      expect(tasked.status).toBe(202)
      const proposed = await tasked.json() as { taskId: string; status: string }
      expect(proposed.status).toBe('needs_budget')
      expect((await fetch(`${base}/asset-tasks/${proposed.taskId}`)).status).toBe(200)
      const released = await fetch(`${base}/worlds/${release.storyId}/releases/${release.releaseId}`)
      expect(released.status).toBe(200)
      const releaseBody = await released.json() as { packageBaseUrl: string; qualityStatus: string }
      expect(releaseBody.qualityStatus).toBe('needs_review')
      expect((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${releaseBody.packageBaseUrl}/scene.json`)).status).toBe(200)
      const postedFeedback = await fetch(`${base}/worlds/${release.storyId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffVersion: '1.0.0', feedbackId: 'viewer-http-001', storyId: release.storyId, releaseId: release.releaseId, sceneRevision: 2, viewerBuild: 'viewer-test', result: 'changes_requested', bundleId: null, issues: [{ issueId: 'viewer-001', owner: 'processor', objectId: 'obj-pack-a', severity: 'warning', message: 'closer view needed', reproduce: 'beat 2', expectedChange: 'review cargo' }], assetPatches: [], planChanges: [], measurements: { device: 'test', viewport: [1440, 900] } }),
      })
      expect(postedFeedback.status).toBe(202)
      expect((await fetch(`${base}/feedback/viewer-http-001`)).status).toBe(200)
      const list = await (await fetch(`${base}/worlds/${release.storyId}/releases`)).json() as { currentReleaseId: string | null }
      expect(list.currentReleaseId).toBeNull()
      const unsafeStatus = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: `/api/processing/v1/artifacts/${release.releaseId}/%2e%2e/scene.json` }, (response) => { response.resume(); resolve(response.statusCode ?? 0) })
        req.on('error', reject)
        req.end()
      })
      expect(unsafeStatus).toBe(400)
      const forbiddenOrigin = await fetch(`${base}/capabilities`, { headers: { Origin: 'https://untrusted.example' } })
      expect(forbiddenOrigin.status).toBe(403)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
