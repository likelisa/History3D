import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlbBounds } from '../../../contracts/src/glb.ts'
import { sizeTolerance } from '../../../contracts/src/geometry.ts'
import { createNodeReader } from '../../../contracts/src/node-reader.ts'
import type { ReviewReport } from '../../../contracts/src/handoff-types.ts'
import type { SceneFile } from '../../../contracts/src/types.ts'
import { validateScenePackage } from '../../../contracts/src/validate.ts'
import { acquireAssetLock } from '../asset-patch.ts'
import { auditRelease } from '../release-registry.ts'
import type { AssetTaskRecord } from './tasks.ts'

export interface AdoptionDecision { decisionId: string; action: 'adopt'; taskId: string; reviewId: string; snapshotHash: string; operator: string; reason: string }
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n')
  await rename(temp, file)
}
const safeRelative = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..')
const missingOnly = (error: unknown): null => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }

export async function adoptAssetTask(input: AdoptionDecision, dataDir: string): Promise<AssetTaskRecord> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.decisionId) || input.action !== 'adopt' || !/^task-[a-f0-9]{20}$/.test(input.taskId) || !/^asset-review-[a-f0-9]{20}$/.test(input.reviewId) || !/^[a-f0-9]{64}$/.test(input.snapshotHash) || !input.operator?.trim() || !input.reason?.trim()) throw new Error('ASSET_DECISION_INVALID')
  const taskDir = path.join(dataDir, 'asset-tasks', input.taskId)
  const taskFile = path.join(taskDir, 'task.json')
  const decisionFile = path.join(taskDir, 'decision.json')
  const decisionHash = digest(JSON.stringify(input))
  const prior = await json<{ hash: string }>(decisionFile).catch(missingOnly)
  if (prior && prior.hash !== decisionHash) throw new Error('ASSET_DECISION_CONFLICT')
  const task = await json<AssetTaskRecord>(taskFile)
  if (task.status === 'adopted' && task.decision?.decisionId === input.decisionId && task.decision.releaseId && task.result) {
    if (!safeRelative(task.result.outputPath)) throw new Error('ADOPTED_ASSET_CHANGED')
    const adoptedArtifact = await readFile(path.join(taskDir, task.result.outputPath))
    const audit = await auditRelease(task.storyId, task.decision.releaseId, dataDir)
    if (digest(adoptedArtifact) !== task.result.outputSha256 || audit.gates.some((gate) => ['IDENTITY', 'MANIFEST', 'FILE_HASH'].includes(gate.code))) throw new Error('ADOPTED_ASSET_CHANGED')
    return task
  }
  if (task.status !== 'candidate_ready' || !task.result || task.result.reviewStatus !== 'pass') throw new Error('ASSET_DECISION_REVIEW_REQUIRED')
  const reviewDir = path.join(taskDir, 'reviews', input.reviewId)
  const job = await json<{ status: string }>(path.join(reviewDir, 'job.json'))
  const report = await json<ReviewReport>(path.join(reviewDir, 'report.json'))
  if (job.status !== 'pass' || report.scope !== 'asset' || report.decision !== 'pass' || report.snapshotHash !== input.snapshotHash || report.modelRecord?.requestedModel !== 'deepseek-flash' || !report.modelRecord.requestId || !Array.isArray(report.unassessed) || report.unassessed.length || !Array.isArray(report.coverage) || report.coverage.some((item) => item.status !== 'assessed')) throw new Error('ASSET_DECISION_REVIEW_REQUIRED')
  if (!safeRelative(task.result.outputPath)) throw new Error('ASSET_TASK_ARTIFACT_MISMATCH')
  const artifact = await readFile(path.join(taskDir, task.result.outputPath))
  if (digest(artifact) !== task.result.outputSha256) throw new Error('ASSET_TASK_ARTIFACT_MISMATCH')
  const releaseDir = path.join(dataDir, 'releases', task.storyId, task.releaseId)
  const baseAudit = await auditRelease(task.storyId, task.releaseId, dataDir)
  if (baseAudit.gates.some((gate) => ['IDENTITY', 'MANIFEST', 'FILE_HASH'].includes(gate.code))) throw new Error('BASE_RELEASE_CORRUPT')
  const scene = await json<SceneFile>(path.join(releaseDir, 'scene.json'))
  const asset = scene.assets.find((item) => item.id === task.assetId)
  const lineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string; path: string }> }>(path.join(releaseDir, 'asset-lineage.json'))
  const parent = lineage.assets.find((item) => item.assetId === task.assetId)
  if (!asset || !parent || !safeRelative(asset.path) || parent.path !== asset.path || parent.sha256 !== task.result.inputSha256 || parent.sha256 !== task.request.expectedBaseSha256) throw new Error('ASSET_REVISION_CONFLICT')
  const bounds = readGlbBounds(artifact.buffer.slice(artifact.byteOffset, artifact.byteOffset + artifact.byteLength) as ArrayBuffer)
  if (!bounds || bounds.dimensions.some((value, axis) => Math.abs(value - asset.dimensionsM[axis]) > sizeTolerance(asset.dimensionsM[axis])) || Math.abs(bounds.min[1]) > 0.05) throw new Error('ASSET_DIMENSION_REVIEW_REQUIRED')
  const nextRevision = parent.adoptedRevision + 1

  const lockDir = path.join(dataDir, 'locks', `${task.storyId}-${task.assetId}.lock`)
  const lockToken = await acquireAssetLock(lockDir)
  try {
    const selectedPath = path.join(dataDir, 'registry', task.storyId, 'selected-assets', `${task.assetId}.json`)
    const selected = await json<{ baseSha256: string; candidateHash: string; decisionId: string; releaseId: string }>(selectedPath).catch(missingOnly)
    if (selected && (selected.baseSha256 !== parent.sha256 || selected.candidateHash !== task.result.outputSha256 || selected.decisionId !== input.decisionId)) throw new Error('ASSET_REVISION_CONFLICT')
    const releaseId = selected?.releaseId ?? `release-${digest(JSON.stringify(['B-task-adopt-v1', task.releaseId, input.decisionId, task.result.outputSha256])).slice(0, 20)}`
    const outputDir = path.join(dataDir, 'releases', task.storyId, releaseId)
    const existing = await json<{ releaseId: string }>(path.join(outputDir, 'release.json')).catch(missingOnly)
    if (!existing) {
      const stage = `${outputDir}.${randomUUID()}.tmp`
      await cp(releaseDir, stage, { recursive: true })
      try {
        await writeFile(path.join(stage, asset.path), artifact)
        scene.sceneRevision += 1
        await putJson(path.join(stage, 'scene.json'), scene)
        const experiencePath = path.join(stage, 'experience.json')
        const experience = await json<{ sceneRevision: number }>(experiencePath).catch(missingOnly)
        if (experience) { experience.sceneRevision = scene.sceneRevision; await putJson(experiencePath, experience) }
        const adopted = lineage.assets.find((item) => item.assetId === task.assetId)!
        adopted.adoptedRevision = nextRevision
        adopted.sha256 = task.result.outputSha256
        await putJson(path.join(stage, 'asset-lineage.json'), lineage)
        const provenance = await json<Record<string, unknown>>(path.join(stage, 'provenance.json'))
        provenance.assetTaskAdoption = { taskId: task.taskId, reviewId: input.reviewId, decisionId: input.decisionId, operator: input.operator, reason: input.reason, parentReleaseId: task.releaseId, parentSha256: task.result.inputSha256, outputSha256: task.result.outputSha256 }
        await putJson(path.join(stage, 'provenance.json'), provenance)
        const generation = await json<{ strategies: unknown[]; realProviderGenerationPerformed: boolean }>(path.join(stage, 'generation-report.json'))
        generation.strategies.push({ strategy: task.strategyId, assetId: task.assetId, inputSha256: task.result.inputSha256, outputSha256: task.result.outputSha256, tool: task.result.tool, toolVersion: task.result.toolVersion, costUsd: task.result.costUsd, reviewId: input.reviewId, adopted: true, reason: input.reason })
        await putJson(path.join(stage, 'generation-report.json'), generation)
        const quality = await json<Record<string, unknown>>(path.join(stage, 'quality-report.json'))
        const validation = await validateScenePackage(createNodeReader(stage), { checkGlbBounds: true })
        if (validation.diagnostics.some((item) => item.severity === 'error')) throw new Error('WORLD_VALIDATION_FAILED')
        quality.status = 'needs_review'; quality.viewerAcceptance = null
        quality.requiredReviews = ['world_review', 'release_review']
        quality.diagnostics = validation.diagnostics
        await putJson(path.join(stage, 'quality-report.json'), quality)
        await putJson(path.join(stage, 'asset-task-decision.json'), input)
        await writeFile(path.join(stage, 'handoff.md'), `# B asset task candidate ${releaseId}\n\nParent: ${task.releaseId}; task: ${task.taskId}; review: ${input.reviewId}. Requires new world review and C acceptance.\n`)
        const release = await json<{ files: Array<{ path: string; sha256: string; bytes: number }>; [key: string]: unknown }>(path.join(stage, 'release.json'))
        release.releaseId = releaseId; release.sceneRevision = scene.sceneRevision; release.qualityStatus = 'needs_review'
        release.knownLimitations = [...(Array.isArray(release.knownLimitations) ? release.knownLimitations : []), 'B asset candidate awaits world review and C acceptance']
        const files = [...new Set([...release.files.map((item) => item.path), 'asset-task-decision.json'])].sort()
        release.files = await Promise.all(files.map(async (file) => { if (!safeRelative(file)) throw new Error('RELEASE_PATH_INVALID'); const bytes = await readFile(path.join(stage, file)); return { path: file, sha256: digest(bytes), bytes: bytes.length } }))
        await putJson(path.join(stage, 'release.json'), release)
        await mkdir(path.dirname(outputDir), { recursive: true })
        await rename(stage, outputDir)
      } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
    }
    const audit = await auditRelease(task.storyId, releaseId, dataDir)
    if (audit.gates.some((gate) => ['IDENTITY', 'MANIFEST', 'FILE_HASH'].includes(gate.code))) throw new Error('RELEASE_CONFLICT')
    const adoptedLineage = await json<{ assets: Array<{ assetId: string; adoptedRevision: number; sha256: string }> }>(path.join(outputDir, 'asset-lineage.json'))
    if (!adoptedLineage.assets.some((item) => item.assetId === task.assetId && item.adoptedRevision === nextRevision && item.sha256 === task.result!.outputSha256)) throw new Error('RELEASE_CONFLICT')
    const releaseDecision = await json<AdoptionDecision>(path.join(outputDir, 'asset-task-decision.json'))
    if (digest(JSON.stringify(releaseDecision)) !== decisionHash) throw new Error('RELEASE_CONFLICT')
    await putJson(selectedPath, { baseSha256: parent.sha256, candidateHash: task.result.outputSha256, assetRevision: nextRevision, decisionId: input.decisionId, releaseId })
    task.status = 'adopted'; task.result.adopted = true
    task.decision = { decisionId: input.decisionId, action: 'adopt', operator: input.operator, reason: input.reason, reviewId: input.reviewId, snapshotHash: input.snapshotHash, releaseId }
    await putJson(decisionFile, { hash: decisionHash, decision: input })
    await putJson(taskFile, task)
    return task
  } finally {
    const owner = await json<{ token: string }>(path.join(lockDir, 'owner.json')).catch(missingOnly)
    if (owner?.token === lockToken) await rm(lockDir, { recursive: true, force: true })
  }
}
