import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { DEFAULT_BLENDER_PATH, loadStrategyPolicy } from '../processing/src/strategies/registry.ts'
import { proposeAssetTask } from '../processing/src/strategies/tasks.ts'
import { executeBlenderRefine } from '../processing/src/strategies/blender-refine.ts'
import { assetReviewSnapshotHash } from '../processing/src/review/asset-review.ts'
import { createReviewRequest, getReviewReport, processReviewRequest } from '../processing/src/review/requests.ts'
import { decideAssetTask } from '../processing/src/strategies/decision.ts'
import { adoptAssetTask } from '../processing/src/strategies/adopt.ts'
import { renderAsset } from '../processing/src/review/orchestrator.ts'

it.skipIf(!existsSync(process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH))('rejects an asset review render when Blender Python import fails', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-render-failure-'))
  try {
    await expect(renderAsset(process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH, path.join(data, 'missing.glb'), path.join(data, 'views')))
      .rejects.toThrow('REVIEW_RENDER_FAILED: Blender exit 1')
  } finally { await rm(data, { recursive: true, force: true }) }
}, 30000)

it.skipIf(!existsSync(process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH))('returns an unchanged-geometry Blender material candidate without adoption', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-refine-'))
  try {
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-refine')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const lineage = JSON.parse(await readFile(path.join(release.path, 'asset-lineage.json'), 'utf8'))
    const cargo = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
    const policy = await loadStrategyPolicy(path.resolve('.'))
    const request = { strategyId: 'blender-refine', storyId: release.storyId, releaseId: release.releaseId, assetId: cargo.assetId as string, expectedBaseSha256: cargo.sha256 as string, issueIds: ['fixture-material'], repairGoal: 'improve technical color contrast', parameters: { operation: 'material_tint', color: '#49748f' }, maxCostUsd: 0 }
    const proposed = await proposeAssetTask(request, 'blender-local', data, policy, false, true)
    expect(proposed.status).toBe('queued')
    const executed = await executeBlenderRefine(proposed.taskId, data, path.resolve('.'))
    expect(executed.status).toBe('candidate_ready')
    expect(executed.attemptCount).toBe(1)
    expect(executed.result?.costUsd).toBe(0)
    expect(executed.result?.reviewStatus).toBe('pending')
    expect(executed.result?.afterDimensionsM).toEqual(executed.result?.beforeDimensionsM)
    expect((await readFile(path.join(data, 'asset-tasks', proposed.taskId, executed.result!.outputPath))).length).toBeGreaterThan(0)
    expect((await executeBlenderRefine(proposed.taskId, data, path.resolve('.'))).result?.outputSha256).toBe(executed.result?.outputSha256)
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ id: 'fixture-review', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'inconclusive', findings: [], unassessed: ['formal viewer candidate comparison'], suggestedStrategies: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) })) as unknown as typeof fetch
    const reviewRequest = await createReviewRequest({ scope: 'asset', taskId: proposed.taskId, snapshotHash: assetReviewSnapshotHash(executed), rubricVersion: 'asset-v1' }, data)
    const reviewedJob = await processReviewRequest(reviewRequest.jobId, data, { apiKey: 'test', fetchImpl: fakeFetch })
    expect(reviewedJob.status, JSON.stringify(reviewedJob.diagnostics)).toBe('complete')
    const reviewId = reviewedJob.reviewRefs[0].reviewId
    expect((await getReviewReport(reviewId, data) as { decision: string }).decision).toBe('inconclusive')
    const reviewed = JSON.parse(await readFile(path.join(data, 'asset-tasks', proposed.taskId, 'task.json'), 'utf8'))
    expect(reviewed.result.reviewStatus).toBe('inconclusive')
    const candidateFile = path.join(data, 'asset-tasks', proposed.taskId, executed.result!.outputPath)
    const originalCandidate = await readFile(candidateFile)
    await writeFile(candidateFile, Buffer.concat([originalCandidate, Buffer.from('tampered')]))
    await expect(executeBlenderRefine(proposed.taskId, data, path.resolve('.'))).rejects.toThrow('ASSET_TASK_ARTIFACT_MISMATCH')
    await writeFile(candidateFile, originalCandidate)
    const report = JSON.parse(await readFile(path.join(data, 'asset-tasks', proposed.taskId, 'reviews', reviewId, 'report.json'), 'utf8'))
    const decision = { decisionId: 'b-reject-test', taskId: proposed.taskId, reviewId, action: 'reject' as const, operator: 'processing-test', reason: 'insufficient evidence for adoption', snapshotHash: report.snapshotHash as string }
    expect((await decideAssetTask(decision, data)).status).toBe('rejected')
    expect((await decideAssetTask(decision, data)).decision?.reason).toBe(decision.reason)
    await expect(readFile(path.join(data, 'registry', release.storyId, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(data, { recursive: true, force: true }) }
  // Two real six-view Blender runs also include GPU/shader initialization.
}, 120000)

