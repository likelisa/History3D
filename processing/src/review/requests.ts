import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetTaskRecord } from '../strategies/tasks.ts'
import { assetReviewSnapshotHash, runAssetReview } from './asset-review.ts'
import { runInputReview, type ReviewJob } from './orchestrator.ts'
import { runWorldReview } from './world-review.ts'
import type { ReviewCallOptions } from './deepseek.ts'

export type ReviewRequestInput =
  | { scope: 'input'; importId: string; snapshotHash: string; rubricVersion: 'input-v1' }
  | { scope: 'asset'; taskId: string; snapshotHash: string; rubricVersion: 'asset-v1' }
  | { scope: 'world'; storyId: string; releaseId: string; snapshotHash: string; rubricVersion: 'world-v1' }

export interface ReviewRequestRecord {
  jobId: string; request: ReviewRequestInput; status: 'received' | 'processing' | 'complete' | 'failed'
  reviewRefs: Array<{ reviewId: string; status: ReviewJob['status']; reportUrl: string | null }>
  diagnostics: string[]; createdAt: string; updatedAt: string
}

const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file) }
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value)
export const reviewRequestPath = (dataDir: string, jobId: string): string => path.join(dataDir, 'review-requests', `${jobId}.json`)

export async function createReviewRequest(input: ReviewRequestInput, dataDir: string): Promise<ReviewRequestRecord> {
  if (!input || !validHash(input.snapshotHash)) throw new Error('REVIEW_REQUEST_INVALID')
  if (input.scope === 'input') {
    if (!/^import-[a-f0-9]{20}$/.test(input.importId) || input.rubricVersion !== 'input-v1') throw new Error('REVIEW_REQUEST_INVALID')
    const receipt = await json<{ snapshotHash: string }>(path.join(dataDir, 'imports', input.importId, 'receipt.json'))
    if (receipt.snapshotHash !== input.snapshotHash) throw new Error('REVIEW_STALE')
  } else if (input.scope === 'asset') {
    if (!/^task-[a-f0-9]{20}$/.test(input.taskId) || input.rubricVersion !== 'asset-v1') throw new Error('REVIEW_REQUEST_INVALID')
    const task = await json<AssetTaskRecord>(path.join(dataDir, 'asset-tasks', input.taskId, 'task.json'))
    if (task.status !== 'candidate_ready' || assetReviewSnapshotHash(task) !== input.snapshotHash) throw new Error('REVIEW_STALE')
  } else if (input.scope === 'world') {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.storyId) || !/^release-[a-f0-9]{20}$/.test(input.releaseId) || input.rubricVersion !== 'world-v1') throw new Error('REVIEW_REQUEST_INVALID')
    const releaseDir = path.join(dataDir, 'releases', input.storyId, input.releaseId)
    if (digest(await readFile(path.join(releaseDir, 'release.json'))) !== input.snapshotHash) throw new Error('REVIEW_STALE')
    await readFile(path.join(releaseDir, 'world-plan.json'))
  } else throw new Error('REVIEW_REQUEST_INVALID')
  const jobId = `job-review-${digest(JSON.stringify(input)).slice(0, 20)}`
  try { return await json<ReviewRequestRecord>(reviewRequestPath(dataDir, jobId)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const now = new Date().toISOString()
  const record: ReviewRequestRecord = { jobId, request: input, status: 'received', reviewRefs: [], diagnostics: [], createdAt: now, updatedAt: now }
  await putJson(reviewRequestPath(dataDir, jobId), record)
  return record
}

export async function processReviewRequest(jobId: string, dataDir: string, options: ReviewCallOptions = {}): Promise<ReviewRequestRecord> {
  if (!/^job-review-[a-f0-9]{20}$/.test(jobId)) throw new Error('REVIEW_JOB_ID_INVALID')
  const file = reviewRequestPath(dataDir, jobId)
  const record = await json<ReviewRequestRecord>(file)
  if (record.status === 'complete') return record
  record.status = 'processing'
  record.updatedAt = new Date().toISOString()
  await putJson(file, record)
  try {
    let reviews: ReviewJob[]
    let reportPrefix: string
    if (record.request.scope === 'input') {
      reviews = await runInputReview(record.request.importId, dataDir, options)
      reportPrefix = `imports/${record.request.importId}/`
    } else if (record.request.scope === 'asset') {
      reviews = [await runAssetReview(record.request.taskId, dataDir, options)]
      reportPrefix = ''
    } else {
      reviews = [await runWorldReview(record.request.storyId, record.request.releaseId, null, dataDir, options)]
      reportPrefix = ''
    }
    record.reviewRefs = reviews.map((review) => ({ reviewId: review.reviewId, status: review.status, reportUrl: review.reportPath ? `/api/processing/v1/reviews/${review.reviewId}` : null }))
    record.diagnostics = reviews.flatMap((review) => review.error ? [`${review.reviewId}: ${review.error}`] : [])
    record.status = reviews.some((review) => ['failed', 'call_unknown', 'unavailable', 'stale'].includes(review.status)) ? 'failed' : 'complete'
    for (const review of reviews) {
      if (!review.reportPath) continue
      const reportPath = `${reportPrefix}${review.reportPath}`
      await putJson(path.join(dataDir, 'review-index', `${review.reviewId}.json`), { reviewId: review.reviewId, status: review.status, reportPath, jobId })
    }
  } catch (error) {
    record.status = 'failed'
    record.diagnostics = [error instanceof Error ? error.message : String(error)]
  }
  record.updatedAt = new Date().toISOString()
  await putJson(file, record)
  return record
}

export async function getReviewReport(reviewId: string, dataDir: string): Promise<unknown> {
  if (!/^(review-|asset-review-|world-review-)[A-Za-z0-9._-]{8,100}$/.test(reviewId)) throw new Error('REVIEW_ID_INVALID')
  const index = await json<{ reportPath: string }>(path.join(dataDir, 'review-index', `${reviewId}.json`))
  if (!index.reportPath || path.isAbsolute(index.reportPath) || index.reportPath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('REVIEW_INDEX_INVALID')
  return json(path.join(dataDir, index.reportPath))
}
