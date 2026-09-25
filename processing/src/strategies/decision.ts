import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReviewReport } from '../../../contracts/src/handoff-types.ts'
import type { AssetTaskRecord } from './tasks.ts'

export interface AssetTaskDecisionInput { decisionId: string; taskId: string; reviewId: string; action: 'reject'; operator: string; reason: string; snapshotHash: string }
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const putJson = async (file: string, value: unknown): Promise<void> => { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file) }

export async function decideAssetTask(input: AssetTaskDecisionInput, dataDir: string): Promise<AssetTaskRecord> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.decisionId) || !/^task-[a-f0-9]{20}$/.test(input.taskId) || !/^asset-review-[a-f0-9]{20}$/.test(input.reviewId) || input.action !== 'reject' || !input.operator?.trim() || !input.reason?.trim() || !/^[a-f0-9]{64}$/.test(input.snapshotHash)) throw new Error('ASSET_DECISION_INVALID')
  const taskDir = path.join(dataDir, 'asset-tasks', input.taskId)
  const taskFile = path.join(taskDir, 'task.json')
  const decisionFile = path.join(taskDir, 'decision.json')
  const hash = digest(JSON.stringify(input))
  try {
    const prior = await json<{ hash: string }>(decisionFile)
    if (prior.hash !== hash) throw new Error('ASSET_DECISION_CONFLICT')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const task = await json<AssetTaskRecord>(taskFile)
  if (task.status === 'rejected' && task.decision?.decisionId === input.decisionId && task.decision.snapshotHash === input.snapshotHash) return task
  if (task.status !== 'candidate_ready' || !task.result || task.result.reviewStatus === 'pending' || task.result.reviewStatus === 'failed') throw new Error('ASSET_DECISION_REVIEW_REQUIRED')
  const report = await json<ReviewReport>(path.join(taskDir, 'reviews', input.reviewId, 'report.json'))
  if (report.scope !== 'asset' || report.snapshotHash !== input.snapshotHash || report.decision !== task.result.reviewStatus) throw new Error('ASSET_DECISION_SNAPSHOT_MISMATCH')
  const artifact = await readFile(path.join(taskDir, task.result.outputPath))
  if (createHash('sha256').update(artifact).digest('hex') !== task.result.outputSha256) throw new Error('ASSET_TASK_ARTIFACT_MISMATCH')
  task.status = 'rejected'
  task.reason = `B rejected candidate: ${input.reason}`
  task.decision = { decisionId: input.decisionId, action: 'reject', operator: input.operator, reason: input.reason, reviewId: input.reviewId, snapshotHash: input.snapshotHash }
  await putJson(decisionFile, { hash, decision: input })
  await putJson(taskFile, task)
  return task
}
