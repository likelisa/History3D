import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import { validateCollectionHandoff } from '../../contracts/src/handoff-validate.ts'
import type { CollectionAsset, CollectionPlan, HandoffManifest, InformationRequest, ProcessingFeedback, ProcessingIssue } from '../../contracts/src/handoff-types.ts'
import type { SourcesFile, StoryFile } from '../../contracts/src/types.ts'

export interface ImportReceipt { importId: string; jobId: string; status: ProcessingFeedback['status']; feedbackPath: string; snapshotHash: string }
export class ImportError extends Error { constructor(public code: string, message: string) { super(message) } }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const atomicJson = async (file: string, value: unknown): Promise<void> => { const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 2) + '\n'); await rename(tmp, file) }

export async function importCollection(inputDir: string, dataDir: string, idempotencyKey: string): Promise<ImportReceipt> {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ImportError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is required (max 200 characters)')
  const rawHandoff = await json<HandoffManifest>(path.join(inputDir, 'handoff.json'))
  if (!Array.isArray(rawHandoff.files)) throw new ImportError('COLLECTION_INVALID', 'file list missing')
  for (const file of rawHandoff.files) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new ImportError('COLLECTION_INVALID', `unsafe path: ${file.path}`)
    const current = await lstat(path.join(inputDir, file.path)).catch(() => null)
    if (!current?.isFile() || current.isSymbolicLink()) throw new ImportError('COLLECTION_INVALID', `not a regular file: ${file.path}`)
  }
  const problems = await validateCollectionHandoff(createNodeReader(inputDir))
  if (problems.length) throw new ImportError('COLLECTION_INVALID', problems.map((item) => `${item.path}: ${item.message}`).join('\n'))
  const handoff = await json<HandoffManifest>(path.join(inputDir, 'handoff.json'))
  const snapshotHash = digest(JSON.stringify(handoff))
  const importId = `import-${snapshotHash.slice(0, 20)}`
  const keyHash = digest(idempotencyKey)
  const keyDir = path.join(dataDir, 'keys')
  const keyPath = path.join(keyDir, `${keyHash}.json`)
  const importPath = path.join(dataDir, 'imports', importId)
  const submissionIndex = path.join(dataDir, 'submissions', digest(`${handoff.storyId}:${handoff.submissionId}`))
  await mkdir(keyDir, { recursive: true })
  try {
    const previous = await json<{ snapshotHash: string; receipt: ImportReceipt }>(keyPath)
    if (previous.snapshotHash !== snapshotHash) throw new ImportError('IDEMPOTENCY_CONFLICT', 'same Idempotency-Key with different input')
    return previous.receipt
  } catch (error) {
    if (error instanceof ImportError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    const prior = await json<ImportReceipt>(path.join(importPath, 'receipt.json'))
    await atomicJson(keyPath, { snapshotHash, receipt: prior })
    return prior
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  try {
    const existing = await json<{ snapshotHash: string }>(submissionIndex)
    if (existing.snapshotHash !== snapshotHash) throw new ImportError('SUBMISSION_CONFLICT', 'submissionId already used for different input')
  } catch (error) {
    if (error instanceof ImportError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let priorImportId: string | null = null
  if (handoff.supersedesSubmissionId) {
    const priorFile = path.join(dataDir, 'submissions', digest(`${handoff.storyId}:${handoff.supersedesSubmissionId}`))
    try { priorImportId = (await json<{ importId: string }>(priorFile)).importId }
    catch { throw new ImportError('SUPERSEDED_SUBMISSION_MISSING', handoff.supersedesSubmissionId) }
  }
  const staging = `${importPath}.${randomUUID()}.tmp`
  await mkdir(staging, { recursive: true })
  try {
    const sourceDir = path.join(staging, 'source')
    await mkdir(sourceDir)
    for (const file of handoff.files) {
      const source = path.join(inputDir, file.path)
      const target = path.join(sourceDir, file.path)
      await mkdir(path.dirname(target), { recursive: true })
      await cp(source, target, { dereference: false, errorOnExist: true })
    }
    await cp(path.join(inputDir, 'handoff.json'), path.join(sourceDir, 'handoff.json'))
    const frozenProblems = await validateCollectionHandoff(createNodeReader(sourceDir))
    if (frozenProblems.length) throw new ImportError('SOURCE_CHANGED_DURING_IMPORT', frozenProblems.map((item) => `${item.path}: ${item.message}`).join('\n'))
    const feedback = await inspectCollection(sourceDir, importId, snapshotHash)
    if (priorImportId) {
      const priorRoot = path.join(dataDir, 'imports', priorImportId)
      const priorFeedback = await json<ProcessingFeedback>(path.join(priorRoot, 'feedback', 'feedback.json'))
      const priorHandoff = await json<HandoffManifest>(path.join(priorRoot, 'source', 'handoff.json'))
      reconcileRevision(feedback, handoff, priorFeedback, priorHandoff)
    }
    await mkdir(path.join(staging, 'feedback'))
    await atomicJson(path.join(staging, 'feedback', 'feedback.json'), feedback)
    await writeFile(path.join(staging, 'feedback', 'feedback.md'), renderFeedback(feedback))
    await cp(path.join(sourceDir, 'plan.md'), path.join(staging, 'feedback', 'revised-plan.md'))
    await cp(path.join(sourceDir, 'plan.json'), path.join(staging, 'feedback', 'revised-plan.json'))
    await mkdir(path.join(staging, 'feedback', 'assets'))
    for (const asset of (await json<{ assets: CollectionAsset[] }>(path.join(sourceDir, 'assets', 'asset-manifest.json'))).assets) await cp(path.join(sourceDir, asset.path), path.join(staging, 'feedback', asset.path))
    const receipt: ImportReceipt = { importId, jobId: `job-${snapshotHash.slice(0, 20)}`, status: feedback.status, feedbackPath: `imports/${importId}/feedback`, snapshotHash }
    await atomicJson(path.join(staging, 'receipt.json'), receipt)
    await mkdir(path.dirname(importPath), { recursive: true })
    await rename(staging, importPath)
    await mkdir(path.dirname(submissionIndex), { recursive: true })
    await atomicJson(submissionIndex, { importId, snapshotHash })
    await atomicJson(keyPath, { snapshotHash, receipt })
    return receipt
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}

function reconcileRevision(next: ProcessingFeedback, handoff: HandoffManifest, prior: ProcessingFeedback, priorHandoff: HandoffManifest): void {
  if (prior.storyId !== next.storyId || prior.submissionId !== handoff.supersedesSubmissionId) throw new ImportError('REVISION_MISMATCH', 'revision does not match prior submission')
  const previousFiles = new Map(priorHandoff.files.map((file) => [file.path, file.sha256]))
  const currentFiles = new Map(handoff.files.map((file) => [file.path, file.sha256]))
  const openIds = new Set(next.issues.map((issue) => issue.issueId))
  const claimedIssues = new Set(handoff.resolvesIssueIds ?? [])
  const claimedRequests = new Set(handoff.resolvesRequestIds ?? [])
  for (const issue of prior.issues.filter((item) => item.status === 'open')) {
    if (openIds.has(issue.issueId)) continue
    const request = prior.informationRequests.find((item) => item.relatedIssueIds.includes(issue.issueId))
    const changed = issue.evidenceRefs.some((ref) => currentFiles.get(ref) !== previousFiles.get(ref))
    const claimed = claimedIssues.has(issue.issueId) || Boolean(request && claimedRequests.has(request.requestId))
    if (claimed && changed) {
      next.issues.push({ ...issue, status: 'resolved', evidenceRefs: [...issue.evidenceRefs, `submission:${handoff.submissionId}`] })
      if (request) next.informationRequests.push({ ...request, status: 'resolved' })
    } else {
      next.issues.push({ ...issue, status: 'open', message: `${issue.message}（新版本未明确解决或缺少变更证据）` })
      if (request) next.informationRequests.push(request)
    }
  }
  const openCount = next.issues.filter((item) => item.status === 'open').length
  next.status = openCount ? 'needs_input' : 'needs_review'
  next.summary = `${openCount} 项问题仍待补料，${next.issues.filter((item) => item.status === 'resolved').length} 项在新版本中经确定性复核关闭；必需 AI 审查尚未执行`
}

export async function inspectCollection(sourceDir: string, importId: string, snapshotHash: string): Promise<ProcessingFeedback> {
  const handoff = await json<HandoffManifest>(path.join(sourceDir, 'handoff.json'))
  const story = await json<StoryFile>(path.join(sourceDir, 'story.json'))
  const sources = await json<SourcesFile>(path.join(sourceDir, 'sources.json'))
  const plan = await json<CollectionPlan>(path.join(sourceDir, 'plan.json'))
  const assets = (await json<{ assets: CollectionAsset[] }>(path.join(sourceDir, 'assets', 'asset-manifest.json'))).assets
  const issues: ProcessingIssue[] = []
  const requests: InformationRequest[] = []
  const addIssue = (subjectRef: string, fieldPath: string, message: string, expectedChange: string, evidenceRefs: string[]) => {
    const issueId = `issue-${digest(`${handoff.storyId}:${subjectRef}:${fieldPath}`).slice(0, 16)}`
    issues.push({ issueId, severity: 'blocking', owner: 'collector', subjectRef, fieldPath, message, expectedChange, evidenceRefs, status: 'open' })
    requests.push({ requestId: `request-${issueId.slice(6)}`, relatedIssueIds: [issueId], targetRef: subjectRef, missingInformation: message, whyNeeded: expectedChange, acceptableEvidence: ['来源材料', '参考图', '明确标注为演示设定的说明'], expectedResponseFields: [fieldPath], blocks: ['world-release'], status: 'open' })
  }
  for (const asset of assets) {
    if (asset.scaleStatus === 'unknown') addIssue(asset.assetId, `assets[${asset.assetId}].dimensionsM`, `资产 ${asset.label} 尺寸未知`, '请给出有依据的米制尺寸，或明确批准演示尺度提案', [asset.path])
    if (!asset.rights) addIssue(asset.assetId, `assets[${asset.assetId}].rights`, `资产 ${asset.label} 使用权未说明`, '请说明模型及贴图的使用权', [asset.path])
  }
  for (const briefId of plan.requiredBriefIds) if (!assets.some((asset) => asset.briefId === briefId)) addIssue(briefId, 'plan.requiredBriefIds', `规划要求的主对象 ${briefId} 没有 GLB`, '请补交主资产或明确修改规划', ['plan.json'])
  for (const claim of story.claims) if (claim.valueStatus === 'unknown' && plan.requiredBriefIds.includes(claim.subjectId)) addIssue(claim.subjectId, `claims[${claim.id}]`, `必要对象 ${claim.subjectId} 的判断 ${claim.id} 未定`, '请补来源、确认推断或标注演示设定', ['story.json', 'plan.json'])
  for (const relation of plan.relations) if (relation.kind === 'attachment' && !assets.some((asset) => asset.briefId === relation.parentBriefId)) addIssue(relation.id, `relations[${relation.id}]`, `挂接关系 ${relation.id} 缺载体模型`, '请补载体模型或同意处理层制作演示载体', ['plan.json'])
  const sourceIds = new Set(sources.sources.map((source) => source.id))
  for (const constraint of plan.constraints) if (!constraint.illustrative && constraint.sourceIds.length === 0) addIssue(constraint.id, `constraints[${constraint.id}].sourceIds`, `历史约束 ${constraint.id} 未提供依据`, '请提供可定位的来源或改为演示设定', ['plan.json'])
  for (const asset of assets) for (const sourceId of asset.sourceIds) if (!sourceIds.has(sourceId)) addIssue(asset.assetId, `assets[${asset.assetId}].sourceIds`, `资产引用了缺失来源 ${sourceId}`, '补齐来源', ['assets/asset-manifest.json'])
  const status = issues.length ? 'needs_input' : 'needs_review'
  return {
    feedbackId: `feedback-${snapshotHash.slice(0, 20)}`, importId, submissionId: handoff.submissionId, storyId: handoff.storyId, sourceContentRevision: handoff.sourceContentRevision,
    status, summary: status === 'needs_input' ? `确定性输入审核发现 ${issues.length} 项待补资料；AI 输入审核尚未执行` : '确定性输入审核通过；等待必需 AI 输入审核',
    assetResults: assets.map((asset) => ({ assetId: asset.assetId, inputRevision: asset.assetRevision, inputHash: asset.sha256, result: 'needs_revision', derivedAssetRef: null, operations: [], beforeMetrics: null, afterMetrics: null })),
    issues, planChanges: [], attachments: assets.map((asset) => ({ path: asset.path, kind: 'original', assetId: asset.assetId, parentRevision: asset.assetRevision })), reviewRefs: [], informationRequests: requests, basedOnSnapshotHash: snapshotHash,
  }
}

function renderFeedback(feedback: ProcessingFeedback): string {
  return `# 处理反馈 ${feedback.feedbackId}\n\n${feedback.summary}\n\n输入：${feedback.submissionId}；快照：${feedback.basedOnSnapshotHash}\n\n${feedback.issues.map((issue) => `- ${issue.issueId} ${issue.message}；需要：${issue.expectedChange}；证据：${issue.evidenceRefs.join(', ')}`).join('\n') || '暂无确定性补料项。'}\n\n原始 GLB 见 assets/。修订规划目前与原规划相同，尚未获 A 确认。\n`
}
