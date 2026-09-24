import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CollectionAsset, HandoffManifest, ProcessingFeedback, ReviewEvidenceBundle, ReviewReport } from '../../../contracts/src/handoff-types.ts'
import { buildAssetEvidence } from './evidence.ts'
import { reviewWithDeepSeek, ReviewOutputError, REVIEW_MAX_TOKENS, type ReviewCallOptions } from './deepseek.ts'
import { validateReviewOutput } from './validate.ts'

const fileJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const writeJson = async (file: string, value: unknown): Promise<void> => { const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, file) }

export interface ReviewJob { reviewId: string; status: 'pass' | 'needs_revision' | 'needs_information' | 'inconclusive' | 'failed' | 'stale' | 'unavailable'; reportPath: string | null; error: string | null; attempts: number }

export async function runInputReview(importId: string, dataDir: string, options: ReviewCallOptions & { blenderPath?: string } = {}): Promise<ReviewJob[]> {
  if (!/^import-[a-f0-9]{20}$/.test(importId)) throw new Error('INVALID_IMPORT_ID')
  const root = path.join(dataDir, 'imports', importId)
  const sourceDir = path.join(root, 'source')
  const receipt = await fileJson<{ snapshotHash: string }>(path.join(root, 'receipt.json'))
  const handoff = await fileJson<HandoffManifest>(path.join(sourceDir, 'handoff.json'))
  const manifest = await fileJson<{ assets: CollectionAsset[] }>(path.join(sourceDir, 'assets', 'asset-manifest.json'))
  const reviewsDir = path.join(root, 'reviews')
  await mkdir(reviewsDir, { recursive: true })
  const jobs: ReviewJob[] = []
  for (const asset of manifest.assets) {
    const reviewId = `review-${receipt.snapshotHash.slice(0, 20)}-${asset.assetId}`
    const dir = path.join(reviewsDir, reviewId)
    await mkdir(dir, { recursive: true })
    const jobFile = path.join(dir, 'job.json')
    let attempts = 0
    try {
      const prior = await fileJson<ReviewJob>(jobFile)
      attempts = prior.attempts ?? 1
      if (prior.status !== 'failed' && prior.status !== 'stale' && prior.status !== 'unavailable') { jobs.push(prior); continue }
      if (attempts >= 2) { jobs.push(prior); continue }
    } catch { /* first attempt */ }
    if (!(options.apiKey ?? process.env.DEEPSEEK_API_KEY)) {
      const job: ReviewJob = { reviewId, status: 'unavailable', reportPath: null, error: 'DEEPSEEK_API_KEY missing', attempts }
      await writeJson(jobFile, job)
      jobs.push(job)
      continue
    }
    try {
      const imageDir = path.join(dir, 'views')
      await mkdir(imageDir, { recursive: true })
      await renderAsset(options.blenderPath ?? process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', path.join(sourceDir, asset.path), imageDir)
      const evidence = await buildAssetEvidence({ scope: 'input', assetId: asset.assetId, assetRevision: asset.assetRevision, glbPath: path.join(sourceDir, asset.path), imageDir, planPath: path.join(sourceDir, 'plan.md'), storyPath: path.join(sourceDir, 'story.json'), sourcesPath: path.join(sourceDir, 'sources.json'), snapshotHash: receipt.snapshotHash, rubricVersion: 'input-v1' })
      await writeJson(path.join(dir, 'evidence.json'), evidence)
      const { report, responseBody } = await reviewWithDeepSeek(evidence, options)
      report.reviewId = reviewId
      await writeJson(path.join(dir, 'response.json'), responseBody)
      const current = await fileJson<{ snapshotHash: string }>(path.join(root, 'receipt.json'))
      const job: ReviewJob = current.snapshotHash === evidence.snapshotHash
        ? { reviewId, status: report.decision, reportPath: `reviews/${reviewId}/report.json`, error: null, attempts: attempts + 1 }
        : { reviewId, status: 'stale', reportPath: `reviews/${reviewId}/report.json`, error: 'snapshot changed before result was applied', attempts: attempts + 1 }
      await writeJson(path.join(dir, 'report.json'), report)
      await writeJson(jobFile, job)
      if (job.status !== 'stale') await attachReport(root, report, handoff)
      jobs.push(job)
    } catch (error) {
      if (error instanceof ReviewOutputError) await writeJson(path.join(dir, `failed-response-${attempts + 1}.json`), error.responseBody)
      const job: ReviewJob = { reviewId, status: 'failed', reportPath: null, error: error instanceof Error ? error.message : String(error), attempts: attempts + 1 }
      await writeJson(jobFile, job)
      jobs.push(job)
    }
  }
  return jobs
}

export async function renderAsset(blenderPath: string, glbPath: string, outputDir: string): Promise<void> {
  const script = path.resolve('processing/tools/render_asset.py')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(blenderPath, ['-b', '-t', '2', '--python', script, '--', glbPath, outputDir], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`REVIEW_RENDER_FAILED: Blender exit ${code}`)))
  })
}

