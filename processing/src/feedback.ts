import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlbBounds } from '../../contracts/src/glb.ts'

export interface WorldFeedback {
  handoffVersion: '1.0.0'; feedbackId: string; storyId: string; releaseId: string; sceneRevision: number
  viewerBuild: string; result: 'accepted' | 'changes_requested' | 'blocked'; bundleId: string | null
  issues: Array<{ issueId: string; owner: 'collector' | 'processor' | 'viewer'; objectId: string | null; severity: 'blocking' | 'warning' | 'info'; message: string; reproduce: string; expectedChange: string }>
  assetPatches: Array<{ assetId: string; baseAssetRevision: number; baseSha256: string; candidatePath: string; operations: string[]; preservesDimensions: boolean }>
  planChanges: Array<{ itemId: string; proposal: string; reason: string }>
  measurements: { device: string; viewport: [number, number] }
}

export interface PatchResult { assetId: string; status: 'needs_review' | 'conflict' | 'rejected'; code: string | null; candidateHash: string | null; candidatePath: string | null }
export interface WorldFeedbackReceipt { feedbackId: string; jobId: string; status: 'received'; storyId: string; releaseId: string; patchResults: PatchResult[]; issueCount: number }
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const safePath = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.split('/').some((part) => !part || part === '.' || part === '..')
const id = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)

export async function submitWorldFeedback(input: WorldFeedback, dataDir: string): Promise<WorldFeedbackReceipt> {
  if (input.handoffVersion !== '1.0.0' || !id(input.feedbackId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.storyId) || !/^release-[a-f0-9]{20}$/.test(input.releaseId) || !input.viewerBuild || !['accepted', 'changes_requested', 'blocked'].includes(input.result)) throw new Error('WORLD_FEEDBACK_INVALID')
  if (!Array.isArray(input.issues) || !Array.isArray(input.assetPatches) || !Array.isArray(input.planChanges) || !input.measurements?.device || !Array.isArray(input.measurements.viewport) || input.measurements.viewport.length !== 2 || input.measurements.viewport.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('WORLD_FEEDBACK_INVALID')
  if (input.assetPatches.length && (!input.bundleId || !/^bundle-[a-f0-9]{20}$/.test(input.bundleId))) throw new Error('PATCH_BUNDLE_REQUIRED')
  const releaseDir = path.join(dataDir, 'releases', input.storyId, input.releaseId)
  const release = await readJson<{ sceneRevision: number }>(path.join(releaseDir, 'release.json'))
  if (release.sceneRevision !== input.sceneRevision) throw new Error('RELEASE_REVISION_CONFLICT')
  const scene = await readJson<{ objects: Array<{ id: string }> }>(path.join(releaseDir, 'scene.json'))
  const objectIds = new Set(scene.objects.map((item) => item.id))
  const issueIds = new Set<string>()
  for (const issue of input.issues) {
    if (!id(issue.issueId) || issueIds.has(issue.issueId) || (issue.objectId && !objectIds.has(issue.objectId)) || !issue.message || !issue.reproduce || !issue.expectedChange) throw new Error('WORLD_FEEDBACK_ISSUE_INVALID')
    issueIds.add(issue.issueId)
  }
  const bodyHash = digest(JSON.stringify(input))
  const finalDir = path.join(dataDir, 'viewer-feedback', input.storyId, input.feedbackId)
  try {
    const existing = await readJson<{ bodyHash: string; receipt: WorldFeedbackReceipt }>(path.join(finalDir, 'record.json'))
    if (existing.bodyHash !== bodyHash) throw new Error('FEEDBACK_ID_CONFLICT')
    return existing.receipt
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const lineage = await readJson<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string }> }>(path.join(releaseDir, 'asset-lineage.json'))
  const adopted = new Map(lineage.assets.map((item) => [item.assetId, item]))
  const bundleDir = input.bundleId ? path.join(dataDir, 'bundles', input.bundleId, 'files') : null
  const bundle = input.bundleId ? await readJson<{ files: Array<{ path: string; sha256: string }> }>(path.join(dataDir, 'bundles', input.bundleId, 'bundle.json')) : null
  const listed = new Map(bundle?.files.map((item) => [item.path, item.sha256]))
  const stage = `${finalDir}.${randomUUID()}.tmp`
  await mkdir(path.join(stage, 'assets'), { recursive: true })
  try {
    const patchResults: PatchResult[] = []
    for (const patch of input.assetPatches) {
      if (!id(patch.assetId) || !safePath(patch.candidatePath) || !patch.candidatePath.endsWith('.glb') || !listed.has(patch.candidatePath) || !/^[a-f0-9]{64}$/.test(patch.baseSha256)) throw new Error(`WORLD_PATCH_INVALID: ${patch.assetId}`)
      const source = path.join(bundleDir!, patch.candidatePath)
      const bytes = await readFile(source)
      const candidateHash = digest(bytes)
      if (listed.get(patch.candidatePath) !== candidateHash) throw new Error(`WORLD_PATCH_HASH_MISMATCH: ${patch.assetId}`)
      const destination = path.join(stage, 'assets', `${patch.assetId}-${candidateHash.slice(0, 12)}.glb`)
      await cp(source, destination)
      const base = adopted.get(patch.assetId)
      let status: PatchResult['status'] = 'needs_review'
      let code: string | null = null
      if (!base || base.adoptedRevision !== patch.baseAssetRevision || base.sha256 !== patch.baseSha256) { status = 'conflict'; code = 'ASSET_REVISION_CONFLICT' }
      else if (!readGlbBounds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)) { status = 'rejected'; code = 'ASSET_INVALID' }
      else if (candidateHash === base.sha256) { status = 'rejected'; code = 'ASSET_UNCHANGED' }
      patchResults.push({ assetId: patch.assetId, status, code, candidateHash, candidatePath: `assets/${path.basename(destination)}` })
    }
    const receipt: WorldFeedbackReceipt = { feedbackId: input.feedbackId, jobId: `job-feedback-${bodyHash.slice(0, 20)}`, status: 'received', storyId: input.storyId, releaseId: input.releaseId, patchResults, issueCount: input.issues.length }
    await mkdir(path.dirname(finalDir), { recursive: true })
    await writeJson(path.join(stage, 'record.json'), { bodyHash, input, receipt })
    await rename(stage, finalDir)
    return receipt
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n')
}
