import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { storeBundle } from './bundles.ts'
import { submitWorldFeedback, type WorldFeedback } from './feedback.ts'
import { ImportError, importCollection } from './intake.ts'
import { runInputReview } from './review/orchestrator.ts'

const PREFIX = '/api/processing/v1'
const MAX_JSON = 1_000_000
const MAX_UPLOAD = 257 * 1024 * 1024
type JobStatus = 'processing' | 'needs_input' | 'needs_review' | 'failed'
export interface JobRecord { jobId: string; importId: string; status: JobStatus; stage: string; progress: number; diagnostics: string[]; feedbackUrl: string; updatedAt: string }
export interface ServerOptions { dataDir: string; port?: number; host?: string; reviewApiKey?: string }

function respond(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}
function apiError(res: ServerResponse, status: number, code: string, message: string, stage = 'http'): void {
  respond(res, status, { code, message, stage, subjectRef: null, fieldPath: null, retryable: status >= 500, expectedAction: null, artifactRefs: [] })
}
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, file) }
const safeSegment = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
const safeRelPath = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.split('/').some((part) => !part || part === '.' || part === '..')

async function body(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw Object.assign(new Error('request body too large'), { status: 413, code: 'PACKAGE_TOO_LARGE' })
    chunks.push(part)
  }
  return Buffer.concat(chunks)
}

async function jsonBody<T>(req: IncomingMessage): Promise<T> {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw Object.assign(new Error('Content-Type must be application/json'), { status: 400, code: 'CONTENT_TYPE_INVALID' })
  try { return JSON.parse((await body(req, MAX_JSON)).toString('utf8')) as T }
  catch (error) { if ((error as { status?: number }).status) throw error; throw Object.assign(new Error('invalid JSON body'), { status: 400, code: 'JSON_INVALID' }) }
}

