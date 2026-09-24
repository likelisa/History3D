import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReviewReport } from '../../contracts/src/handoff-types.ts'
import type { WorldFeedback } from './feedback.ts'

type Gate = { code: string; detail: string }
export interface ReleaseAudit { storyId: string; releaseId: string; snapshotHash: string; ready: boolean; gates: Gate[] }
export interface ReleaseAcceptance {
  storyId: string; releaseId: string; releaseSnapshotHash: string; operator: string
  environment: { device: string; browser: string; viewport: [number, number]; gpu: string; dpr: number }
  coldLoadSeconds: number[]; walkSeconds: number; medianFps: number; lowFps: number
  continuousPlaybackChecked: boolean; musicAudition: 'passed' | 'not_applicable'
  collectorHistoricalApproval: string; viewerFeedbackId: string
  viewerBuild: string
  screenshotRefs: string[]; knownLimitations: string[]
}
export interface RegistryDecision {
  decisionId: string; action: 'promote' | 'rollback'; storyId: string; releaseId: string
  expectedReleaseHash: string; expectedCurrentReleaseId: string | null
  operator: string; reason: string
}

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const id = (value: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
const releaseIdValid = (value: string): boolean => /^release-[a-f0-9]{20}$/.test(value)
const safeFile = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..')
const readOptional = async <T>(file: string): Promise<T | null> => json<T>(file).catch((error) => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
  throw error
})

