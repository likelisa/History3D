import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReviewEvidenceBundle, ReviewReport } from '../../../contracts/src/handoff-types.ts'
import { buildWorldEvidence } from './evidence.ts'
import { reviewWithDeepSeek, ReviewOutputError, type ReviewCallOptions } from './deepseek.ts'
import { reviewCacheKey, type ReviewJob } from './orchestrator.ts'
import { validateReviewOutput } from './validate.ts'

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file) }
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export async function runWorldReview(storyId: string, releaseId: string, planPath: string, dataDir: string, options: ReviewCallOptions & { blenderPath?: string } = {}): Promise<ReviewJob> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId)) throw new Error('INVALID_RELEASE_ID')
  const releaseDir = path.join(dataDir, 'releases', storyId, releaseId)
  const releaseBytes = await readFile(path.join(releaseDir, 'release.json'))
  const release = JSON.parse(releaseBytes.toString('utf8')) as { storyId: string; releaseId: string; files: Array<{ path: string; sha256: string; bytes: number }> }
  if (release.storyId !== storyId || release.releaseId !== releaseId) throw new Error('RELEASE_ID_MISMATCH')
  for (const file of release.files) {
    if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('UNSAFE_RELEASE_PATH')
    const bytes = await readFile(path.join(releaseDir, file.path))
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`RELEASE_HASH_MISMATCH: ${file.path}`)
  }
  const snapshotHash = sha(releaseBytes)
  const baseDir = path.join(dataDir, 'world-reviews', storyId, releaseId)
  await mkdir(baseDir, { recursive: true })
  if (!(options.apiKey ?? process.env.DEEPSEEK_API_KEY)) {
    const reviewId = `world-review-${snapshotHash.slice(0, 20)}-unavailable`
    const job: ReviewJob = { reviewId, status: 'unavailable', reportPath: null, error: 'DEEPSEEK_API_KEY missing', attempts: 0 }
    await putJson(path.join(baseDir, `${reviewId}.json`), job)
    return job
  }
  const stageDir = path.join(baseDir, `.evidence-${randomUUID()}.tmp`)
  const imageDir = path.join(stageDir, 'views')
  await mkdir(imageDir, { recursive: true })
  let reviewId = `world-review-${snapshotHash.slice(0, 20)}-evidence-error`
  let reviewDir = path.join(baseDir, reviewId)
  let attempts = 0
  try {
    await renderWorld(options.blenderPath ?? process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender', releaseDir, imageDir)
    const provenance = await readJson<{ inputImportId: string }>(path.join(releaseDir, 'provenance.json'))
    const originalPlanPath = path.join(dataDir, 'imports', provenance.inputImportId, 'source', 'plan.md')
    const [sceneText, storyText, sourcesText, qualityText, worldPlanText, originalPlanText] = await Promise.all([
      readFile(path.join(releaseDir, 'scene.json'), 'utf8'), readFile(path.join(releaseDir, 'story.json'), 'utf8'), readFile(path.join(releaseDir, 'sources.json'), 'utf8'), readFile(path.join(releaseDir, 'quality-report.json'), 'utf8'), readFile(planPath, 'utf8'), readFile(originalPlanPath, 'utf8'),
    ])
    const scene = JSON.parse(sceneText) as { objects: unknown[]; assets: unknown[] }
    const quality = JSON.parse(qualityText) as { relationChecks: Array<{ pass: boolean }> }
    const subjectRef = `world:${releaseId}`
    const evidence: ReviewEvidenceBundle = await buildWorldEvidence({
      scope: 'world', snapshotHash, rubricVersion: 'world-v1', subjectRef,
      images: ['overview', 'main', 'human-scale'].map((viewId) => ({ viewId, subjectRef, path: path.join(imageDir, `${viewId}.png`), camera: `blender-offline-${viewId}-v1` })),
      texts: [
        { refId: 'scene.json', text: sceneText }, { refId: 'story.json', text: storyText }, { refId: 'sources.json', text: sourcesText },
        { refId: 'world-plan.json', text: worldPlanText }, { refId: 'plan.md', text: originalPlanText }, { refId: 'quality-report.json', text: qualityText },
        { refId: 'coverage-limitations', text: 'Only three offline Blender stills supplied. Formal viewer screenshots, three story beat frames, motion continuity, audio and performance are not supplied; mark them unassessed.' },
      ],
      metrics: [
        { subjectRef, name: 'objectCount', value: scene.objects.length, unit: 'count' },
        { subjectRef, name: 'assetCount', value: scene.assets.length, unit: 'count' },
        { subjectRef, name: 'attachmentChecksPassed', value: quality.relationChecks.filter((item) => item.pass).length, unit: 'count' },
      ],
      requiredViewIds: ['overview', 'main', 'human-scale', 'formal-viewer-main', 'beat-1', 'beat-2', 'beat-3'],
    })
    reviewId = `world-review-${reviewCacheKey(evidence).slice(0, 20)}`
    reviewDir = path.join(baseDir, reviewId)
    const jobFile = path.join(reviewDir, 'job.json')
    try {
      const prior = await readJson<ReviewJob>(jobFile)
      attempts = prior.attempts
      if (!['failed', 'stale', 'unavailable'].includes(prior.status) || attempts >= 2) { await rm(stageDir, { recursive: true, force: true }); return prior }
    } catch { /* new evidence key */ }
    await mkdir(reviewDir, { recursive: true })
    const finalImageDir = path.join(reviewDir, 'views')
    await rm(finalImageDir, { recursive: true, force: true })
    await rename(imageDir, finalImageDir)
    for (const image of evidence.images) image.path = path.join(finalImageDir, path.basename(image.path))
    await rm(stageDir, { recursive: true, force: true })
    await putJson(path.join(reviewDir, 'evidence.json'), evidence)
    const { report, responseBody } = await reviewWithDeepSeek(evidence, options)
    report.reviewId = reviewId
    await putJson(path.join(reviewDir, 'response.json'), responseBody)
    await putJson(path.join(reviewDir, 'report.json'), report)
    const currentHash = sha(await readFile(path.join(releaseDir, 'release.json')))
    const job: ReviewJob = { reviewId, status: currentHash === snapshotHash ? report.decision : 'stale', reportPath: `world-reviews/${storyId}/${releaseId}/${reviewId}/report.json`, error: currentHash === snapshotHash ? null : 'release manifest changed while reviewing', attempts: attempts + 1 }
    await putJson(jobFile, job)
    return job
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true })
    await mkdir(reviewDir, { recursive: true })
    if (error instanceof ReviewOutputError) await putJson(path.join(reviewDir, `failed-response-${attempts + 1}.json`), error.responseBody)
    const job: ReviewJob = { reviewId, status: 'failed', reportPath: null, error: error instanceof Error ? error.message : String(error), attempts: attempts + 1 }
    await putJson(path.join(reviewDir, 'job.json'), job)
    return job
  }
}

