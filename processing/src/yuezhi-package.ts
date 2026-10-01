import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import { validateCollectionHandoff } from '../../contracts/src/handoff-validate.ts'
import { validateScenePackage } from '../../contracts/src/validate.ts'
import { readGlbBounds } from '../../contracts/src/glb.ts'
import type { CollectionAsset, FileDigest, HandoffManifest } from '../../contracts/src/handoff-types.ts'
import type { SceneFile, StoryFile, SourcesFile, Vec3 } from '../../contracts/src/types.ts'

export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const writeJson = async (root: string, file: string, data: unknown): Promise<void> => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`)
}
const safe = (file: string): boolean => Boolean(file) && !path.isAbsolute(file) && !file.includes('\\') && file.split('/').every(part => Boolean(part) && part !== '.' && part !== '..')
const hashValid = (hash: string): boolean => /^[a-f0-9]{64}$/.test(hash)

export interface AssetSourceEvidence {
  assetId: string
  path: string
  sourcePath: string
  sourceRecordPath: string
  sha256: string
  bytes: number
  provider: string
  taskId: string | null
  creditsConsumed: number | null
  rawSha256: string | null
  rawPath?: string
  rawBytes?: number
  generationEvidence: 'saved_task_metadata_and_delivered_hash' | 'procedural_manifest_and_delivered_hash'
  sourceConversion: unknown
  tool: string | null
  rights: string
  historicalStatus: string
  requestDigest?: string
  model?: string
  promptSha256?: string
  generationRecord?: { request: Record<string, unknown>; taskId: string; status: string; requestDigest: string; creditsConsumed: number; rawSha256: string; rawBytes: number }
  appearanceSourceIds?: string[]
}
export interface YuezhiSourceEvidence {
  storyId: string
  contentRevision: number
  assets: AssetSourceEvidence[]
  sourceModules: FileDigest[]
  environment: unknown
  accountEvidence: unknown
  limitations: string[]
}
export interface YuezhiScenePlan {
  storyId: string
  contentRevision: number
  scene: SceneFile
  assetTransforms: Array<{ assetId: string; targetHeightM: number | null }>
}

/** Compare downloaded bytes with the teammate's preserved manifest before importing them. */
export function assertAssetDigest(bytes: Buffer, recorded: { sha256: string; bytes: number }, label: string): void {
  if (!hashValid(recorded.sha256) || !Number.isSafeInteger(recorded.bytes) || recorded.bytes < 1 || bytes.length !== recorded.bytes || sha256(bytes) !== recorded.sha256)
    throw new Error(`SOURCE_ASSET_HASH_MISMATCH: ${label}`)
}

/** Root transform only: embedded meshes and textures remain byte-for-byte unchanged. */
export function normalizeYuezhiGlb(bytes: Buffer, targetHeightM: number | null = null) {
  const bounds = readGlbBounds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  if (!bounds || bounds.dimensions.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('GLB_BOUNDS_UNAVAILABLE')
  const factor = targetHeightM === null ? 1 : targetHeightM / bounds.dimensions[1]
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('GLB_SCALE_INVALID')
  const offset: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2]
  const jsonLength = bytes.readUInt32LE(12)
  const data = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
  const active = data.scenes?.[data.scene ?? 0]
  if (!active || !Array.isArray(active.nodes) || !Array.isArray(data.nodes)) throw new Error('GLB_ACTIVE_SCENE_INVALID')
  const nodeIndex = data.nodes.length
  data.nodes.push({ name: 'bottom-center-meter-origin', children: active.nodes, translation: offset.map(value => -value * factor), scale: [factor, factor, factor] })
  active.nodes = [nodeIndex]
  const raw = Buffer.from(JSON.stringify(data))
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20)
  raw.copy(padded)
  const tail = bytes.subarray(20 + jsonLength)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return { bytes: Buffer.concat([header, padded, tail]), offset, factor, dimensions: bounds.dimensions.map(value => value * factor) as Vec3 }
}

async function digests(root: string, files: string[]): Promise<FileDigest[]> {
  return Promise.all([...new Set(files)].sort().map(async file => {
    if (!safe(file)) throw new Error(`PACKAGE_PATH_INVALID: ${file}`)
    const bytes = await readFile(path.join(root, file))
    return { path: file, sha256: sha256(bytes), bytes: bytes.length }
  }))
}

async function checkSourceModules(root: string, evidence: YuezhiSourceEvidence): Promise<void> {
  const seen = new Set<string>()
  if (!evidence.sourceModules.length) throw new Error('SOURCE_MODULES_MISSING')
  for (const file of evidence.sourceModules) {
    if (!safe(file.path) || seen.has(file.path)) throw new Error(`SOURCE_MODULE_PATH_INVALID: ${file.path}`)
    seen.add(file.path)
    assertAssetDigest(await readFile(path.join(root, file.path)), file, file.path)
  }
}

function checkBookReferences(book: { scenes: Array<{ id: string; start: string; backdrop: string; noteSourceIds?: string[]; lines: Array<{ id: string; sourceIds: string[]; next?: string; choices?: Array<{ next: string }> }> }> }, sourceIds: Set<string>, assetIds: Set<string>): void {
  const sceneIds = new Set<string>()
  for (const section of book.scenes) {
    if (sceneIds.has(section.id) || !assetIds.has(section.backdrop)) throw new Error(`BOOK_SCENE_INVALID: ${section.id}`)
    sceneIds.add(section.id)
    const lineIds = new Set(section.lines.map(line => line.id))
    if (lineIds.size !== section.lines.length || !lineIds.has(section.start)) throw new Error(`BOOK_LINE_INVALID: ${section.id}`)
    for (const id of section.noteSourceIds ?? []) if (!sourceIds.has(id)) throw new Error(`BOOK_SOURCE_MISSING: ${id}`)
    for (const line of section.lines) {
      for (const id of line.sourceIds) if (!sourceIds.has(id)) throw new Error(`BOOK_SOURCE_MISSING: ${id}`)
      for (const id of [line.next, ...(line.choices ?? []).map(choice => choice.next)].filter(Boolean)) if (!lineIds.has(id!)) throw new Error(`BOOK_LINK_MISSING: ${section.id}/${id}`)
    }
  }
}

interface PerspectiveFile {
  storyId: string; contentRevision: number; scope: string
  perspectives: Array<{ id: string; label: string; boundary: string }>
  scenes: Array<{ sceneId: string; available: string[]; views: Record<string, { description: string; visibleInformation: string; unavailableInformation: string; lines: Array<{ lineId: string; text: string; sourceIds: string[]; evidenceType: string }> }> }>
  contexts: Array<{ id: string; title: string; available: string[]; sourceIds: string[]; boundary: string; views: Record<string, { description: string; lines: Array<{ lineId: string; text: string; sourceIds: string[]; evidenceType: string }> }> }>
}
function checkPerspectives(data: PerspectiveFile, book: Parameters<typeof checkBookReferences>[0]): void {
  const allIds = ['envoy', 'opponent', 'passersby', 'host', 'trader', 'overview']
  const required: Record<string, string[]> = { arrival: ['envoy', 'passersby', 'overview'], meeting: ['envoy', 'host', 'overview'], waiting: ['envoy', 'passersby', 'overview'], market: ['envoy', 'trader', 'passersby', 'overview'] }
  if (data.scope !== '3d-scene-modal-only' || data.perspectives.length !== allIds.length || allIds.some(id => !data.perspectives.some(view => view.id === id && view.label && view.boundary))) throw new Error('PERSPECTIVE_METADATA_INVALID')
  if (data.scenes.length !== book.scenes.length || new Set(data.scenes.map(section => section.sceneId)).size !== book.scenes.length) throw new Error('PERSPECTIVE_SCENE_COVERAGE_INVALID')
  for (const section of book.scenes) {
    const node = data.scenes.find(item => item.sceneId === section.id)
    const ids = required[section.id]
    if (!ids || JSON.stringify(node?.available) !== JSON.stringify(ids) || Object.keys(node?.views ?? {}).length !== ids.length) throw new Error(`PERSPECTIVE_AVAILABILITY_MISMATCH: ${section.id}`)
    for (const id of ids) {
      const view = node?.views[id]
      if (!view || !view.description || typeof view.visibleInformation !== 'string' || typeof view.unavailableInformation !== 'string' || view.lines.length !== section.lines.length || new Set(view.lines.map(line => line.lineId)).size !== section.lines.length) throw new Error(`PERSPECTIVE_COVERAGE_MISSING: ${section.id}/${id}`)
      for (const line of section.lines) {
        const adapted = view.lines.find(item => item.lineId === line.id)
        if (!adapted?.text || !['source-boundary', 'modern-adaptation', 'historical-summary'].includes(adapted.evidenceType) || JSON.stringify(adapted.sourceIds) !== JSON.stringify(line.sourceIds)) throw new Error(`PERSPECTIVE_SOURCE_MISMATCH: ${section.id}/${id}/${line.id}`)
      }
    }
  }
  const captivity = data.contexts.find(context => context.id === 'captivity')
  const captivityIds = ['envoy', 'opponent', 'overview']
  if (data.contexts.length !== 1 || !captivity?.title || !captivity.boundary || JSON.stringify(captivity.available) !== JSON.stringify(captivityIds) || JSON.stringify(captivity.sourceIds) !== JSON.stringify(['shiji-mission']) || Object.keys(captivity.views).length !== captivityIds.length) throw new Error('CAPTIVITY_CONTEXT_MISSING')
  for (const id of captivityIds) {
    const view = captivity.views[id]
    if (!view?.description || view.lines.length !== 1 || view.lines[0].lineId !== 'captivity-context' || !view.lines[0].text || JSON.stringify(view.lines[0].sourceIds) !== JSON.stringify(['shiji-mission']) || !['source-boundary', 'modern-adaptation', 'historical-summary'].includes(view.lines[0].evidenceType)) throw new Error(`CAPTIVITY_SOURCE_MISMATCH: ${id}`)
  }
}

async function checkSourceRecord(collectionDir: string, record: AssetSourceEvidence): Promise<void> {
  if (!safe(record.sourceRecordPath)) throw new Error(`SOURCE_RECORD_PATH_INVALID: ${record.assetId}`)
  const source = await json<Record<string, unknown>>(path.join(collectionDir, record.sourceRecordPath))
  if (record.sourceRecordPath.endsWith('mural-horse-generation.json')) {
    if (source.status !== 'success' || source.outputSha256 !== record.sha256 || source.bytes !== record.bytes || source.taskId !== record.taskId || source.provider !== record.provider || source.creditsConsumed !== record.creditsConsumed) throw new Error(`SOURCE_RECORD_MISMATCH: ${record.assetId}`)
  } else if (record.sourceRecordPath.endsWith('environment-manifest.json')) {
    if (source.sha256 !== record.sha256 || source.bytes !== record.bytes || source.blenderVersion !== record.tool || !Array.isArray(source.sources)) throw new Error(`SOURCE_RECORD_MISMATCH: ${record.assetId}`)
    if (JSON.stringify(source.refinement ?? null) !== JSON.stringify(record.sourceConversion)) throw new Error(`SOURCE_REFINEMENT_MISMATCH: ${record.assetId}`)
    if (source.refinement) {
      const parent = source.refinement as { upstreamSha256: string; upstreamBytes: number; scriptSha256: string }
      const upstream = await json<{ sha256: string; bytes: number }>(path.join(collectionDir, 'evidence/upstream-environment-manifest.json'))
      if (parent.upstreamSha256 !== upstream.sha256 || parent.upstreamBytes !== upstream.bytes) throw new Error(`SOURCE_REFINEMENT_PARENT_MISMATCH: ${record.assetId}`)
      if (sha256(await readFile(path.join(collectionDir, 'evidence/refine-environment.py'))) !== parent.scriptSha256) throw new Error(`SOURCE_REFINEMENT_SCRIPT_MISMATCH: ${record.assetId}`)
    }
  } else {
    const candidates = Array.isArray(source.assets) ? source.assets as Array<Record<string, unknown>> : [source]
    const original = candidates?.find(item => record.sourcePath.endsWith('/' + item.file))
    if (!original || original.sha256 !== record.sha256 || original.bytes !== record.bytes || (original.taskId ?? null) !== record.taskId) throw new Error(`SOURCE_RECORD_MISMATCH: ${record.assetId}`)
    if (record.taskId && (original.source !== record.provider || original.rawSha256 !== record.rawSha256 || original.creditsConsumed !== record.creditsConsumed || JSON.stringify(original.conversion ?? null) !== JSON.stringify(record.sourceConversion))) throw new Error(`SOURCE_TRIPO_RECORD_MISMATCH: ${record.assetId}`)
    if (record.assetId === 'asset-xiongnu') {
      const proof = record.generationRecord
      if (!proof || proof.status !== 'success' || proof.taskId !== record.taskId || proof.rawSha256 !== record.rawSha256 || proof.creditsConsumed !== record.creditsConsumed || proof.requestDigest !== record.requestDigest || sha256(JSON.stringify(proof.request)) !== record.requestDigest || proof.request.model !== record.model || typeof proof.request.prompt !== 'string' || sha256(proof.request.prompt) !== record.promptSha256 || original.requestDigest !== record.requestDigest || original.model !== record.model || original.promptSha256 !== record.promptSha256 || JSON.stringify(original.generationRecord) !== JSON.stringify(proof)) throw new Error('XIONGNU_GENERATION_PROOF_MISMATCH')
      if (!record.appearanceSourceIds?.length || JSON.stringify(original.sourceIds) !== JSON.stringify(record.appearanceSourceIds)) throw new Error('XIONGNU_APPEARANCE_SOURCES_MISSING')
      if (!record.rawPath || !safe(record.rawPath) || !record.rawBytes || record.rawBytes !== proof.rawBytes || !record.rawSha256 || !hashValid(record.rawSha256)) throw new Error('XIONGNU_RAW_EVIDENCE_MISSING')
      const retained = await json<AssetSourceEvidence['generationRecord']>(path.join(collectionDir, 'evidence/xiongnu-generation.json'))
      if (JSON.stringify(retained) !== JSON.stringify(proof)) throw new Error('XIONGNU_RETAINED_GENERATION_MISMATCH')
    }
    if (original.tool && original.tool !== record.tool) throw new Error(`SOURCE_TOOL_MISMATCH: ${record.assetId}`)
    if (original.refinement) {
      const parent = original.refinement as { upstreamSha256: string; upstreamBytes: number; upstreamFile: string; scriptSha256: string }
      const upstream = await json<{ assets: Array<{ file: string; sha256: string; bytes: number }> }>(path.join(collectionDir, 'evidence/upstream-set-manifest.json'))
      if (JSON.stringify(original.refinement) !== JSON.stringify(record.sourceConversion) || !upstream.assets.some(item => item.file === parent.upstreamFile && item.sha256 === parent.upstreamSha256 && item.bytes === parent.upstreamBytes)) throw new Error(`SOURCE_REFINEMENT_PARENT_MISMATCH: ${record.assetId}`)
      if (sha256(await readFile(path.join(collectionDir, 'evidence/refine-environment.py'))) !== parent.scriptSha256) throw new Error(`SOURCE_REFINEMENT_SCRIPT_MISMATCH: ${record.assetId}`)
    }
  }
}

/** Compile an audited collection delivery; never reads or copies an already compiled package. */
export async function buildYuezhiPackage(collectionDir: string, outputDir: string, repoRoot: string): Promise<{ assets: number; objects: number; submissionId: string }> {
  const problems = await validateCollectionHandoff(createNodeReader(collectionDir))
  if (problems.length) throw new Error(`YUEZHI_COLLECTION_INVALID: ${problems.map(problem => `${problem.path}: ${problem.message}`).join('; ')}`)
  const [handoff, inputStory, sourceFile, manifest, evidence, plan, book, narrative, perspectives] = await Promise.all([
    json<HandoffManifest>(path.join(collectionDir, 'handoff.json')),
    json<StoryFile>(path.join(collectionDir, 'story.json')),
    json<SourcesFile>(path.join(collectionDir, 'sources.json')),
    json<{ assets: CollectionAsset[] }>(path.join(collectionDir, 'assets/asset-manifest.json')),
    json<YuezhiSourceEvidence>(path.join(collectionDir, 'source-evidence.json')),
    json<YuezhiScenePlan>(path.join(collectionDir, 'scene-plan.json')),
    json<{ storyId: string; contentRevision: number; scenes: Parameters<typeof checkBookReferences>[0]['scenes'] }>(path.join(collectionDir, 'book.json')),
    json<{ storyId: string; contentRevision: number; scenes: unknown }>(path.join(collectionDir, 'narrative.json')),
    json<PerspectiveFile>(path.join(collectionDir, 'perspectives.json')),
  ])
  for (const [name, value] of Object.entries({ sources: sourceFile, evidence, plan, scene: plan.scene, book, narrative, perspectives }))
    if (value.storyId !== inputStory.storyId || value.contentRevision !== inputStory.contentRevision) throw new Error(`YUEZHI_REVISION_MISMATCH: ${name}`)
  if (JSON.stringify(narrative.scenes) !== JSON.stringify(book.scenes)) throw new Error('YUEZHI_NARRATIVE_MISMATCH')
  await checkSourceModules(collectionDir, evidence)
  const scene = structuredClone(plan.scene)
  const story = structuredClone(inputStory)
  const sourceIds = new Set(sourceFile.sources.map(item => item.id))
  checkBookReferences(book, sourceIds, new Set(scene.assets.map(item => item.id)))
  checkPerspectives(perspectives, book)
  if (manifest.assets.length !== scene.assets.length || evidence.assets.length !== scene.assets.length) throw new Error('YUEZHI_ASSET_COVERAGE_MISMATCH')
  const provenance: unknown[] = []
  const lineage: unknown[] = []
  const tasks: unknown[] = []
  const adoptedTaskIds = new Set<string>()
  for (const asset of scene.assets) {
    const input = manifest.assets.find(item => item.assetId === asset.id)
    const record = evidence.assets.find(item => item.assetId === asset.id)
    const transform = plan.assetTransforms.find(item => item.assetId === asset.id)
    if (!input || !record || !transform || input.path !== record.path || input.sha256 !== record.sha256) throw new Error(`YUEZHI_ASSET_INPUT_MISSING: ${asset.id}`)
    const bytes = await readFile(path.join(collectionDir, input.path))
    assertAssetDigest(bytes, record, input.path)
    await checkSourceRecord(collectionDir, record)
    if (record.rawPath) {
      if (!safe(record.rawPath) || !record.rawSha256 || !record.rawBytes) throw new Error(`RAW_INPUT_INVALID: ${asset.id}`)
      assertAssetDigest(await readFile(path.join(collectionDir, record.rawPath)), { sha256: record.rawSha256, bytes: record.rawBytes }, record.rawPath)
    }
    if (record.taskId && (input.generation?.taskId !== record.taskId || input.generation.provider !== record.provider)) throw new Error(`YUEZHI_TASK_MISMATCH: ${asset.id}`)
    if (record.provider.startsWith('Tripo') && (!record.taskId || !Number.isFinite(record.creditsConsumed) || record.creditsConsumed! < 0)) throw new Error(`YUEZHI_TRIPO_RECORD_MISSING: ${asset.id}`)
    if (record.taskId) {
      if (adoptedTaskIds.has(record.taskId)) throw new Error(`YUEZHI_TASK_DUPLICATE: ${record.taskId}`)
      adoptedTaskIds.add(record.taskId)
    }
    const converted = normalizeYuezhiGlb(bytes, transform.targetHeightM)
    if (!safe(asset.path)) throw new Error(`PACKAGE_PATH_INVALID: ${asset.path}`)
    await mkdir(path.dirname(path.join(outputDir, asset.path)), { recursive: true })
    await writeFile(path.join(outputDir, asset.path), converted.bytes)
    asset.dimensionsM = converted.dimensions
    asset.rights = input.rights
    for (const object of scene.objects.filter(item => item.render.type === 'asset' && item.render.assetId === asset.id)) {
      object.dimensionsM = converted.dimensions
      const dimensions = story.claims.find(claim => claim.id === object.evidence.dimensions[0])
      if (dimensions?.evidenceType !== 'illustrative') throw new Error(`YUEZHI_DIMENSION_CLAIM_INVALID: ${object.id}`)
      dimensions.value = converted.dimensions
    }
    const outputSha256 = sha256(converted.bytes)
    provenance.push({ assetId: asset.id, path: asset.path, sha256: outputSha256, bytes: converted.bytes.length, inputSha256: record.sha256, rawSha256: record.rawSha256, source: record.sourcePath, collectionPath: input.path, provider: record.provider, taskId: record.taskId, creditsConsumed: record.creditsConsumed, requestDigest: record.requestDigest ?? null, promptSha256: record.promptSha256 ?? null, model: record.model ?? null, appearanceSourceIds: record.appearanceSourceIds ?? [], tool: record.tool, sourceConversion: record.sourceConversion, generationEvidence: record.generationEvidence, status: 'illustrative', rights: record.rights, historicalStatus: record.historicalStatus, conversion: { operation: 'translate bottom-center to origin; uniform display scale; meshes and textures preserved', offset: converted.offset, scale: converted.factor, targetHeightM: transform.targetHeightM } })
    lineage.push({ assetId: asset.id, path: asset.path, sha256: outputSha256, inputPath: input.path, inputSha256: record.sha256, taskId: record.taskId, adoptedRevision: 1 })
    if (record.taskId) tasks.push({ origin: 'collector', assetId: asset.id, provider: record.provider, taskId: record.taskId, requestDigest: record.requestDigest ?? null, model: record.model ?? null, promptSha256: record.promptSha256 ?? null, sourceRecordPath: record.sourceRecordPath, inputSha256: record.sha256, outputSha256, creditsConsumed: record.creditsConsumed, generationEvidence: record.generationEvidence, adopted: true })
  }
  const copiedEvidence = handoff.files.filter(file => file.path.startsWith('evidence/')).map(file => file.path)
  const copiedReferences = handoff.files.filter(file => file.path.startsWith('references/')).map(file => file.path)
  for (const file of ['sources.json', 'book.json', 'narrative.json', 'perspectives.json', 'source-evidence.json', ...copiedReferences, ...copiedEvidence]) {
    await mkdir(path.dirname(path.join(outputDir, file)), { recursive: true })
    await copyFile(path.join(collectionDir, file), path.join(outputDir, file))
  }
  await copyFile(path.join(collectionDir, 'evidence/figure-manifest.json'), path.join(outputDir, 'figure-manifest.json'))
  await writeJson(outputDir, 'story.json', story)
  await writeJson(outputDir, 'scene.json', scene)
  await writeJson(outputDir, 'asset-provenance.json', { storyId: story.storyId, contentRevision: story.contentRevision, status: 'draft', realTripoAssetsReceived: tasks.length >= 3, newPaidGenerationPerformed: evidence.assets.some(asset => Boolean(asset.generationRecord)), evidenceScope: 'Saved generation records and matching delivered files; old teammate task/account metadata were not independently queried.', accountEvidence: evidence.accountEvidence, assets: provenance, environment: evidence.environment })
  await writeJson(outputDir, 'asset-lineage.json', { storyId: story.storyId, contentRevision: story.contentRevision, assets: lineage })
  await writeJson(outputDir, 'generation-report.json', { storyId: story.storyId, contentRevision: story.contentRevision, newPaidGenerationPerformed: evidence.assets.some(asset => Boolean(asset.generationRecord)), realProviderGenerationPerformed: tasks.length >= 3, realProviderTasks: tasks, note: 'Collection adopts saved Tripo tasks and delivered files. Actual request digest/model/prompt are present only where retained generation records support them; older teammate requests and dollar cost are not invented.' })
  const validation = await validateScenePackage(createNodeReader(outputDir), { checkGlbBounds: true })
  const errors = validation.diagnostics.filter(item => item.severity === 'error')
  if (errors.length) throw new Error(`YUEZHI_PACKAGE_INVALID: ${errors.map(item => `${item.file}:${item.field}: ${item.message}`).join('; ')}`)
  const unresolved = ['人物外观、具体布局与马具均为示意，需用户视觉审核', '古籍底本校勘与史料负责人审核待完成', 'Tripo及壁画公开使用权利待确认', '完整浏览器故事、组合场景与动态角色视角验收证据待补齐']
  await writeJson(outputDir, 'quality-report.json', { storyId: story.storyId, contentRevision: story.contentRevision, status: 'needs_review', diagnostics: validation.diagnostics, requiredReviews: ['historical_review', 'asset_review', 'world_review', 'viewer_acceptance', 'rights_review'], unresolved, viewerAcceptance: null, publicationReady: false })
  const files = ['scene.json', 'story.json', 'sources.json', 'book.json', 'narrative.json', 'perspectives.json', 'figure-manifest.json', 'source-evidence.json', 'asset-provenance.json', 'asset-lineage.json', 'generation-report.json', 'quality-report.json', ...copiedReferences, ...copiedEvidence, ...scene.assets.map(asset => asset.path)]
  const fileDigests = await digests(outputDir, files)
  const inputSnapshotHash = sha256(await readFile(path.join(collectionDir, 'handoff.json')))
  const releaseId = `release-${sha256(JSON.stringify([inputSnapshotHash, fileDigests])).slice(0, 20)}`
  await writeJson(outputDir, 'release.json', { formatVersion: '1.0.0', storyId: story.storyId, contentRevision: story.contentRevision, sceneRevision: scene.sceneRevision, releaseId, kind: 'local-viewer-candidate', qualityStatus: 'needs_review', inputSubmissionIds: [handoff.submissionId], inputSnapshotHash, files: fileDigests, registryCompatible: false, knownLimitations: unresolved })
  await writeJson(outputDir, 'build-manifest.json', { formatVersion: '1.0.0', storyId: story.storyId, contentRevision: story.contentRevision, status: 'needs_review', compiler: 'processing/src/yuezhi-package.ts', input: { path: path.relative(repoRoot, collectionDir).replaceAll('\\', '/'), submissionId: handoff.submissionId, snapshotHash: inputSnapshotHash }, files: await digests(outputDir, [...files, 'release.json']) })
  const audit = await auditYuezhiPackage(outputDir, collectionDir)
  if (!audit.ok) throw new Error(`YUEZHI_BUILD_AUDIT_FAILED: ${audit.errors.join('; ')}`)
  return { assets: scene.assets.length, objects: scene.objects.length, submissionId: handoff.submissionId }
}

export interface YuezhiAudit { ok: boolean; publicationReady: false; errors: string[]; pendingReviews: string[]; assetCount: number; tripoTaskIds: string[] }
/** Technical integrity is distinct from historical, rights and user acceptance. */
export async function auditYuezhiPackage(outputDir: string, collectionDir?: string): Promise<YuezhiAudit> {
  const errors: string[] = []
  const result: YuezhiAudit = { ok: false, publicationReady: false, errors, pendingReviews: [], assetCount: 0, tripoTaskIds: [] }
  const reader = createNodeReader(outputDir)
  try {
    const build = await json<{ storyId: string; contentRevision: number; status: string; input: { snapshotHash: string; submissionId: string }; files: FileDigest[] }>(path.join(outputDir, 'build-manifest.json'))
    const required = ['scene.json', 'story.json', 'sources.json', 'book.json', 'narrative.json', 'perspectives.json', 'asset-provenance.json', 'asset-lineage.json', 'source-evidence.json', 'generation-report.json', 'quality-report.json', 'release.json']
    const listed = new Set<string>()
    for (const file of build.files) {
      if (!safe(file.path) || listed.has(file.path)) { errors.push(`MANIFEST_PATH: ${file.path}`); continue }
      listed.add(file.path)
      const bytes = await reader.readBinary(file.path)
      if (!bytes || bytes.byteLength !== file.bytes || sha256(Buffer.from(bytes)) !== file.sha256) errors.push(`ARTIFACT_HASH_MISMATCH: ${file.path}`)
    }
    for (const file of required) if (!listed.has(file)) errors.push(`ARTIFACT_MISSING: ${file}`)
    if (errors.length) return result
    const validation = await validateScenePackage(reader, { checkGlbBounds: true })
    errors.push(...validation.diagnostics.filter(item => item.severity === 'error').map(item => `PACKAGE: ${item.file}:${item.field}: ${item.message}`))
    const documents = await Promise.all(required.filter(file => !['release.json'].includes(file)).map(async file => ({ file, data: await json<{ storyId: string; contentRevision: number }>(path.join(outputDir, file)) })))
    for (const { file, data } of documents) if (data.storyId !== build.storyId || data.contentRevision !== build.contentRevision) errors.push(`REVISION_MISMATCH: ${file}`)
    const scene = validation.scene
    if (!scene || !validation.sources) return result
    const provenance = await json<{ assets: Array<{ assetId: string; path: string; sha256: string; inputSha256: string; provider: string; taskId: string | null; rawSha256: string | null; creditsConsumed: number | null; requestDigest: string | null; promptSha256: string | null; model: string | null; appearanceSourceIds: string[]; sourceConversion: unknown; conversion: { targetHeightM: number | null } }> }>(path.join(outputDir, 'asset-provenance.json'))
    const evidence = await json<YuezhiSourceEvidence>(path.join(outputDir, 'source-evidence.json'))
    const lineage = await json<{ assets: Array<{ assetId: string; sha256: string; inputSha256: string; taskId: string | null }> }>(path.join(outputDir, 'asset-lineage.json'))
    const generation = await json<{ realProviderTasks: Array<{ assetId: string; taskId: string; inputSha256: string; outputSha256: string; adopted: boolean; origin: string; provider: string; creditsConsumed: number | null; requestDigest: string | null; model: string | null; promptSha256: string | null }> }>(path.join(outputDir, 'generation-report.json'))
    const quality = await json<{ status: string; unresolved: string[]; publicationReady: boolean; viewerAcceptance: unknown }>(path.join(outputDir, 'quality-report.json'))
    const release = await json<{ storyId: string; contentRevision: number; qualityStatus: string; inputSnapshotHash: string; files: FileDigest[] }>(path.join(outputDir, 'release.json'))
    if (build.status !== 'needs_review' || quality.status !== 'needs_review' || quality.publicationReady !== false || release.qualityStatus !== 'needs_review') errors.push('UNPROVEN_ACCEPTANCE_STATUS')
    if (release.storyId !== build.storyId || release.contentRevision !== build.contentRevision || release.inputSnapshotHash !== build.input.snapshotHash) errors.push('RELEASE_INPUT_MISMATCH')
    for (const file of release.files) if (!build.files.some(item => item.path === file.path && item.sha256 === file.sha256 && item.bytes === file.bytes)) errors.push(`RELEASE_ARTIFACT_MISMATCH: ${file.path}`)
    result.pendingReviews = quality.unresolved
    result.assetCount = scene.assets.length
    for (const asset of scene.assets) {
      const record = provenance.assets.find(item => item.assetId === asset.id)
      const input = evidence.assets.find(item => item.assetId === asset.id)
      const parent = lineage.assets.find(item => item.assetId === asset.id)
      const file = build.files.find(item => item.path === asset.path)
      if (!record || !input || !parent || !file || record.path !== asset.path || record.sha256 !== file.sha256 || record.inputSha256 !== input.sha256 || parent.sha256 !== file.sha256 || parent.inputSha256 !== input.sha256 || record.taskId !== input.taskId || parent.taskId !== input.taskId) errors.push(`ASSET_LINEAGE_MISMATCH: ${asset.id}`)
      if (record && input && (record.provider !== input.provider || record.rawSha256 !== input.rawSha256 || record.creditsConsumed !== input.creditsConsumed || record.requestDigest !== (input.requestDigest ?? null) || record.promptSha256 !== (input.promptSha256 ?? null) || record.model !== (input.model ?? null) || JSON.stringify(record.appearanceSourceIds) !== JSON.stringify(input.appearanceSourceIds ?? []) || JSON.stringify(record.sourceConversion) !== JSON.stringify(input.sourceConversion))) errors.push(`ASSET_PROVENANCE_MISMATCH: ${asset.id}`)
      if (input?.provider.startsWith('Tripo')) {
        const task = generation.realProviderTasks.find(item => item.assetId === asset.id)
        if (!task || !task.adopted || task.taskId !== input.taskId || task.inputSha256 !== input.sha256 || task.outputSha256 !== file?.sha256 || task.origin !== 'collector' || task.provider !== input.provider || task.creditsConsumed !== input.creditsConsumed || task.requestDigest !== (input.requestDigest ?? null) || task.model !== (input.model ?? null) || task.promptSha256 !== (input.promptSha256 ?? null)) errors.push(`TRIPO_ADOPTION_MISSING: ${asset.id}`)
        else result.tripoTaskIds.push(task.taskId)
      }
    }
    if (provenance.assets.length !== scene.assets.length || evidence.assets.length !== scene.assets.length || lineage.assets.length !== scene.assets.length) errors.push('ASSET_COVERAGE_MISMATCH')
    const expectedTasks = evidence.assets.filter(asset => asset.provider.startsWith('Tripo')).length
    if (expectedTasks < 3 || result.tripoTaskIds.length !== expectedTasks || new Set(result.tripoTaskIds).size !== expectedTasks) errors.push('TRIPO_TASK_COVERAGE_MISMATCH')
    if (!scene.objects.some(object => object.id === 'obj-mural-horse' && object.render.type === 'asset' && object.render.assetId === 'asset-mural-horse')) errors.push('MURAL_HORSE_NOT_IN_SCENE')
    if (!scene.objects.some(object => object.id === 'obj-xiongnu' && object.render.type === 'asset' && object.render.assetId === 'asset-xiongnu')) errors.push('XIONGNU_NOT_IN_SCENE')
    const book = await json<Parameters<typeof checkBookReferences>[0]>(path.join(outputDir, 'book.json'))
    checkBookReferences(book, new Set(validation.sources.sources.map(item => item.id)), new Set(scene.assets.map(item => item.id)))
    const perspectives = await json<PerspectiveFile>(path.join(outputDir, 'perspectives.json'))
    checkPerspectives(perspectives, book)
    const narrative = await json<{ scenes: unknown }>(path.join(outputDir, 'narrative.json'))
    if (JSON.stringify(narrative.scenes) !== JSON.stringify(book.scenes)) errors.push('NARRATIVE_MISMATCH')
    await checkSourceModules(outputDir, evidence)
    for (const asset of evidence.assets) await checkSourceRecord(outputDir, asset)
    if (collectionDir) {
      const inputProblems = await validateCollectionHandoff(createNodeReader(collectionDir))
      errors.push(...inputProblems.map(problem => `INPUT: ${problem.path}: ${problem.message}`))
      const handoffBytes = await readFile(path.join(collectionDir, 'handoff.json'))
      const handoff = JSON.parse(handoffBytes.toString('utf8')) as HandoffManifest
      if (sha256(handoffBytes) !== build.input.snapshotHash || handoff.submissionId !== build.input.submissionId) errors.push('INPUT_SNAPSHOT_MISMATCH')
      for (const asset of evidence.assets) {
        if (!handoff.files.some(file => file.path === asset.path && file.sha256 === asset.sha256 && file.bytes === asset.bytes)) errors.push(`INPUT_ASSET_MISMATCH: ${asset.assetId}`)
        if (asset.rawPath) {
          if (!handoff.files.some(file => file.path === asset.rawPath && file.sha256 === asset.rawSha256 && file.bytes === asset.rawBytes)) errors.push(`INPUT_RAW_MISMATCH: ${asset.assetId}`)
          else assertAssetDigest(await readFile(path.join(collectionDir, asset.rawPath)), { sha256: asset.rawSha256!, bytes: asset.rawBytes! }, asset.rawPath)
        }
        const record = provenance.assets.find(item => item.assetId === asset.assetId)
        if (record) {
          const bytes = await readFile(path.join(collectionDir, asset.path))
          assertAssetDigest(bytes, asset, asset.path)
          const derived = normalizeYuezhiGlb(bytes, record.conversion.targetHeightM)
          if (sha256(derived.bytes) !== record.sha256) errors.push(`PROCESSING_CONVERSION_MISMATCH: ${asset.assetId}`)
        }
      }
    }
    result.ok = errors.length === 0
  } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  return result
}