/** Read-only audit of immutable package, reviews and external acceptance evidence. */
export async function auditRelease(storyId: string, releaseId: string, dataDir: string): Promise<ReleaseAudit> {
  if (!id(storyId) || !releaseIdValid(releaseId)) throw new Error('RELEASE_ID_INVALID')
  const root = path.join(dataDir, 'releases', storyId, releaseId)
  const bytes = await readFile(path.join(root, 'release.json'))
  const snapshotHash = sha(bytes)
  const release = JSON.parse(bytes.toString('utf8')) as {
    storyId: string; releaseId: string; sceneRevision: number; files: Array<{ path: string; sha256: string; bytes: number }>
    qualityStatus: string; knownLimitations: string[]
  }
  const gates: Gate[] = []
  const fail = (code: string, detail: string): void => { gates.push({ code, detail }) }
  if (release.storyId !== storyId || release.releaseId !== releaseId) fail('IDENTITY', 'release identity mismatch')
  const listed = new Set<string>()
  for (const file of release.files) {
    if (!safeFile(file.path) || listed.has(file.path)) { fail('MANIFEST', `unsafe or duplicate path: ${file.path}`); continue }
    listed.add(file.path)
    let cursor = root
    let safe = true
    for (const part of file.path.split('/')) {
      cursor = path.join(cursor, part)
      const info = await lstat(cursor).catch(() => null)
      if (!info || info.isSymbolicLink()) { safe = false; break }
    }
    if (!safe) { fail('MANIFEST', `symlink or missing path: ${file.path}`); continue }
    const content = await readFile(cursor).catch(() => null)
    if (!content || content.length !== file.bytes || sha(content) !== file.sha256) fail('FILE_HASH', file.path)
  }
  for (const required of ['scene.json', 'story.json', 'sources.json', 'quality-report.json', 'provenance.json', 'generation-report.json'])
    if (!listed.has(required)) fail('MANIFEST', `missing ${required}`)
  if (gates.some((gate) => ['IDENTITY', 'FILE_HASH', 'MANIFEST'].includes(gate.code)))
    return { storyId, releaseId, snapshotHash, ready: false, gates }

  const quality = await json<{ diagnostics?: Array<{ severity: string }>; unresolved?: string[]; relationChecks?: Array<{ pass: boolean; required: boolean }> }>(path.join(root, 'quality-report.json'))
  if ((quality.unresolved ?? []).length || (quality.diagnostics ?? []).some((item) => item.severity === 'error') || (quality.relationChecks ?? []).some((item) => item.required && !item.pass))
    fail('QUALITY', 'unresolved issue, package error or required assembly failure')
  const generation = await json<{ realProviderGenerationPerformed?: boolean }>(path.join(root, 'generation-report.json'))
  if (generation.realProviderGenerationPerformed !== true) fail('GENERATION', 'B real provider generation not evidenced')
  const provenance = await json<{ inputImportId?: string }>(path.join(root, 'provenance.json'))
  if (!provenance.inputImportId) fail('INPUT', 'source import missing')
  else {
    const importDir = path.join(dataDir, 'imports', provenance.inputImportId)
    const receipt = await readOptional<{ snapshotHash: string }>(path.join(importDir, 'receipt.json'))
    const manifest = await readOptional<{ assets: Array<{ assetId: string }> }>(path.join(importDir, 'source', 'assets', 'asset-manifest.json'))
    if (!receipt || !manifest) fail('INPUT', 'source snapshot unavailable')
    else for (const asset of manifest.assets) {
      const reviewId = `review-${receipt.snapshotHash.slice(0, 20)}-${asset.assetId}`
      const reviewDir = path.join(importDir, 'reviews', reviewId)
      const job = await readOptional<{ status: string }>(path.join(reviewDir, 'job.json'))
      const report = await readOptional<ReviewReport>(path.join(reviewDir, 'report.json'))
      if (job?.status !== 'pass' || report?.decision !== 'pass' || report.snapshotHash !== receipt.snapshotHash)
        fail('INPUT_REVIEW', asset.assetId)
    }
  }
  const reviewRoot = path.join(dataDir, 'world-reviews', storyId, releaseId)
  let worldPassed = false
  for (const entry of await readdir(reviewRoot).catch(() => [])) {
    if (!/^world-review-[a-f0-9]{20}$/.test(entry)) continue
    const job = await readOptional<{ status: string }>(path.join(reviewRoot, entry, 'job.json'))
    const report = await readOptional<ReviewReport>(path.join(reviewRoot, entry, 'report.json'))
    if (job?.status === 'pass' && report?.decision === 'pass' && report.snapshotHash === snapshotHash && Array.isArray(report.unassessed) && !report.unassessed.length) worldPassed = true
  }
  if (!worldPassed) fail('WORLD_REVIEW', 'no passing DeepSeek world review for this release snapshot')

  const acceptance = await readOptional<ReleaseAcceptance>(path.join(dataDir, 'registry', storyId, 'acceptance', `${releaseId}.json`))
  if (!acceptance || acceptance.storyId !== storyId || acceptance.releaseId !== releaseId || acceptance.releaseSnapshotHash !== snapshotHash || !acceptance.operator || !acceptance.collectorHistoricalApproval || !acceptance.viewerFeedbackId || !acceptance.viewerBuild || !acceptance.environment?.device || !acceptance.environment.browser || !acceptance.environment.gpu || !Array.isArray(acceptance.environment.viewport) || acceptance.environment.viewport[0] !== 1440 || acceptance.environment.viewport[1] !== 900 || !Number.isFinite(acceptance.environment.dpr) || !Array.isArray(acceptance.coldLoadSeconds) || acceptance.coldLoadSeconds.length !== 3 || acceptance.coldLoadSeconds.some((value) => !Number.isFinite(value) || value > 5 || value < 0) || !Number.isFinite(acceptance.walkSeconds) || acceptance.walkSeconds < 90 || !Number.isFinite(acceptance.medianFps) || acceptance.medianFps < 30 || !Number.isFinite(acceptance.lowFps) || acceptance.lowFps < 0 || !acceptance.continuousPlaybackChecked || acceptance.musicAudition !== 'passed' || !Array.isArray(acceptance.screenshotRefs) || !acceptance.screenshotRefs.length)
    fail('ACCEPTANCE', 'fixed-environment performance, music, historical and continuous-play evidence missing')
  else {
    const record = await readOptional<{ input: WorldFeedback }>(path.join(dataDir, 'viewer-feedback', storyId, acceptance.viewerFeedbackId, 'record.json'))
    if (record?.input.releaseId !== releaseId || record.input.sceneRevision !== release.sceneRevision || record.input.viewerBuild !== acceptance.viewerBuild || record.input.measurements.viewport[0] !== 1440 || record.input.measurements.viewport[1] !== 900 || record.input.result !== 'accepted' || record.input.issues.some((issue) => issue.severity === 'blocking'))
      fail('VIEWER_ACCEPTANCE', 'C feedback does not accept this exact release without blockers')
  }
  return { storyId, releaseId, snapshotHash, ready: gates.length === 0, gates }
}