async function renderWorld(blenderPath: string, releaseDir: string, imageDir: string): Promise<void> {
  const script = path.resolve('processing/tools/render_world.py')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(blenderPath, ['-b', '-t', '2', '--python', script, '--', releaseDir, imageDir], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`REVIEW_RENDER_FAILED: Blender exit ${code}`)))
  })
}

export async function revalidateSavedWorldReview(storyId: string, releaseId: string, reviewId: string, dataDir: string, attempt: number): Promise<ReviewJob> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId) || !/^world-review-[a-f0-9]{20}$/.test(reviewId) || !Number.isInteger(attempt) || attempt < 1) throw new Error('INVALID_REVIEW_ID')
  const dir = path.join(dataDir, 'world-reviews', storyId, releaseId, reviewId)
  const evidence = await readJson<ReviewEvidenceBundle>(path.join(dir, 'evidence.json'))
  const raw = await readJson<Record<string, unknown>>(path.join(dir, `failed-response-${attempt}.json`))
  const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0]
  const message = choice?.message as { content?: unknown } | undefined
  if (choice?.finish_reason !== 'stop' || typeof message?.content !== 'string') throw new Error('REVIEW_OUTPUT_INVALID: saved response incomplete')
  const validated = validateReviewOutput(JSON.parse(message.content), evidence)
  const usage = raw.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const report: ReviewReport = {
    reviewId, scope: evidence.scope, snapshotHash: evidence.snapshotHash, rubricVersion: evidence.rubricVersion,
    modelRecord: { provider: 'deepseek-official', requestedModel: 'deepseek-flash', responseModel: typeof raw.model === 'string' ? raw.model : null, requestId: typeof raw.id === 'string' ? raw.id : null, promptVersion: 'history3d-review-v1', latencyMs: null, parameters: { maxTokens: 32768, temperature: 0 }, tokens: usage ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } : null },
    coverage: evidence.coverage, ...validated,
  }
  report.normalizationNotes.push(`Revalidated saved response from attempt ${attempt}; original latency unavailable`)
  const currentHash = sha(await readFile(path.join(dataDir, 'releases', storyId, releaseId, 'release.json')))
  const status = currentHash === evidence.snapshotHash ? report.decision : 'stale'
  await putJson(path.join(dir, 'report.json'), report)
  const job: ReviewJob = { reviewId, status, reportPath: `world-reviews/${storyId}/${releaseId}/${reviewId}/report.json`, error: status === 'stale' ? 'release manifest changed since review input' : null, attempts: attempt }
  await putJson(path.join(dir, 'job.json'), job)
  return job
}