it.skipIf(!existsSync(process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH))('integrates a passing B candidate only as a new unpromoted release', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-adopt-'))
  try {
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-adopt')
    const base = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const lineage = JSON.parse(await readFile(path.join(base.path, 'asset-lineage.json'), 'utf8'))
    const cargo = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
    const policy = await loadStrategyPolicy(path.resolve('.'))
    const proposed = await proposeAssetTask({ strategyId: 'blender-refine', storyId: base.storyId, releaseId: base.releaseId,
      assetId: cargo.assetId, expectedBaseSha256: cargo.sha256, issueIds: ['fixture-color'], repairGoal: 'test material candidate',
      parameters: { operation: 'material_tint', color: '#49748f' }, maxCostUsd: 0 }, 'blender-adopt', data, policy, false, true)
    const candidate = await executeBlenderRefine(proposed.taskId, data, path.resolve('.'))
    const taskDir = path.join(data, 'asset-tasks', proposed.taskId)
    const reviewId = `asset-review-${candidate.result!.reviewSnapshotHash!.slice(0, 20)}`
    const decision = { decisionId: 'b-adopt-fixture', action: 'adopt' as const, taskId: proposed.taskId,
      reviewId, snapshotHash: candidate.result!.reviewSnapshotHash!, operator: 'test', reason: 'synthetic pass for adoption mechanics' }
    await expect(adoptAssetTask(decision, data)).rejects.toThrow('ASSET_DECISION_REVIEW_REQUIRED')
    const reviewDir = path.join(taskDir, 'reviews', reviewId)
    await mkdir(reviewDir, { recursive: true })
    await writeFile(path.join(reviewDir, 'job.json'), JSON.stringify({ status: 'pass' }))
    await writeFile(path.join(reviewDir, 'report.json'), JSON.stringify({ scope: 'asset', decision: 'pass', snapshotHash: decision.snapshotHash,
      modelRecord: { requestedModel: 'deepseek-flash', requestId: 'synthetic-request' }, unassessed: [], coverage: [{ status: 'assessed' }] }))
    candidate.result!.reviewStatus = 'pass'
    await writeFile(path.join(taskDir, 'task.json'), JSON.stringify(candidate))
    const selectedPath = path.join(data, 'registry', base.storyId, 'selected-assets', 'asset-pack-bundle.json')
    await mkdir(path.dirname(selectedPath), { recursive: true })
    await writeFile(selectedPath, JSON.stringify({ baseSha256: cargo.sha256, candidateHash: '0'.repeat(64), decisionId: 'competing', releaseId: base.releaseId }))
    await expect(adoptAssetTask(decision, data)).rejects.toThrow('ASSET_REVISION_CONFLICT')
    await rm(selectedPath)
    const adopted = await adoptAssetTask(decision, data)
    expect(adopted.status).toBe('adopted')
    expect(adopted.decision?.releaseId).toMatch(/^release-[a-f0-9]{20}$/)
    expect((await adoptAssetTask(decision, data)).decision?.releaseId).toBe(adopted.decision?.releaseId)
    const next = path.join(data, 'releases', base.storyId, adopted.decision!.releaseId!)
    const nextLineage = JSON.parse(await readFile(path.join(next, 'asset-lineage.json'), 'utf8'))
    expect(nextLineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle').sha256).toBe(candidate.result!.outputSha256)
    expect(JSON.parse(await readFile(path.join(next, 'scene.json'), 'utf8')).sceneRevision).toBe(3)
    expect(JSON.parse(await readFile(path.join(next, 'release.json'), 'utf8')).qualityStatus).toBe('needs_review')
    await expect(readFile(path.join(data, 'registry', base.storyId, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const artifactPath = path.join(taskDir, candidate.result!.outputPath)
    await writeFile(artifactPath, Buffer.concat([await readFile(artifactPath), Buffer.from('tampered')]))
    await expect(adoptAssetTask(decision, data)).rejects.toThrow('ADOPTED_ASSET_CHANGED')
  } finally { await rm(data, { recursive: true, force: true }) }
}, 30000)
