import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlbBounds } from '../../contracts/src/glb.ts'
import { sizeTolerance } from '../../contracts/src/geometry.ts'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import type { SceneFile } from '../../contracts/src/types.ts'
import { validateScenePackage } from '../../contracts/src/validate.ts'
import type { WorldFeedback, WorldFeedbackReceipt } from './feedback.ts'

export interface PatchDecision {
  decisionId: string; action: 'integrate' | 'reject'; operator: string; reason: string
  storyId: string; feedbackId: string; assetId: string; candidateHash: string
  baseReleaseId: string; baseAssetRevision: number; baseSha256: string
}
export interface PatchDecisionResult { decisionId: string; status: 'integrated_candidate' | 'rejected'; releaseId: string | null; assetRevision: number | null }
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file) }
const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
const safeRelative = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..')
const missingOnly = (error: unknown): null => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
  throw error
}

export async function reviewViewerPatch(decision: PatchDecision, dataDir: string): Promise<PatchDecisionResult> {
  if (!validId(decision.decisionId) || !validId(decision.operator) || !decision.reason?.trim() || !validId(decision.feedbackId) || !validId(decision.assetId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(decision.storyId) || !/^release-[a-f0-9]{20}$/.test(decision.baseReleaseId) || !/^[a-f0-9]{64}$/.test(decision.candidateHash) || !/^[a-f0-9]{64}$/.test(decision.baseSha256) || !Number.isSafeInteger(decision.baseAssetRevision) || decision.baseAssetRevision < 1 || !['integrate', 'reject'].includes(decision.action)) throw new Error('PATCH_DECISION_INVALID')
  const recordDir = path.join(dataDir, 'viewer-feedback', decision.storyId, decision.feedbackId)
  const record = await json<{ input: WorldFeedback; receipt: WorldFeedbackReceipt }>(path.join(recordDir, 'record.json'))
  if (record.input.releaseId !== decision.baseReleaseId || record.input.storyId !== decision.storyId) throw new Error('PATCH_FEEDBACK_MISMATCH')
  const patch = record.input.assetPatches.find((item) => item.assetId === decision.assetId && item.baseAssetRevision === decision.baseAssetRevision && item.baseSha256 === decision.baseSha256)
  const patchResult = record.receipt.patchResults.find((item) => item.assetId === decision.assetId && item.candidateHash === decision.candidateHash)
  if (!patch || !patchResult || patchResult.status !== 'needs_review' || !patchResult.candidatePath) throw new Error('PATCH_NOT_REVIEWABLE')
  const decisionsDir = path.join(dataDir, 'decisions', decision.storyId)
  const decisionPath = path.join(decisionsDir, `${decision.decisionId}.json`)
  const decisionHash = digest(JSON.stringify(decision))
  try {
    const prior = await json<{ decisionHash: string; result?: PatchDecisionResult }>(decisionPath)
    if (prior.decisionHash !== decisionHash) throw new Error('PATCH_DECISION_ID_CONFLICT')
    if (prior.result) return prior.result
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (decision.action === 'reject') {
    const result: PatchDecisionResult = { decisionId: decision.decisionId, status: 'rejected', releaseId: null, assetRevision: null }
    await putJson(decisionPath, { decisionHash, decision, result })
    return result
  }
  const baseDir = path.join(dataDir, 'releases', decision.storyId, decision.baseReleaseId)
  const baseLineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string; path: string }> }>(path.join(baseDir, 'asset-lineage.json'))
  const parent = baseLineage.assets.find((item) => item.assetId === decision.assetId)
  if (!parent || parent.adoptedRevision !== decision.baseAssetRevision || parent.sha256 !== decision.baseSha256) throw new Error('ASSET_REVISION_CONFLICT')
  if (!safeRelative(patchResult.candidatePath)) throw new Error('PATCH_CANDIDATE_PATH_INVALID')
  const candidate = await readFile(path.join(recordDir, patchResult.candidatePath))
  if (digest(candidate) !== decision.candidateHash) throw new Error('PATCH_CANDIDATE_CHANGED')
  const candidateBounds = readGlbBounds(candidate.buffer.slice(candidate.byteOffset, candidate.byteOffset + candidate.byteLength) as ArrayBuffer)
  if (!candidateBounds) throw new Error('ASSET_INVALID')
  const scene = await json<SceneFile>(path.join(baseDir, 'scene.json'))
  const asset = scene.assets.find((item) => item.id === decision.assetId)
  if (!asset) throw new Error('ASSET_NOT_FOUND')
  if (!safeRelative(asset.path) || parent.path !== asset.path) throw new Error('ASSET_PATH_INVALID')
  if (!patch.preservesDimensions || candidateBounds.dimensions.some((value, axis) => Math.abs(value - asset.dimensionsM[axis]) > sizeTolerance(asset.dimensionsM[axis])) || Math.abs(candidateBounds.min[1]) > 0.05) throw new Error('PATCH_DIMENSION_REVIEW_REQUIRED')

  const lockDir = path.join(dataDir, 'locks', `${decision.storyId}-${decision.assetId}.lock`)
  const lockToken = await acquireAssetLock(lockDir)
  try {
    await putJson(decisionPath, { decisionHash, decision, status: 'pending' })
    const selectedPath = path.join(dataDir, 'registry', decision.storyId, 'selected-assets', `${decision.assetId}.json`)
    const selected = await json<{ baseSha256: string; baseReleaseId: string; candidateHash: string; assetRevision: number; decisionId: string; releaseId: string }>(selectedPath).catch(missingOnly)
    if (selected && selected.baseSha256 !== decision.baseSha256) throw new Error('ASSET_REVISION_CONFLICT')
    if (selected && selected.candidateHash !== decision.candidateHash) throw new Error('ASSET_REVISION_CONFLICT')
    if (selected && (selected.baseReleaseId !== decision.baseReleaseId || selected.assetRevision !== parent.adoptedRevision + 1 || selected.decisionId !== decision.decisionId)) throw new Error('ASSET_REVISION_CONFLICT')
    if (selected) {
      await verifyExistingRelease(path.join(dataDir, 'releases', decision.storyId, selected.releaseId))
      const selectedLineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string }> }>(path.join(dataDir, 'releases', decision.storyId, selected.releaseId, 'asset-lineage.json'))
      if (!selectedLineage.assets.some((item) => item.assetId === decision.assetId && item.adoptedRevision === selected.assetRevision && item.sha256 === decision.candidateHash)) throw new Error('RELEASE_CONFLICT')
      const result: PatchDecisionResult = { decisionId: decision.decisionId, status: 'integrated_candidate', releaseId: selected.releaseId, assetRevision: selected.assetRevision }
      await putJson(decisionPath, { decisionHash, decision, result })
      return result
    }
    const nextRevision = parent.adoptedRevision + 1
    const releaseId = `release-${digest(JSON.stringify(['viewer-patch-v1', decision.baseReleaseId, decisionHash, decision.candidateHash])).slice(0, 20)}`
    const finalDir = path.join(dataDir, 'releases', decision.storyId, releaseId)
    const existingRelease = await json<{ releaseId: string }>(path.join(finalDir, 'release.json')).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (existingRelease) {
      await verifyExistingRelease(finalDir)
      const existingLineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string }> }>(path.join(finalDir, 'asset-lineage.json'))
      const existingAsset = existingLineage.assets.find((item) => item.assetId === decision.assetId)
      if (existingRelease.releaseId !== releaseId || existingAsset?.sha256 !== decision.candidateHash || existingAsset.adoptedRevision !== nextRevision) throw new Error('RELEASE_CONFLICT')
      const result: PatchDecisionResult = { decisionId: decision.decisionId, status: 'integrated_candidate', releaseId, assetRevision: nextRevision }
      await putJson(selectedPath, { baseSha256: decision.baseSha256, baseReleaseId: decision.baseReleaseId, candidateHash: decision.candidateHash, assetRevision: nextRevision, decisionId: decision.decisionId, releaseId })
      await putJson(decisionPath, { decisionHash, decision, result })
      return result
    }
    const stage = `${finalDir}.${randomUUID()}.tmp`
    await cp(baseDir, stage, { recursive: true })
    try {
      await writeFile(path.join(stage, asset.path), candidate)
      scene.sceneRevision += 1
      await putJson(path.join(stage, 'scene.json'), scene)
      const experiencePath = path.join(stage, 'experience.json')
      const experience = await json<{ sceneRevision: number }>(experiencePath).catch(missingOnly)
      if (experience) { experience.sceneRevision = scene.sceneRevision; await putJson(experiencePath, experience) }
      const lineage = structuredClone(baseLineage)
      const updated = lineage.assets.find((item) => item.assetId === decision.assetId)!
      updated.adoptedRevision = nextRevision
      updated.sha256 = decision.candidateHash
      await putJson(path.join(stage, 'asset-lineage.json'), lineage)
      const provenance = await json<Record<string, unknown>>(path.join(stage, 'provenance.json'))
      provenance.viewerPatch = { feedbackId: decision.feedbackId, decisionId: decision.decisionId, operator: decision.operator, reason: decision.reason, parentReleaseId: decision.baseReleaseId, parentSha256: decision.baseSha256, candidateSha256: decision.candidateHash, adoptedRevision: nextRevision }
      await putJson(path.join(stage, 'provenance.json'), provenance)
      const quality = await json<Record<string, unknown>>(path.join(stage, 'quality-report.json'))
      quality.status = 'needs_review'
      quality.viewerAcceptance = null
      quality.requiredReviews = ['asset_review', 'world_review', 'release_review']
      const validation = await validateScenePackage(createNodeReader(stage), { checkGlbBounds: true })
      if (validation.diagnostics.some((item) => item.severity === 'error')) throw new Error('WORLD_VALIDATION_FAILED')
      quality.diagnostics = validation.diagnostics
      await putJson(path.join(stage, 'quality-report.json'), quality)
      await putJson(path.join(stage, 'patch-decision.json'), decision)
      await writeFile(path.join(stage, 'handoff.md'), `# Viewer patch candidate ${releaseId}\n\nBase: ${decision.baseReleaseId}. Feedback: ${decision.feedbackId}. Asset ${decision.assetId} revision ${nextRevision}. Requires asset/world review and renewed viewer acceptance.\n`)
      const release = await json<{ files: Array<{ path: string; sha256: string; bytes: number }>; [key: string]: unknown }>(path.join(stage, 'release.json'))
      release.releaseId = releaseId
      release.sceneRevision = scene.sceneRevision
      release.qualityStatus = 'needs_review'
      release.knownLimitations = [...(Array.isArray(release.knownLimitations) ? release.knownLimitations : []), 'Viewer patch awaits asset/world review and renewed acceptance']
      const files = [...new Set([...release.files.map((item) => item.path), 'patch-decision.json'])].sort()
      release.files = await Promise.all(files.map(async (file) => { const bytes = await readFile(path.join(stage, file)); return { path: file, sha256: digest(bytes), bytes: bytes.length } }))
      await putJson(path.join(stage, 'release.json'), release)
      await mkdir(path.dirname(finalDir), { recursive: true })
      await rename(stage, finalDir)
      const result: PatchDecisionResult = { decisionId: decision.decisionId, status: 'integrated_candidate', releaseId, assetRevision: nextRevision }
      await putJson(selectedPath, { baseSha256: decision.baseSha256, baseReleaseId: decision.baseReleaseId, candidateHash: decision.candidateHash, assetRevision: nextRevision, decisionId: decision.decisionId, releaseId })
      await putJson(decisionPath, { decisionHash, decision, result })
      return result
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
  } finally {
    const owner = await json<{ token: string }>(path.join(lockDir, 'owner.json')).catch(() => null)
    if (owner?.token === lockToken) await rm(lockDir, { recursive: true, force: true })
  }
}

