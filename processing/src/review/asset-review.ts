import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReviewEvidenceBundle, ReviewReport } from '../../../contracts/src/handoff-types.ts'
import { buildAssetEvidence, REQUIRED_ASSET_VIEWS } from './evidence.ts'
import { reviewWithDeepSeek, ReviewOutputError, type ReviewCallOptions } from './deepseek.ts'
import { renderAsset, reviewCacheKey, type ReviewJob } from './orchestrator.ts'
import { DEFAULT_BLENDER_PATH } from '../strategies/registry.ts'
import type { AssetTaskRecord } from '../strategies/tasks.ts'
import { validateReviewOutput } from './validate.ts'

const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 2) + '\n'); await rename(tmp, file) }

export async function runAssetReview(taskId: string, dataDir: string, options: ReviewCallOptions & { blenderPath?: string } = {}): Promise<ReviewJob> {
  if (!/^task-[a-f0-9]{20}$/.test(taskId)) throw new Error('ASSET_TASK_ID_INVALID')
  const taskDir = path.join(dataDir, 'asset-tasks', taskId)
  const taskFile = path.join(taskDir, 'task.json')
  const task = await json<AssetTaskRecord>(taskFile)
  if (task.status !== 'candidate_ready' || !task.result) throw new Error('ASSET_REVIEW_CANDIDATE_MISSING')
  const candidatePath = path.join(taskDir, task.result.outputPath)
  const candidateBytes = await readFile(candidatePath)
  if (digest(candidateBytes) !== task.result.outputSha256) throw new Error('ASSET_REVIEW_STALE_CANDIDATE')
  const releaseDir = path.join(dataDir, 'releases', task.storyId, task.releaseId)
  const lineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string; path: string }> }>(path.join(releaseDir, 'asset-lineage.json'))
  const base = lineage.assets.find((item) => item.assetId === task.assetId)
  if (!base || base.sha256 !== task.result.inputSha256) throw new Error('ASSET_REVIEW_BASE_MISMATCH')
  const inputPath = path.join(releaseDir, base.path)
  if (digest(await readFile(inputPath)) !== base.sha256) throw new Error('ASSET_REVIEW_BASE_MISMATCH')
  const snapshotHash = assetReviewSnapshotHash(task)
  const reviewsRoot = path.join(taskDir, 'reviews')
  await mkdir(reviewsRoot, { recursive: true })
  if (!(options.apiKey ?? process.env.DEEPSEEK_API_KEY)) {
    const reviewId = `asset-review-${snapshotHash.slice(0, 20)}-unavailable`
    const job: ReviewJob = { reviewId, status: 'unavailable', reportPath: null, error: 'DEEPSEEK_API_KEY missing', attempts: 0 }
    await putJson(path.join(reviewsRoot, `${reviewId}.json`), job)
    return job
  }
  const stage = path.join(reviewsRoot, `.stage-${randomUUID()}`)
  const beforeDir = path.join(stage, 'before')
  const afterDir = path.join(stage, 'after')
  await mkdir(beforeDir, { recursive: true })
  await mkdir(afterDir, { recursive: true })
  let reviewId = `asset-review-${snapshotHash.slice(0, 20)}-evidence-error`
  let reviewDir = path.join(reviewsRoot, reviewId)
  let attempts = 0
  try {
    const blender = options.blenderPath ?? process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH
    await renderAsset(blender, inputPath, beforeDir)
    await renderAsset(blender, candidatePath, afterDir)
    const provenance = await json<{ inputImportId: string }>(path.join(releaseDir, 'provenance.json'))
    const evidence = await buildAssetEvidence({ scope: 'asset', assetId: task.assetId, assetRevision: base.adoptedRevision + 1, glbPath: candidatePath, imageDir: afterDir, planPath: path.join(dataDir, 'imports', provenance.inputImportId, 'source', 'plan.md'), storyPath: path.join(releaseDir, 'story.json'), sourcesPath: path.join(releaseDir, 'sources.json'), snapshotHash, rubricVersion: 'asset-v1' })
    const baseRef = `${task.assetId}@${base.adoptedRevision}:${base.sha256}`
    for (const viewId of REQUIRED_ASSET_VIEWS) {
      const image = await readFile(path.join(beforeDir, `${viewId}.png`))
      evidence.images.push({ viewId: `before-${viewId}`, subjectRef: baseRef, path: path.join(beforeDir, `${viewId}.png`), sha256: digest(image), camera: `blender-neutral-ortho-${viewId}-v1` })
    }
    evidence.coverage.push({ subjectRef: baseRef, views: REQUIRED_ASSET_VIEWS.map((item) => `before-${item}`), status: 'assessed' })
    evidence.metrics.push({ subjectRef: baseRef, name: 'beforeDimensionsM', value: JSON.stringify(task.result.beforeDimensionsM), unit: 'm' })
    evidence.metrics.push({ subjectRef: baseRef, name: 'afterDimensionsM', value: JSON.stringify(task.result.afterDimensionsM), unit: 'm' })
    const comparison = JSON.stringify({ repairGoal: task.request.repairGoal, strategy: task.strategyId, operation: task.request.parameters, inputHash: task.result.inputSha256, outputHash: task.result.outputSha256, tool: task.result.tool, toolVersion: task.result.toolVersion, costUsd: task.result.costUsd, adopted: false })
    evidence.texts.push({ refId: 'strategy-comparison', text: comparison, sha256: digest(comparison) })
    reviewId = `asset-review-${reviewCacheKey(evidence, 'deepseek-flash', 'history3d-asset-compare-v1').slice(0, 20)}`
    reviewDir = path.join(reviewsRoot, reviewId)
    const jobFile = path.join(reviewDir, 'job.json')
    try {
      const prior = await json<ReviewJob>(jobFile)
      attempts = prior.attempts
      if (!['failed', 'stale', 'unavailable'].includes(prior.status) || attempts >= 2) return prior
    } catch { /* new evidence key */ }
    await mkdir(reviewDir, { recursive: true })
    await rm(path.join(reviewDir, 'before'), { recursive: true, force: true })
    await rm(path.join(reviewDir, 'after'), { recursive: true, force: true })
    await rename(beforeDir, path.join(reviewDir, 'before'))
    await rename(afterDir, path.join(reviewDir, 'after'))
    for (const image of evidence.images) image.path = path.join(reviewDir, image.viewId.startsWith('before-') ? 'before' : 'after', `${image.viewId.replace(/^before-/, '')}.png`)
    await putJson(path.join(reviewDir, 'evidence.json'), evidence)
    const { report, responseBody } = await reviewWithDeepSeek(evidence, { ...options, promptVersion: 'history3d-asset-compare-v1' })
    report.reviewId = reviewId
    await putJson(path.join(reviewDir, 'response.json'), responseBody)
    await putJson(path.join(reviewDir, 'report.json'), report)
    const latest = await json<AssetTaskRecord>(taskFile)
    const stale = latest.result?.outputSha256 !== task.result.outputSha256 || latest.snapshotHash !== task.snapshotHash
    const job: ReviewJob = { reviewId, status: stale ? 'stale' : report.decision, reportPath: `asset-tasks/${taskId}/reviews/${reviewId}/report.json`, error: stale ? 'task snapshot changed before review returned' : null, attempts: attempts + 1 }
    await putJson(jobFile, job)
    if (!stale && latest.result) { latest.result.reviewStatus = report.decision; await putJson(taskFile, latest) }
    return job
  } catch (error) {
    await mkdir(reviewDir, { recursive: true })
    if (error instanceof ReviewOutputError) await putJson(path.join(reviewDir, `failed-response-${attempts + 1}.json`), error.responseBody)
    const job: ReviewJob = { reviewId, status: 'failed', reportPath: null, error: error instanceof Error ? error.message : String(error), attempts: attempts + 1 }
    await putJson(path.join(reviewDir, 'job.json'), job)
    const latest = await json<AssetTaskRecord>(taskFile)
    if (latest.result) { latest.result.reviewStatus = 'failed'; await putJson(taskFile, latest) }
    return job
  } finally { await rm(stage, { recursive: true, force: true }) }
}