export function createProcessingServer(options: ServerOptions): Server {
  const dataDir = path.resolve(options.dataDir)
  const runningJobs = new Set<string>()
  let importQueue: Promise<unknown> = Promise.resolve()
  const serializeImport = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = importQueue.then(operation, operation)
    importQueue = next.then(() => undefined, () => undefined)
    return next
  }
  const jobPath = (jobId: string) => path.join(dataDir, 'jobs', `${jobId}.json`)
  const progressReview = async (jobId: string): Promise<void> => {
    if (runningJobs.has(jobId)) return
    runningJobs.add(jobId)
    try {
      const job = await readJson<JobRecord>(jobPath(jobId))
      if (job.status !== 'processing') return
      const reviews = await runInputReview(job.importId, dataDir, options.reviewApiKey === undefined ? {} : { apiKey: options.reviewApiKey })
      const receipt = await readJson<{ status: 'needs_input' | 'needs_review' }>(path.join(dataDir, 'imports', job.importId, 'receipt.json'))
      const failed = reviews.filter((item) => item.status === 'failed' || item.status === 'unavailable')
      job.status = receipt.status === 'needs_input' ? 'needs_input' : 'needs_review'
      job.stage = failed.length ? 'review_unavailable' : 'review_complete'
      job.progress = 100
      job.diagnostics = failed.map((item) => `${item.reviewId}: ${item.error}`)
      job.updatedAt = new Date().toISOString()
      await putJson(jobPath(jobId), job)
    } catch (error) {
      const job = await readJson<JobRecord>(jobPath(jobId)).catch(() => null)
      if (job) { job.status = 'failed'; job.stage = 'reviewing_input'; job.diagnostics = [error instanceof Error ? error.message : String(error)]; job.updatedAt = new Date().toISOString(); await putJson(jobPath(jobId), job) }
    } finally { runningJobs.delete(jobId) }
  }
  const server = createServer(async (req, res) => {
    try {
      const hostName = String(req.headers.host ?? '').split(':')[0]
      if (!['127.0.0.1', 'localhost'].includes(hostName)) { apiError(res, 403, 'HOST_FORBIDDEN', 'loopback host required'); return }
      if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:5173') { apiError(res, 403, 'ORIGIN_FORBIDDEN', 'origin not allowed'); return }
      if (req.headers.origin === 'http://127.0.0.1:5173') res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Idempotency-Key' }); res.end(); return }
      const rawPath = (req.url ?? '/').split('?')[0]
      if (/%2e|%2f|%5c/i.test(rawPath) || rawPath.split('/').some((part) => part === '..')) { apiError(res, 400, 'ARTIFACT_PATH_INVALID', 'unsafe encoded path'); return }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (!url.pathname.startsWith(PREFIX + '/')) { apiError(res, 404, 'NOT_FOUND', 'route not found'); return }
      const parts = url.pathname.slice(PREFIX.length + 1).split('/').map(decodeURIComponent)
      if (req.method === 'GET' && parts[0] === 'capabilities' && parts.length === 1) {
        respond(res, 200, { handoffVersion: '1.0.0', transport: 'multipart ZIP', maxUploadBytes: MAX_UPLOAD, maxFiles: 500, maxGlbBytes: 128 * 1024 * 1024, instance: 'loopback-single', reviewModel: 'deepseek-flash', reviewAvailable: Boolean(options.reviewApiKey === undefined ? process.env.DEEPSEEK_API_KEY : options.reviewApiKey) }); return
      }
      if (req.method === 'GET' && parts[0] === 'strategies' && parts.length === 1) {
        respond(res, 200, { strategies: [{ id: 'procedural-import', kind: 'procedural', available: true }, { id: 'blender-refine', kind: 'blender', available: false, reason: 'adapter not integrated' }, { id: 'tripo-generate', kind: 'generate', available: false, reason: 'budgeted service adapter not integrated' }] }); return
      }
      if (req.method === 'POST' && parts[0] === 'bundles' && parts.length === 1) {
        const type = String(req.headers['content-type'] ?? '')
        if (!type.includes('multipart/form-data')) { apiError(res, 400, 'CONTENT_TYPE_INVALID', 'multipart file field required'); return }
        const raw = await body(req, MAX_UPLOAD)
        const parsed = await new Request('http://localhost/bundles', { method: 'POST', headers: { 'Content-Type': type }, body: raw }).formData()
        const file = parsed.get('file')
        if (!(file instanceof File)) { apiError(res, 400, 'FILE_MISSING', 'multipart field file required'); return }
        const uploadDir = path.join(dataDir, 'upload-tmp')
        await mkdir(uploadDir, { recursive: true })
        const zipPath = path.join(uploadDir, `${randomUUID()}.zip`)
        try {
          await writeFile(zipPath, Buffer.from(await file.arrayBuffer()))
          const receipt = await storeBundle(zipPath, dataDir)
          respond(res, 201, receipt)
        } finally { await import('node:fs/promises').then((fs) => fs.rm(zipPath, { force: true })) }
        return
      }
      if (req.method === 'POST' && parts[0] === 'imports' && parts.length === 1) {
        const payload = await jsonBody<{ bundleId: string; submissionId: string; storyId: string; sourceContentRevision: number; profileId: string }>(req)
        if (!payload || typeof payload !== 'object') { apiError(res, 400, 'IMPORT_BODY_INVALID', 'import body required'); return }
        const idempotencyKey = String(req.headers['idempotency-key'] ?? '')
        if (!/^bundle-[a-f0-9]{20}$/.test(payload.bundleId ?? '')) { apiError(res, 400, 'BUNDLE_ID_INVALID', 'bundleId required'); return }
        const sourceDir = path.join(dataDir, 'bundles', payload.bundleId, 'files')
        const handoff = await readJson<{ submissionId: string; storyId: string; sourceContentRevision: number }>(path.join(sourceDir, 'handoff.json'))
        if (handoff.submissionId !== payload.submissionId || handoff.storyId !== payload.storyId || handoff.sourceContentRevision !== payload.sourceContentRevision) { apiError(res, 422, 'IMPORT_IDENTITY_MISMATCH', 'submission identity does not match uploaded bundle'); return }
        const receipt = await serializeImport(() => importCollection(sourceDir, dataDir, idempotencyKey))
        const file = jobPath(receipt.jobId)
        let job: JobRecord
        try { job = await readJson<JobRecord>(file) }
        catch {
          job = { jobId: receipt.jobId, importId: receipt.importId, status: 'processing', stage: 'reviewing_input', progress: 60, diagnostics: [], feedbackUrl: `${PREFIX}/imports/${receipt.importId}/feedback`, updatedAt: new Date().toISOString() }
          await putJson(file, job)
        }
        respond(res, 202, { importId: receipt.importId, jobId: receipt.jobId, status: job.status, feedbackUrl: job.feedbackUrl })
        if (job.status === 'processing') void progressReview(job.jobId)
        return
      }
      if (req.method === 'GET' && parts[0] === 'jobs' && parts.length === 2 && safeSegment(parts[1])) { respond(res, 200, await readJson<JobRecord>(jobPath(parts[1]))); return }
      if (req.method === 'GET' && parts[0] === 'imports' && parts.length === 3 && parts[2] === 'feedback' && /^import-[a-f0-9]{20}$/.test(parts[1])) {
        const feedback = await readJson<Record<string, unknown>>(path.join(dataDir, 'imports', parts[1], 'feedback', 'feedback.json'))
        respond(res, 200, { ...feedback, packageBaseUrl: `${PREFIX}/artifacts/${parts[1]}/feedback`, feedbackMarkdownUrl: `${PREFIX}/artifacts/${parts[1]}/feedback/feedback.md`, revisedPlanUrl: `${PREFIX}/artifacts/${parts[1]}/feedback/revised-plan.md` }); return
      }
      if (req.method === 'GET' && parts[0] === 'worlds' && parts.length === 4 && parts[2] === 'releases' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[1]) && /^release-[a-f0-9]{20}$/.test(parts[3])) {
        const release = await readJson<Record<string, unknown>>(path.join(dataDir, 'releases', parts[1], parts[3], 'release.json'))
        respond(res, 200, { ...release, packageBaseUrl: `${PREFIX}/artifacts/${parts[3]}`, registryStatus: 'candidate' }); return
      }
      if (req.method === 'GET' && parts[0] === 'worlds' && parts.length === 3 && parts[2] === 'releases' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[1])) {
        const dir = path.join(dataDir, 'releases', parts[1])
        const releases = (await readdir(dir).catch(() => [])).filter((item) => /^release-[a-f0-9]{20}$/.test(item)).sort()
        const current = await readJson<{ currentReleaseId: string }>(path.join(dataDir, 'registry', parts[1], 'current.json')).catch(() => null)
        respond(res, 200, { storyId: parts[1], releases, currentReleaseId: current?.currentReleaseId ?? null }); return
      }
      if (req.method === 'POST' && parts[0] === 'worlds' && parts.length === 3 && parts[2] === 'feedback' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[1])) {
        const feedback = await jsonBody<WorldFeedback>(req)
        if (!feedback || typeof feedback !== 'object') { apiError(res, 400, 'WORLD_FEEDBACK_INVALID', 'feedback body required'); return }
        if (feedback.storyId !== parts[1]) { apiError(res, 422, 'STORY_ID_MISMATCH', 'feedback storyId does not match route'); return }
        respond(res, 202, await submitWorldFeedback(feedback, dataDir)); return
      }
      if (req.method === 'GET' && parts[0] === 'feedback' && parts.length === 2 && safeSegment(parts[1])) {
        const stories = await readdir(path.join(dataDir, 'viewer-feedback')).catch(() => [])
        for (const storyId of stories) {
          if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId)) continue
          const record = await readJson<Record<string, unknown>>(path.join(dataDir, 'viewer-feedback', storyId, parts[1], 'record.json')).catch(() => null)
          if (record) { respond(res, 200, record); return }
        }
        apiError(res, 404, 'FEEDBACK_NOT_FOUND', 'feedback not found'); return
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && parts[0] === 'artifacts' && parts.length >= 3 && safeSegment(parts[1])) {
        const relative = parts.slice(2).join('/')
        if (!safeRelPath(relative)) { apiError(res, 400, 'ARTIFACT_PATH_INVALID', 'unsafe artifact path'); return }
        const root = await artifactRoot(dataDir, parts[1])
        if (!root) { apiError(res, 404, 'ARTIFACT_NOT_FOUND', 'artifact not found'); return }
        const target = path.resolve(root, relative)
        const realRoot = await realpath(root)
        const realTarget = await realpath(target).catch(() => null)
        if (!realTarget || !realTarget.startsWith(realRoot + path.sep) || !(await stat(realTarget)).isFile()) { apiError(res, 404, 'ARTIFACT_NOT_FOUND', 'file not found'); return }
        const mime = realTarget.endsWith('.json') ? 'application/json' : realTarget.endsWith('.glb') ? 'model/gltf-binary' : realTarget.endsWith('.md') ? 'text/markdown; charset=utf-8' : realTarget.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
        const bytes = await readFile(realTarget)
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length, 'Cache-Control': 'private, immutable, max-age=31536000' })
        res.end(req.method === 'HEAD' ? undefined : bytes)
        return
      }
      apiError(res, 404, 'NOT_FOUND', 'route not found')
    } catch (error) {
      const typed = error as Error & { status?: number; code?: string }
      const message = typed.message ?? String(error)
      const status = typed.status ?? (
        error instanceof ImportError ? (error.code === 'INVALID_IDEMPOTENCY_KEY' ? 400 : error.code.includes('CONFLICT') ? 409 : 422)
        : typed.code === 'ENOENT' ? 404
        : message === 'BUNDLE_SIZE_INVALID' || message === 'BUNDLE_TOO_LARGE' ? 413
        : message.includes('CONFLICT') ? 409
        : /^(BUNDLE_INVALID|WORLD_FEEDBACK_INVALID|WORLD_FEEDBACK_ISSUE_INVALID|WORLD_PATCH_INVALID|WORLD_PATCH_HASH_MISMATCH|PATCH_BUNDLE_REQUIRED|RELEASE_REVISION_CONFLICT)/.test(message) ? 422
        : error instanceof TypeError ? 400 : 500
      )
      const inferredCode = message.split(':')[0]
      apiError(res, status, error instanceof ImportError ? error.code : typed.code ?? (/^[A-Z][A-Z0-9_]+$/.test(inferredCode) ? inferredCode : status === 404 ? 'NOT_FOUND' : 'PROCESSING_FAILED'), message)
    }
  })
  ;(server as Server & { resumePendingJobs?: () => Promise<void> }).resumePendingJobs = async () => {
    for (const file of await readdir(path.join(dataDir, 'jobs')).catch(() => [])) {
      if (!file.endsWith('.json')) continue
      const job = await readJson<JobRecord>(path.join(dataDir, 'jobs', file)).catch(() => null)
      if (job?.status === 'processing') void progressReview(job.jobId)
    }
  }
  return server
}

async function artifactRoot(dataDir: string, artifactId: string): Promise<string | null> {
  if (/^import-[a-f0-9]{20}$/.test(artifactId)) return path.join(dataDir, 'imports', artifactId)
  if (/^bundle-[a-f0-9]{20}$/.test(artifactId)) return path.join(dataDir, 'bundles', artifactId, 'files')
  if (/^release-[a-f0-9]{20}$/.test(artifactId)) {
    for (const storyId of await readdir(path.join(dataDir, 'releases')).catch(() => [])) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId)) continue
      const dir = path.join(dataDir, 'releases', storyId, artifactId)
      if (await stat(dir).then((item) => item.isDirectory()).catch(() => false)) return dir
    }
  }
  return null
}