export async function acquireAssetLock(lockDir: string): Promise<string> {
  await mkdir(path.dirname(lockDir), { recursive: true })
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomUUID()
    const prepared = `${lockDir}.pending-${token}`
    await mkdir(prepared)
    await putJson(path.join(prepared, 'owner.json'), { pid: process.pid, startedAt: Date.now(), token })
    try {
      await rename(prepared, lockDir)
      return token
    } catch (error) {
      await rm(prepared, { recursive: true, force: true })
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const recoveryLock = `${lockDir}.recovery`
      try { await mkdir(recoveryLock) }
      catch (recoveryError) {
        if ((recoveryError as NodeJS.ErrnoException).code !== 'EEXIST') throw recoveryError
        const info = await stat(recoveryLock).catch(missingOnly)
        if (info && Date.now() - info.mtimeMs >= 120_000) {
          const staleRecovery = `${recoveryLock}.stale-${randomUUID()}`
          await rename(recoveryLock, staleRecovery).catch((renameError) => { if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError })
          await rm(staleRecovery, { recursive: true, force: true })
        }
        await new Promise((resolve) => setTimeout(resolve, 40)); continue
      }
      try {
        const lockInfo = await stat(lockDir).catch(() => null)
        if (lockInfo) {
          const owner = await json<{ pid: number; startedAt: number }>(path.join(lockDir, 'owner.json')).catch(() => null)
          const age = Date.now() - (owner?.startedAt ?? lockInfo.mtimeMs)
          let alive = false
          if (owner && Number.isSafeInteger(owner.pid)) {
            try { process.kill(owner.pid, 0); alive = true }
            catch (probe) { alive = (probe as NodeJS.ErrnoException).code !== 'ESRCH' }
          }
          // A dead owner can be recovered after 30 s. PID reuse cannot block longer than 2 min.
          if (age >= 30_000 && (!alive || age >= 2 * 60_000)) {
            const stale = `${lockDir}.stale-${randomUUID()}`
            await rename(lockDir, stale).catch((renameError) => { if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError })
            await rm(stale, { recursive: true, force: true })
          }
        }
      } finally { await rm(recoveryLock, { recursive: true, force: true }) }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  throw new Error('ASSET_LOCKED')
}

export async function verifyExistingRelease(root: string): Promise<void> {
  const release = await json<{ files: Array<{ path: string; sha256: string; bytes: number }>; sceneRevision: number }>(path.join(root, 'release.json'))
  const listed = new Set(release.files.map((file) => file.path))
  for (const required of ['scene.json', 'story.json', 'sources.json', 'asset-lineage.json', 'quality-report.json', 'patch-decision.json']) if (!listed.has(required)) throw new Error('RELEASE_CONFLICT')
  for (const file of release.files) {
    if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('RELEASE_CONFLICT')
    const bytes = await readFile(path.join(root, file.path))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('RELEASE_CONFLICT')
  }
  const packageCheck = await validateScenePackage(createNodeReader(root), { checkGlbBounds: true })
  if (packageCheck.diagnostics.some((item) => item.severity === 'error')) throw new Error('RELEASE_CONFLICT')
  const experience = await json<{ sceneRevision: number }>(path.join(root, 'experience.json')).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
  if (experience && experience.sceneRevision !== release.sceneRevision) throw new Error('RELEASE_CONFLICT')
}
