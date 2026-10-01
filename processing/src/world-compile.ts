import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import { validateScenePackage } from '../../contracts/src/validate.ts'
import type { Claim, HotspotBinding, ObjectBrief, SceneAsset, SceneFile, SceneObject, StoryFile, Vec2, Vec3 } from '../../contracts/src/types.ts'
import type { CollectionAsset, FileDigest, HandoffManifest, ProcessingFeedback } from '../../contracts/src/handoff-types.ts'
import type { ExperienceFile } from '../../contracts/src/experience.ts'
import { validateExperience } from './experience-compile.ts'

export interface WorldPlan {
  planVersion: '1.0.0'; storyId: string; templateScenePath: string; profileId: string
  assetBindings: Array<{ assetId: string; collectionAssetId: string }>
  placements: Array<{ objectId: string; position: Vec3; rotationY: number }>
  blockerOverrides?: Array<{ id: string; min: Vec2; max: Vec2 }>
  hotspotOverrides?: HotspotBinding[]
  claimChanges?: Array<{ claimId: string; statement: string; value: string; reason: string }>
  newClaims?: Claim[]
  newBriefs?: ObjectBrief[]
  newAssets?: Array<SceneAsset & { sourcePath: string }>
  newObjects?: SceneObject[]
  assetRevisions?: Record<string, number>
  experienceSourcePath?: string
  relations: Array<{ relationId: string; parentObjectId: string; childObjectId: string; kind: 'attachment' | 'handheld'; expectedOffset?: Vec3; parentAnchorM?: Vec3; childAnchorM?: Vec3; toleranceM: number; required: boolean }>
  requiredCapabilities: string[]; optionalCapabilities: string[]; unresolved: string[]
}

