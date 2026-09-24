import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { StrategyPolicy } from '../../../contracts/src/handoff-types.ts'
import { listStrategies } from './registry.ts'

export interface AssetTaskRequest {
  strategyId: string; storyId: string; releaseId: string; assetId: string
  expectedBaseSha256: string; issueIds: string[]; repairGoal: string
  parameters: Record<string, unknown>; maxCostUsd: number
}
export interface AssetTaskRecord {
  taskId: string; status: 'needs_budget' | 'needs_quote' | 'unavailable' | 'needs_review'
  strategyId: string; storyId: string; releaseId: string; assetId: string
  snapshotHash: string; reason: string; maxCostUsd: number; estimatedCostUsd: null
  attemptCount: 0; artifactRefs: []; policy: StrategyPolicy; request: AssetTaskRequest
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 2) + '\n'); await rename(tmp, file) }

export async function proposeAssetTask(request: AssetTaskRequest, idempotencyKey: string, dataDir: string, policy: StrategyPolicy, hasTripoKey: boolean): Promise<AssetTaskRecord> {
  if (!idempotencyKey || idempotencyKey.length > 200 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.storyId) || !/^release-[a-f0-9]{20}$/.test(request.releaseId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(request.assetId) || !/^[a-f0-9]{64}$/.test(request.expectedBaseSha256) || !request.repairGoal?.trim() || !Array.isArray(request.issueIds) || request.issueIds.some((id) => typeof id !== 'string') || !request.parameters || typeof request.parameters !== 'object' || !Number.isFinite(request.maxCostUsd) || request.maxCostUsd < 0) throw new Error('ASSET_TASK_INVALID')
  const bodyHash = digest(JSON.stringify(request))
  const taskId = `task-${bodyHash.slice(0, 20)}`
  const keyPath = path.join(dataDir, 'asset-task-keys', `${digest(idempotencyKey)}.json`)
  try {
    const prior = await json<{ bodyHash: string; taskId: string }>(keyPath)
    if (prior.bodyHash !== bodyHash) throw new Error('ASSET_TASK_IDEMPOTENCY_CONFLICT')
    return json<AssetTaskRecord>(path.join(dataDir, 'asset-tasks', prior.taskId, 'task.json'))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const releaseDir = path.join(dataDir, 'releases', request.storyId, request.releaseId)
  const release = await json<{ files: Array<{ path: string; sha256: string }> }>(path.join(releaseDir, 'release.json'))
  const lineage = await json<{ assets: Array<{ assetId: string; sha256: string }> }>(path.join(releaseDir, 'asset-lineage.json'))
  if (!lineage.assets.some((item) => item.assetId === request.assetId && item.sha256 === request.expectedBaseSha256)) throw new Error('ASSET_REVISION_CONFLICT')
  const strategy = listStrategies(policy, hasTripoKey).find((item) => item.id === request.strategyId)
  if (!strategy) throw new Error('STRATEGY_UNKNOWN')
  const paid = strategy.kind === 'generate' || strategy.kind === 'prompt-compare'
  const status: AssetTaskRecord['status'] = paid && (policy.maxCostUsd === 0 || policy.maxPaidAttempts === 0 || request.maxCostUsd > policy.maxCostUsd) ? 'needs_budget'
    : !strategy.available ? 'unavailable' : paid ? 'needs_quote' : 'needs_review'
  const reason = status === 'needs_budget' ? 'paid generation is outside the configured budget'
    : status === 'needs_quote' ? 'provider price must be verified before a paid submission'
      : status === 'unavailable' ? strategy.reason ?? 'strategy unavailable'
        : 'local strategy proposal is saved; no asset has been modified or adopted'
  const record: AssetTaskRecord = { taskId, status, strategyId: strategy.id, storyId: request.storyId, releaseId: request.releaseId, assetId: request.assetId, snapshotHash: digest(JSON.stringify(release.files)), reason, maxCostUsd: request.maxCostUsd, estimatedCostUsd: null, attemptCount: 0, artifactRefs: [], policy: structuredClone(policy), request }
  await putJson(path.join(dataDir, 'asset-tasks', taskId, 'task.json'), record)
  await putJson(keyPath, { bodyHash, taskId })
  return record
}