export function assetReviewSnapshotHash(task: AssetTaskRecord): string {
  if (!task.result) throw new Error('ASSET_REVIEW_CANDIDATE_MISSING')
  const expected = digest(JSON.stringify([task.snapshotHash, task.result.inputSha256, task.result.outputSha256, task.request, 'asset-v1']))
  if (task.result.reviewSnapshotHash && task.result.reviewSnapshotHash !== expected) throw new Error('ASSET_REVIEW_SNAPSHOT_INVALID')
  return expected
}

export async function revalidateSavedAssetReview(taskId: string, reviewId: string, dataDir: string, attempt: number): Promise<ReviewJob> {
  if (!/^task-[a-f0-9]{20}$/.test(taskId) || !/^asset-review-[a-f0-9]{20}$/.test(reviewId) || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('INVALID_REVIEW_ID')
  const taskDir = path.join(dataDir, 'asset-tasks', taskId)
  const reviewDir = path.join(taskDir, 'reviews', reviewId)
  const evidence = await json<ReviewEvidenceBundle>(path.join(reviewDir, 'evidence.json'))
  const raw = await json<Record<string, unknown>>(path.join(reviewDir, `failed-response-${attempt}.json`))
  const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0]
  const message = choice?.message as { content?: unknown } | undefined
  if (choice?.finish_reason !== 'stop' || typeof message?.content !== 'string') throw new Error('REVIEW_OUTPUT_INVALID: saved response incomplete')
  const validated = validateReviewOutput(JSON.parse(message.content), evidence)
  const usage = raw.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const report: ReviewReport = {
    reviewId, scope: evidence.scope, snapshotHash: evidence.snapshotHash, rubricVersion: evidence.rubricVersion,
    modelRecord: { provider: 'deepseek-official', requestedModel: 'deepseek-flash', responseModel: typeof raw.model === 'string' ? raw.model : null, requestId: typeof raw.id === 'string' ? raw.id : null, promptVersion: 'history3d-asset-compare-v1', latencyMs: null, parameters: { maxTokens: 32768, temperature: 0 }, tokens: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : null },
    coverage: evidence.coverage, ...validated,
  }
  report.normalizationNotes.push(`Revalidated saved response from attempt ${attempt}; original latency unavailable`)
  await putJson(path.join(reviewDir, 'report.json'), report)
  const taskFile = path.join(taskDir, 'task.json')
  const task = await json<AssetTaskRecord>(taskFile)
  const stale = assetReviewSnapshotHash(task) !== evidence.snapshotHash
  const job: ReviewJob = { reviewId, status: stale ? 'stale' : report.decision, reportPath: `asset-tasks/${taskId}/reviews/${reviewId}/report.json`, error: stale ? 'task snapshot changed since review input' : null, attempts: attempt }
  await putJson(path.join(reviewDir, 'job.json'), job)
  if (!stale && task.result) { task.result.reviewStatus = report.decision; await putJson(taskFile, task) }
  return job
}