export interface ReleaseReceipt { storyId: string; releaseId: string; status: 'needs_review'; path: string; sceneHash: string }
const digest = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { await writeFile(file, JSON.stringify(value, null, 2) + '\n') }
const isSafeRelative = (value: string): boolean => Boolean(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.split('/').some((part) => !part || part === '.' || part === '..')

export async function buildWorldRelease(importId: string, planPath: string, dataDir: string, repoRoot: string): Promise<ReleaseReceipt> {
  if (!/^import-[a-f0-9]{20}$/.test(importId)) throw new Error('INVALID_IMPORT_ID')
  const importRoot = path.join(dataDir, 'imports', importId)
  const source = path.join(importRoot, 'source')
  const [receipt, handoff, feedback, plan, assetManifest] = await Promise.all([
    json<{ snapshotHash: string }>(path.join(importRoot, 'receipt.json')),
    json<HandoffManifest>(path.join(source, 'handoff.json')),
    json<ProcessingFeedback>(path.join(importRoot, 'feedback', 'feedback.json')),
    json<WorldPlan>(planPath),
    json<{ assets: CollectionAsset[] }>(path.join(source, 'assets', 'asset-manifest.json')),
  ])
  if (plan.planVersion !== '1.0.0' || plan.storyId !== handoff.storyId || feedback.basedOnSnapshotHash !== receipt.snapshotHash) throw new Error('WORLD_PLAN_MISMATCH')
  if (!isSafeRelative(plan.templateScenePath)) throw new Error('WORLD_PLAN_PATH_INVALID')
  const template = await json<SceneFile>(path.join(repoRoot, plan.templateScenePath))
  const story = await json<StoryFile>(path.join(source, 'story.json'))
  if (template.storyId !== story.storyId || template.contentRevision !== story.contentRevision) throw new Error('TEMPLATE_REVISION_MISMATCH')
  const scene: SceneFile = structuredClone(template)
  scene.sceneRevision = template.sceneRevision + 1
  const compiledStory: StoryFile = structuredClone(story)
  const compiledSources = await json<{ contentRevision: number; [key: string]: unknown }>(path.join(source, 'sources.json'))
  for (const claim of plan.newClaims ?? []) {
    if (compiledStory.claims.some((item) => item.id === claim.id) || claim.evidenceType !== 'illustrative' || claim.sourceIds.length) throw new Error(`NEW_CLAIM_INVALID: ${claim.id}`)
    compiledStory.claims.push(claim)
  }
  for (const brief of plan.newBriefs ?? []) {
    if (compiledStory.objectBriefs.some((item) => item.id === brief.id)) throw new Error(`NEW_BRIEF_DUPLICATE: ${brief.id}`)
    compiledStory.objectBriefs.push(brief)
  }
  for (const asset of plan.newAssets ?? []) {
    if (scene.assets.some((item) => item.id === asset.id) || !isSafeRelative(asset.path) || !isSafeRelative(asset.sourcePath)) throw new Error(`NEW_ASSET_INVALID: ${asset.id}`)
    const { sourcePath: _sourcePath, ...sceneAsset } = asset
    scene.assets.push(sceneAsset)
  }
  for (const object of plan.newObjects ?? []) {
    if (scene.objects.some((item) => item.id === object.id)) throw new Error(`NEW_OBJECT_DUPLICATE: ${object.id}`)
    scene.objects.push(object)
  }
  for (const change of plan.claimChanges ?? []) {
    const claim = compiledStory.claims.find((item) => item.id === change.claimId)
    if (!claim || claim.evidenceType !== 'illustrative' || !change.reason.trim() || !change.statement.trim() || !change.value.trim()) throw new Error(`CLAIM_CHANGE_REQUIRES_COLLECTOR_REVIEW: ${change.claimId}`)
    claim.statement = change.statement
    claim.value = change.value
    claim.note = `${claim.note} B 编译修订：${change.reason}`
  }
  if (plan.claimChanges?.length || plan.newClaims?.length || plan.newBriefs?.length) {
    compiledStory.contentRevision += 1
    compiledSources.contentRevision = compiledStory.contentRevision
    scene.contentRevision = compiledStory.contentRevision
  }
  const objectById = new Map(scene.objects.map((item) => [item.id, item]))
  for (const placement of plan.placements) {
    const object = objectById.get(placement.objectId)
    if (!object || placement.position.length !== 3 || placement.position.some((value) => !Number.isFinite(value)) || !Number.isFinite(placement.rotationY)) throw new Error(`WORLD_PLACEMENT_INVALID: ${placement.objectId}`)
    object.position = placement.position
    object.rotation = [0, placement.rotationY, 0]
  }
  for (const override of plan.blockerOverrides ?? []) {
    const blocker = scene.blockers.find((item) => item.id === override.id)
    if (!blocker || override.min.length !== 2 || override.max.length !== 2 || override.min.some((value, axis) => !Number.isFinite(value) || value >= override.max[axis])) throw new Error(`BLOCKER_OVERRIDE_INVALID: ${override.id}`)
    blocker.min = override.min
    blocker.max = override.max
  }
  for (const override of plan.hotspotOverrides ?? []) {
    const index = scene.hotspotBindings.findIndex((item) => item.hotspotId === override.hotspotId)
    if (index < 0) throw new Error(`HOTSPOT_OVERRIDE_INVALID: ${override.hotspotId}`)
    scene.hotspotBindings[index] = override
  }
  const bound = new Map(plan.assetBindings.map((item) => [item.assetId, item.collectionAssetId]))
  const assetById = new Map(assetManifest.assets.map((item) => [item.assetId, item]))
  for (const [sceneAssetId, collectionAssetId] of bound) {
    const sceneAsset = scene.assets.find((item) => item.id === sceneAssetId)
    const inputAsset = assetById.get(collectionAssetId)
    if (!sceneAsset || !inputAsset || inputAsset.briefId !== scene.objects.find((item) => item.render.type === 'asset' && item.render.assetId === sceneAssetId)?.briefId) throw new Error(`WORLD_ASSET_BINDING_INVALID: ${sceneAssetId}`)
    if (inputAsset.scaleStatus !== 'known' || !inputAsset.dimensionsM) throw new Error(`SCALE_UNRESOLVED: ${collectionAssetId}`)
    sceneAsset.dimensionsM = inputAsset.dimensionsM
    sceneAsset.rights = inputAsset.rights
  }
  const relationChecks = plan.relations.map((relation) => checkAttachment(relation, objectById))
  if (relationChecks.some((item) => item.required && !item.pass)) throw new Error(`ASSEMBLY_INVALID: ${relationChecks.filter((item) => !item.pass).map((item) => item.relationId).join(', ')}`)
  const planBytes = await readFile(planPath)
  if (plan.experienceSourcePath && !isSafeRelative(plan.experienceSourcePath)) throw new Error('EXPERIENCE_PATH_INVALID')
  const experienceBytes = plan.experienceSourcePath ? await readFile(path.join(repoRoot, plan.experienceSourcePath)) : null
  if (experienceBytes) {
    const experience = JSON.parse(experienceBytes.toString('utf8')) as ExperienceFile
    const errors = validateExperience(scene, experience)
    if (errors.length) throw new Error(`EXPERIENCE_INVALID: ${errors.join('; ')}`)
  }
  const templateDir = path.dirname(path.join(repoRoot, plan.templateScenePath))
  const newAssetPaths = new Map((plan.newAssets ?? []).map((item) => [item.id, item.sourcePath]))
  const templateAssetHashes = await Promise.all(scene.assets.filter((item) => !bound.has(item.id)).map(async (item) => digest(await readFile(path.join(repoRoot, newAssetPaths.get(item.id) ?? path.relative(repoRoot, path.join(templateDir, item.path)))))))
  const releaseId = `release-${digest(JSON.stringify(['world-compile-v4', receipt.snapshotHash, digest(planBytes), digest(JSON.stringify(scene)), templateAssetHashes, experienceBytes ? digest(experienceBytes) : null])).slice(0, 20)}`
  const finalDir = path.join(dataDir, 'releases', story.storyId, releaseId)
  const stage = `${finalDir}.${randomUUID()}.tmp`
  await mkdir(stage, { recursive: true })
  try {
    await putJson(path.join(stage, 'story.json'), compiledStory)
    await putJson(path.join(stage, 'sources.json'), compiledSources)
    for (const file of handoff.files.filter((item) => item.path.startsWith('references/'))) {
      if (!isSafeRelative(file.path)) throw new Error('REFERENCE_PATH_INVALID')
      await mkdir(path.dirname(path.join(stage, file.path)), { recursive: true })
      await cp(path.join(source, file.path), path.join(stage, file.path))
    }
    for (const asset of scene.assets) {
      if (!isSafeRelative(asset.path)) throw new Error('ASSET_PATH_INVALID')
      const inputId = bound.get(asset.id)
      const input = inputId ? assetById.get(inputId) : null
      const from = input ? path.join(source, input.path) : newAssetPaths.has(asset.id) ? path.join(repoRoot, newAssetPaths.get(asset.id)!) : path.join(templateDir, asset.path)
      await mkdir(path.dirname(path.join(stage, asset.path)), { recursive: true })
      await cp(from, path.join(stage, asset.path))
    }
    await putJson(path.join(stage, 'asset-lineage.json'), {
      assets: await Promise.all(scene.assets.map(async (asset) => {
        const revision = plan.assetRevisions?.[asset.id] ?? 1
        if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`ASSET_REVISION_INVALID: ${asset.id}`)
        return { assetId: asset.id, adoptedRevision: revision, sha256: digest(await readFile(path.join(stage, asset.path))), path: asset.path }
      })),
    })
    await putJson(path.join(stage, 'scene.json'), scene)
    await writeFile(path.join(stage, 'world-plan.json'), planBytes)
    if (experienceBytes) await writeFile(path.join(stage, 'experience.json'), experienceBytes)
    const validation = await validateScenePackage(createNodeReader(stage), { checkGlbBounds: true })
    const errors = validation.diagnostics.filter((item) => item.severity === 'error')
    if (errors.length) throw new Error(`WORLD_VALIDATION_FAILED: ${errors.map((item) => `${item.file}:${item.field} ${item.message}`).join('; ')}`)
    const quality = { status: 'needs_review', diagnostics: validation.diagnostics, relationChecks, unresolved: plan.unresolved, requiredReviews: ['input_review', 'asset_review', 'world_review', 'release_review'], viewerAcceptance: null }
    await putJson(path.join(stage, 'quality-report.json'), quality)
    const assetSources = await Promise.all(scene.assets.map(async (asset) => ({
      assetId: asset.id,
      kind: bound.has(asset.id) ? 'collection' : newAssetPaths.has(asset.id) ? 'B-procedural' : 'template-fixture',
      sourcePath: bound.has(asset.id) ? `imports/${importId}/source/${assetById.get(bound.get(asset.id)!)?.path}` : newAssetPaths.get(asset.id) ?? path.relative(repoRoot, path.join(templateDir, asset.path)),
      sha256: digest(await readFile(path.join(stage, asset.path))),
    })))
    await putJson(path.join(stage, 'provenance.json'), { inputImportId: importId, inputSubmissionId: handoff.submissionId, inputSnapshotHash: receipt.snapshotHash, sourceContentRevision: handoff.sourceContentRevision, compiledContentRevision: compiledStory.contentRevision, planHash: digest(planBytes), sceneTemplate: plan.templateScenePath, assetBindings: plan.assetBindings, placements: plan.placements, blockerOverrides: plan.blockerOverrides ?? [], hotspotOverrides: plan.hotspotOverrides ?? [], claimChanges: plan.claimChanges ?? [], newClaimIds: (plan.newClaims ?? []).map((item) => item.id), assetSources, reviewRefs: feedback.reviewRefs })
    await putJson(path.join(stage, 'generation-report.json'), {
      strategies: await Promise.all((plan.newAssets ?? []).map(async (asset) => ({
        strategy: 'procedural-import', assetId: asset.id, sourcePath: asset.sourcePath,
        outputSha256: digest(await readFile(path.join(repoRoot, asset.sourcePath))),
        tool: 'Blender 5.2', costUsd: 0, adopted: true,
        reason: 'B authored illustrative components to verify dynamic assembly in the formal viewer',
      }))),
      realProviderGenerationPerformed: false,
      note: 'The traveler and staff are deterministic Blender demo GLBs. A separate paid provider generation remains untested.',
    })
    await writeFile(path.join(stage, 'handoff.md'), `# ${story.title}\n\n固定候选 ${releaseId}。入口 scene.json；需要 ${plan.requiredCapabilities.join(', ')}。未完成世界 AI 复审与 C 页面验收，不得提升为 current。\n`)
    const files = await digestFiles(stage, ['scene.json', 'story.json', 'sources.json', 'world-plan.json', 'quality-report.json', 'provenance.json', 'generation-report.json', 'asset-lineage.json', 'handoff.md', ...(experienceBytes ? ['experience.json'] : []), ...scene.assets.map((item) => item.path), ...handoff.files.filter((item) => item.path.startsWith('references/')).map((item) => item.path)])
    await putJson(path.join(stage, 'release.json'), { handoffVersion: '1.0.0', storyId: story.storyId, releaseId, contentRevision: compiledStory.contentRevision, sceneRevision: scene.sceneRevision, inputSubmissionIds: [handoff.submissionId], entrypoint: 'scene.json', files, requiredCapabilities: plan.requiredCapabilities, optionalCapabilities: plan.optionalCapabilities, qualityStatus: 'needs_review', knownLimitations: plan.unresolved })
    await mkdir(path.dirname(finalDir), { recursive: true })
    const existing = await lstat(finalDir).catch((error) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (existing) {
      // Windows can replace a plain file or empty directory during rename without raising an error.
      if (!await matchesStagedRelease(stage, finalDir)) throw new Error(`EXISTING_RELEASE_INVALID: ${releaseId}`)
      await rm(stage, { recursive: true, force: true })
    } else {
      try { await rename(stage, finalDir) } catch (error) {
        // Another compiler can win the race after the preflight. Reuse only an intact identical release.
        if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        if (!await matchesStagedRelease(stage, finalDir)) throw new Error(`EXISTING_RELEASE_INVALID: ${releaseId}`, { cause: error })
        await rm(stage, { recursive: true, force: true })
      }
    }
    return { storyId: story.storyId, releaseId, status: 'needs_review', path: finalDir, sceneHash: digest(await readFile(path.join(finalDir, 'scene.json'))) }
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
}

function checkAttachment(relation: WorldPlan['relations'][number], objects: Map<string, SceneObject>): { relationId: string; required: boolean; pass: boolean; verticalGapM: number | null; horizontalOverlap: boolean } {
  const parent = objects.get(relation.parentObjectId)
  const child = objects.get(relation.childObjectId)
  if (!parent || !child) return { relationId: relation.relationId, required: relation.required, pass: false, verticalGapM: null, horizontalOverlap: false }
  const verticalGapM = child.position[1] - (parent.position[1] + parent.dimensionsM[1])
  if (relation.kind === 'handheld') {
    if (relation.parentAnchorM && relation.childAnchorM) {
      const parentLocal = rotateYaw(relation.parentAnchorM, parent.rotation[1])
      const childLocal = rotateYaw(relation.childAnchorM, child.rotation[1])
      const delta: Vec3 = [0, 1, 2].map((axis) => child.position[axis] + childLocal[axis] - parent.position[axis] - parentLocal[axis]) as Vec3
      const distance = Math.hypot(...delta)
      return { relationId: relation.relationId, required: relation.required, pass: distance <= relation.toleranceM, verticalGapM: delta[1], horizontalOverlap: Math.hypot(delta[0], delta[2]) <= relation.toleranceM }
    }
    if (!relation.expectedOffset) return { relationId: relation.relationId, required: relation.required, pass: false, verticalGapM, horizontalOverlap: false }
    const offset = [child.position[0] - parent.position[0], child.position[1] - parent.position[1], child.position[2] - parent.position[2]]
    const distance = Math.hypot(...offset.map((item, index) => item - relation.expectedOffset![index]))
    return { relationId: relation.relationId, required: relation.required, pass: distance <= relation.toleranceM, verticalGapM, horizontalOverlap: true }
  }
  const xOverlap = Math.abs(parent.position[0] - child.position[0]) <= (parent.dimensionsM[0] + child.dimensionsM[0]) / 2
  const zOverlap = Math.abs(parent.position[2] - child.position[2]) <= (parent.dimensionsM[2] + child.dimensionsM[2]) / 2
  return { relationId: relation.relationId, required: relation.required, pass: Math.abs(verticalGapM) <= relation.toleranceM && xOverlap && zOverlap, verticalGapM, horizontalOverlap: xOverlap && zOverlap }
}

function rotateYaw([x, y, z]: Vec3, yaw: number): Vec3 {
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  return [x * cosine + z * sine, y, z * cosine - x * sine]
}

async function digestFiles(root: string, paths: string[]): Promise<FileDigest[]> {
  const unique = [...new Set(paths)].sort()
  return Promise.all(unique.map(async (file) => { const bytes = await readFile(path.join(root, file)); return { path: file, sha256: digest(bytes), bytes: bytes.length } }))
}

async function matchesStagedRelease(stage: string, destination: string): Promise<boolean> {
  try {
    const directory = await lstat(destination)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return false
    const expectedBytes = await readFile(path.join(stage, 'release.json'))
    const manifestFile = path.join(destination, 'release.json')
    const manifestStat = await lstat(manifestFile)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return false
    if (!expectedBytes.equals(await readFile(manifestFile))) return false
    const manifest = JSON.parse(expectedBytes.toString('utf8')) as { files: FileDigest[] }
    const realDestination = await realpath(destination)
    for (const expected of manifest.files) {
      if (!isSafeRelative(expected.path)) return false
      const file = path.join(destination, expected.path)
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) return false
      const relative = path.relative(realDestination, await realpath(file))
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return false
      const bytes = await readFile(file)
      if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) return false
    }
    return true
  } catch (error) {
    // Missing files invalidate the collision; permissions and other I/O failures still propagate.
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}
