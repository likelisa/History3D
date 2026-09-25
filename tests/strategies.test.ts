import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { listStrategies, loadStrategyPolicy } from '../processing/src/strategies/registry.ts'
import { proposeAssetTask } from '../processing/src/strategies/tasks.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('strategy policy and tasks', () => {
  it('persists a zero-spend generation proposal without contacting a provider', async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'history3d-strategy-'))
    roots.push(data)
    const policy = await loadStrategyPolicy(path.resolve('.'))
    expect(policy.maxCostUsd).toBe(0)
    expect(listStrategies(policy, false).find((item) => item.id === 'generate-3d')?.available).toBe(false)
    const imported = await importCollection(path.resolve('contracts/fixtures/handoff/collection'), data, 'fu-strategy')
    const release = await buildWorldRelease(imported.importId, path.resolve('processing/fixtures/silk-road-world-plan.json'), data, path.resolve('.'))
    const lineage = JSON.parse(await readFile(path.join(release.path, 'asset-lineage.json'), 'utf8'))
    const cargo = lineage.assets.find((item: { assetId: string }) => item.assetId === 'asset-pack-bundle')
    const request = { strategyId: 'generate-3d', storyId: release.storyId, releaseId: release.releaseId, assetId: 'asset-pack-bundle', expectedBaseSha256: cargo.sha256 as string, issueIds: ['issue-example'], repairGoal: 'replace missing fastening details', parameters: { promptVersion: 'v1' }, maxCostUsd: 1 }
    const task = await proposeAssetTask(request, 'cost-key', data, policy, false)
    expect(task.status).toBe('needs_budget')
    expect(task.attemptCount).toBe(0)
    expect(task.artifactRefs).toEqual([])
    expect((await proposeAssetTask(request, 'cost-key', data, policy, false)).taskId).toBe(task.taskId)
    await expect(proposeAssetTask({ ...request, repairGoal: 'different goal' }, 'cost-key', data, policy, false)).rejects.toThrow('ASSET_TASK_IDEMPOTENCY_CONFLICT')
    const local = await proposeAssetTask({ ...request, strategyId: 'scene-recompose', maxCostUsd: 0 }, 'local-key', data, policy, false)
    expect(local.status).toBe('needs_review')
  })
})