export async function decideRelease(input: RegistryDecision, dataDir: string): Promise<{ currentReleaseId: string; previousReleaseId: string | null }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.decisionId) || !['promote', 'rollback'].includes(input.action) || !id(input.storyId) || !releaseIdValid(input.releaseId) || !/^[a-f0-9]{64}$/.test(input.expectedReleaseHash) || !input.operator?.trim() || !input.reason?.trim() || (input.expectedCurrentReleaseId !== null && !releaseIdValid(input.expectedCurrentReleaseId))) throw new Error('RELEASE_DECISION_INVALID')
  const registryDir = path.join(dataDir, 'registry', input.storyId)
  await mkdir(registryDir, { recursive: true })
  const lockPath = path.join(registryDir, '.decision.lock')
  const token = randomUUID()
  let locked = false
  for (let attempt = 0; attempt < 5 && !locked; attempt++) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }))
      await handle.close()
      locked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await stat(lockPath).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 30_000) {
        const owner = await readOptional<{ pid: number; startedAt: number }>(lockPath).catch(() => null)
        let alive = true
        if (owner?.pid) try { process.kill(owner.pid, 0) } catch (probe) { alive = (probe as NodeJS.ErrnoException).code !== 'ESRCH' }
        if (!alive || Date.now() - info.mtimeMs > 120_000) await rm(lockPath, { force: true })
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  if (!locked) throw new Error('RELEASE_REGISTRY_LOCKED')
  try { return await decideReleaseLocked(input, dataDir, registryDir) }
  finally {
    const owner = await readOptional<{ token: string }>(lockPath).catch(() => null)
    if (owner?.token === token) await rm(lockPath, { force: true })
  }
}

async function decideReleaseLocked(input: RegistryDecision, dataDir: string, registryDir: string): Promise<{ currentReleaseId: string; previousReleaseId: string | null }> {
  const currentPath = path.join(registryDir, 'current.json')
  const current = await readOptional<{ currentReleaseId: string }>(currentPath)
  const audit = await auditRelease(input.storyId, input.releaseId, dataDir)
  if (audit.snapshotHash !== input.expectedReleaseHash) throw new Error('RELEASE_SNAPSHOT_CONFLICT')
  const decisionPath = path.join(registryDir, 'decisions', `${input.decisionId}.json`)
  const prior = await readOptional<{ hash: string; result: { currentReleaseId: string; previousReleaseId: string | null } }>(decisionPath)
  if (prior) {
    if (prior.hash !== sha(JSON.stringify(input))) throw new Error('RELEASE_DECISION_CONFLICT')
    if (current?.currentReleaseId === prior.result.currentReleaseId) return prior.result
    if ((current?.currentReleaseId ?? null) !== input.expectedCurrentReleaseId) throw new Error('CURRENT_RELEASE_CONFLICT')
    await writeCurrent(currentPath, prior.result, input.decisionId)
    return prior.result
  }
  if ((current?.currentReleaseId ?? null) !== input.expectedCurrentReleaseId) throw new Error('CURRENT_RELEASE_CONFLICT')
  if (input.action === 'promote' && !audit.ready) throw new Error(`RELEASE_NOT_READY: ${audit.gates.map((gate) => gate.code).join(',')}`)
  if (input.action === 'rollback' && audit.gates.some((gate) => ['IDENTITY', 'FILE_HASH', 'MANIFEST'].includes(gate.code))) throw new Error('ROLLBACK_TARGET_CORRUPT')
  if (input.action === 'rollback') {
    const previouslyApproved = await readdir(path.join(registryDir, 'decisions')).catch(() => [])
    let approved = false
    for (const file of previouslyApproved) {
      const record = await readOptional<{ decision: RegistryDecision }>(path.join(registryDir, 'decisions', file))
      if (record?.decision?.action === 'promote' && record.decision.releaseId === input.releaseId) approved = true
    }
    if (!approved) throw new Error('ROLLBACK_TARGET_NOT_APPROVED')
  }
  await mkdir(path.dirname(decisionPath), { recursive: true })
  const result = { currentReleaseId: input.releaseId, previousReleaseId: current?.currentReleaseId ?? null }
  const tempDecision = `${decisionPath}.${randomUUID()}.tmp`
  await writeFile(tempDecision, JSON.stringify({ hash: sha(JSON.stringify(input)), decision: input, result }, null, 2) + '\n')
  await rename(tempDecision, decisionPath)
  await writeCurrent(currentPath, result, input.decisionId)
  return result
}

async function writeCurrent(currentPath: string, result: { currentReleaseId: string; previousReleaseId: string | null }, decisionId: string): Promise<void> {
  const temp = `${currentPath}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ ...result, decisionId, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  await rename(temp, currentPath)
}