async function attachReport(root: string, report: ReviewReport, handoff: HandoffManifest): Promise<void> {
  const feedbackFile = path.join(root, 'feedback', 'feedback.json')
  const feedback = await fileJson<ProcessingFeedback>(feedbackFile)
  if (feedback.basedOnSnapshotHash !== report.snapshotHash || feedback.submissionId !== handoff.submissionId) return
  const ref = `reviews/${report.reviewId}/report.json`
  if (!feedback.reviewRefs.includes(ref)) feedback.reviewRefs.push(ref)
  feedback.summary += `；DeepSeek 输入审核 ${report.decision}，${report.findings.length} 条建议待 B 裁定`
  await writeJson(feedbackFile, feedback)
}

export function reviewCacheKey(evidence: ReviewEvidenceBundle, model = 'deepseek-flash', promptVersion = 'history3d-review-v1'): string {
  return hash(JSON.stringify({ model, promptVersion, maxTokens: REVIEW_MAX_TOKENS, temperature: 0, scope: evidence.scope, snapshot: evidence.snapshotHash, rubric: evidence.rubricVersion, images: evidence.images.map((item) => item.sha256), texts: evidence.texts.map((item) => item.sha256), metrics: evidence.metrics }))
}

export async function revalidateSavedInputReview(importId: string, assetId: string, dataDir: string, attempt: number): Promise<ReviewJob> {
  if (!/^import-[a-f0-9]{20}$/.test(importId) || !/^[a-zA-Z0-9_-]+$/.test(assetId) || !Number.isInteger(attempt) || attempt < 1) throw new Error('INVALID_REVIEW_ID')
  const root = path.join(dataDir, 'imports', importId)
  const reviewId = `review-${(await fileJson<{ snapshotHash: string }>(path.join(root, 'receipt.json'))).snapshotHash.slice(0, 20)}-${assetId}`
  const dir = path.join(root, 'reviews', reviewId)
  const evidence = await fileJson<ReviewEvidenceBundle>(path.join(dir, 'evidence.json'))
  const raw = await fileJson<Record<string, unknown>>(path.join(dir, `failed-response-${attempt}.json`))
  const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0]
  const message = choice?.message as { content?: unknown } | undefined
  if (choice?.finish_reason !== 'stop' || typeof message?.content !== 'string') throw new Error('REVIEW_OUTPUT_INVALID: saved response incomplete')
  const parsed = JSON.parse(message.content) as unknown
  const validated = validateReviewOutput(parsed, evidence)
  const current = await fileJson<{ snapshotHash: string }>(path.join(root, 'receipt.json'))
  const usage = raw.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const report: ReviewReport = {
    reviewId, scope: evidence.scope, snapshotHash: evidence.snapshotHash, rubricVersion: evidence.rubricVersion,
    modelRecord: { provider: 'deepseek-official', requestedModel: 'deepseek-flash', responseModel: typeof raw.model === 'string' ? raw.model : null, requestId: typeof raw.id === 'string' ? raw.id : null, promptVersion: 'history3d-review-v1', latencyMs: null, tokens: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : null },
    coverage: evidence.coverage, ...validated,
  }
  report.normalizationNotes.push(`Revalidated saved response from attempt ${attempt}; original latency unavailable`)
  await writeJson(path.join(dir, 'report.json'), report)
  const job: ReviewJob = { reviewId, status: current.snapshotHash === evidence.snapshotHash ? report.decision : 'stale', reportPath: `reviews/${reviewId}/report.json`, error: null, attempts: attempt }
  await writeJson(path.join(dir, 'job.json'), job)
  if (job.status !== 'stale') await attachReport(root, report, await fileJson<HandoffManifest>(path.join(root, 'source', 'handoff.json')))
  return job
}
