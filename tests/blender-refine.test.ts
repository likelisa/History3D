import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

it.skipIf(!existsSync(DEFAULT_BLENDER_PATH))('returns an unchanged-geometry Blender material candidate without adoption', async () => {
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
    expect(reviewedJob.status).toBe('complete')
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
}, 30000)
