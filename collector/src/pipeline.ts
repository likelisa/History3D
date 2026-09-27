import { randomUUID } from 'node:crypto'

import type { SourceEntry, SourcesFile, StoryFile } from '../../contracts/src/types.ts'
import { dedupeHits } from './dedupe.ts'
import { judgeNarrowQuestions, type NarrowJudge } from './jev.ts'
import { buildCandidate, type ClaimEdit, writeCandidate } from './output.ts'
import type { CollectionCandidate } from './types.ts'
import { policyIsApproved, screenEvidence, type HumanReview, type RubricPolicy } from './policy.ts'
import { createSearchPlan, runSearch, searchApprovalError, validateSearchSnapshot, type SearchApproval, type SearchProvider, type SearchRun, type SearchSnapshot } from './search.ts'
import type { EvidenceCandidate, FeedbackRecord, RevisionRecord, SearchHit, SourceCluster, Stage, StageEvent } from './types.ts'

export interface SourceRecheck {
  sourceId: string
  status: 'ok' | 'changed' | 'unreachable'
  checkedAt: string
  note: string
}

export interface EvidenceReview {
  candidates: EvidenceCandidate[]
  proposedEdits: ClaimEdit[]
  unresolved: string[]
}

export interface EvidenceExtractor {
  extract(input: {
    feedback: FeedbackRecord
    story: StoryFile
    sources: SourcesFile
    clusters: SourceCluster[]
    oldSourceChecks: SourceRecheck[]
  }): Promise<EvidenceReview>
}

export interface PipelineOptions {
  revisionId?: string
  onProgress?: (record: RevisionRecord) => Promise<void>
  onResearch?: (record: RevisionRecord, research: {
    plan: ReturnType<typeof createSearchPlan>
    search: SearchRun
    clusters: SourceCluster[]
    oldSourceChecks: SourceRecheck[]
  }) => Promise<void>
  feedback: FeedbackRecord
  story: StoryFile
  sources: SourcesFile
  root: string
  persistCandidate?: (candidate: CollectionCandidate) => Promise<string>
  references: Array<{ path: string; bytes: Uint8Array }>
  providers: SearchProvider[]
  searchApproval?: SearchApproval | null
  searchSnapshot?: SearchSnapshot | null
  recheckSource: (source: SourceEntry) => Promise<SourceRecheck>
  extractor: EvidenceExtractor
  judge: NarrowJudge | null
  policy: RubricPolicy
  reviews: Map<string, HumanReview>
  withdrawalReviews: Map<string, { reviewer: string; reason: string; evidenceRefs: string[] }>
  verifyExcerpt: (candidate: EvidenceCandidate) => Promise<{ verified: boolean; evidenceRef: string }>
  verifyOpposingExcerpt?: (candidate: EvidenceCandidate, excerpt: string, index: number) => Promise<{ verified: boolean; evidenceRef: string }>
  coverageReview: { reviewer: string; reason: string } | null
  rebaseReview?: { feedbackId: string; targetRevision: number; reviewer: string; reason: string } | null
  translations?: string[]
  controversySignal?: string | null
}

function event(stage: Stage, revision: number, status: StageEvent['status'], evidence: string[], note: string): StageEvent {
  return { stage, at: new Date().toISOString(), inputRevision: revision, status, evidence, note }
}

function oldHit(source: SourceEntry): SearchHit | null {
  if (!source.locator.url) return null
  return {
    provider: 'previous-revision', queryId: 'old-source', title: source.title, url: source.locator.url,
    snippet: source.excerpt, sourceType: source.type, author: null, publishedAt: null, doi: null,
    rights: source.rights, retrievedAt: new Date().toISOString(),
  }
}

async function recordStage(options: PipelineOptions, record: RevisionRecord, item: StageEvent): Promise<void> {
  record.stages.push(item)
  await options.onProgress?.(structuredClone(record))
}

async function stop(options: PipelineOptions, record: RevisionRecord, stage: Stage, status: 'blocked' | 'needs_human', evidence: string[], note: string): Promise<RevisionRecord> {
  record.status = status
  record.unresolved.push(note)
  await recordStage(options, record, event(stage, record.baseRevision, status, evidence, note))
  return record
}

export async function runRevision(options: PipelineOptions): Promise<RevisionRecord> {
  const { feedback, story, sources } = options
  if (feedback.status !== 'ready') throw new Error('反馈未定位，必须先澄清')
  if (story.storyId !== sources.storyId || story.contentRevision !== sources.contentRevision) throw new Error('基线版本不一致')
  if (feedback.context.storyId !== story.storyId) throw new Error('反馈目标故事与基线不一致')
  const record: RevisionRecord = {
    id: options.revisionId ?? randomUUID(), feedbackId: feedback.id, storyId: story.storyId, baseRevision: story.contentRevision,
    status: 'running', stages: [], unresolved: [], candidatePath: null, publishedPath: null,
  }
  let snapshot: SearchSnapshot | null = null
  if (options.searchSnapshot) {
    try { snapshot = structuredClone(options.searchSnapshot) }
    catch { return stop(options, record, 'P', 'blocked', [], '离线检索快照无法安全复制') }
  }
  const reportedRevision = feedback.context.contentRevision
  if (reportedRevision !== undefined && reportedRevision !== story.contentRevision) {
    if (reportedRevision > story.contentRevision) {
      return stop(options, record, 'P', 'blocked', [], '反馈指向的资料版本晚于当前基线，不能自动处理')
    }
    const review = options.rebaseReview
    if (!review || review.feedbackId !== feedback.id || review.targetRevision !== story.contentRevision ||
        !review.reviewer.trim() || !review.reason.trim()) {
      return stop(options, record, 'P', 'needs_human', [],
        `反馈来自旧版 ${reportedRevision}，当前为 ${story.contentRevision}；需人工确认问题仍适用后重新规划`)
    }
  }
  const plan = snapshot?.approval?.plan ?? options.searchApproval?.plan ?? createSearchPlan(feedback, story, { translations: options.translations, controversySignal: options.controversySignal })
  if (plan.storyId !== story.storyId || plan.baseRevision !== story.contentRevision) {
    return stop(options, record, 'P', 'blocked', [], '检索计划与当前故事版本不一致')
  }
  if (snapshot) {
    if (options.providers.length) return stop(options, record, 'P', 'blocked', [], '离线检索快照不得同时配置在线搜索源')
    if (options.searchApproval) {
      let sameApproval = false
      try { sameApproval = JSON.stringify(options.searchApproval) === JSON.stringify(snapshot.approval) }
      catch { /* A non-serializable approval must fail closed. */ }
      if (!sameApproval) return stop(options, record, 'P', 'blocked', [], '离线检索快照与当前批准记录不一致')
    }
    const snapshotError = validateSearchSnapshot(snapshot, plan, feedback.id)
    if (snapshotError) return stop(options, record, 'P', 'blocked', [], snapshotError)
  } else {
    const searchGate = searchApprovalError(plan, options.providers, options.searchApproval ?? null, feedback.id)
    if (searchGate) return stop(options, record, 'P', 'needs_human', [], searchGate)
  }
  await recordStage(options, record, event('P', record.baseRevision, 'closed', plan.queries.map((item) => item.id),
    reportedRevision !== undefined && reportedRevision !== story.contentRevision
      ? `旧版反馈 ${reportedRevision} 已由 ${options.rebaseReview!.reviewer} 对照当前版 ${story.contentRevision} 确认仍适用：${options.rebaseReview!.reason}`
      : '检索计划已形成'))

  const searched = snapshot ? structuredClone(snapshot.run) : await runSearch(plan, options.providers, options.searchApproval)
  const oldSourceChecks: SourceRecheck[] = []
  for (const source of sources.sources) {
    try {
      const check = await options.recheckSource(source)
      oldSourceChecks.push(check.sourceId === source.id ? check : {
        sourceId: source.id, status: 'unreachable', checkedAt: new Date().toISOString(), note: '复查结果 ID 不匹配',
      })
    }
    catch { oldSourceChecks.push({ sourceId: source.id, status: 'unreachable', checkedAt: new Date().toISOString(), note: '重新检查失败' }) }
  }
  const searchEvidence = searched.trace.map((item) => `${item.queryId}:${item.provider}:${item.status}:${item.hitCount}`)
  searchEvidence.push(...oldSourceChecks.map((item) => `${item.sourceId}:${item.status}`))
  const gaps = [...searched.coverageGaps, ...oldSourceChecks.filter((item) => item.status !== 'ok').map((item) => `${item.sourceId} 旧来源 ${item.status}`)]
  if (searched.hits.length === 0 && sources.sources.length === 0) {
    return stop(options, record, 'S', 'needs_human', searchEvidence, '新旧搜索均无可定位来源')
  }
  const coverageApproved = Boolean(options.coverageReview?.reviewer.trim() && options.coverageReview.reason.trim())
  if (gaps.length && !coverageApproved) record.unresolved.push(`搜索覆盖或旧来源复查有缺口：${gaps.join('；')}`)
  await recordStage(options, record, event('S', record.baseRevision, 'closed', searchEvidence,
    gaps.length ? `${coverageApproved ? `覆盖缺口由 ${options.coverageReview!.reviewer} 明示接受：${options.coverageReview!.reason}` : '覆盖缺口待筛选阶段处理'}；${gaps.join('；')}` : '新旧来源已检索和复查'))

  const clusters = dedupeHits([...searched.hits, ...sources.sources.map(oldHit).filter((hit): hit is SearchHit => hit !== null)])
  await options.onResearch?.(structuredClone(record), { plan, search: searched, clusters, oldSourceChecks })
  await recordStage(options, record, event('D', record.baseRevision, 'closed', clusters.map((item) => `${item.key}:mirrors=${item.mirrors.length}`), '按 DOI/URL 去重，保留镜像轨迹'))

  let review: EvidenceReview
  try { review = await options.extractor.extract({ feedback, story, sources, clusters, oldSourceChecks }) }
  catch { return stop(options, record, 'E', 'blocked', [], '证据抽取失败，未生成断言') }
  if (review.unresolved.length || review.proposedEdits.length === 0) {
    return stop(options, record, 'E', 'needs_human', review.candidates.map((item) => item.id), `证据不足或变更未定：${review.unresolved.join('；') || '没有可审查的变更'}`)
  }
  const clusterUrls = new Set(clusters.flatMap((cluster) => [cluster.primary.url, ...cluster.mirrors.map((mirror) => mirror.url)]))
  const verifiedExcerpts: string[] = []
  for (const candidate of review.candidates) {
    if (!candidate.source.locator.url || !clusterUrls.has(candidate.source.locator.url) || !candidate.originalLocation.trim() || !candidate.supportExcerpt.trim()) {
      return stop(options, record, 'E', 'blocked', [candidate.id], '候选断言无法回溯到已检索来源及原文位置')
    }
    try {
      const verification = await options.verifyExcerpt(candidate)
      if (!verification.verified || !verification.evidenceRef.trim()) {
        return stop(options, record, 'E', 'needs_human', [candidate.id], '摘录与原文未完成独立核对')
      }
      verifiedExcerpts.push(`${candidate.id}:${verification.evidenceRef}`)
    } catch {
      return stop(options, record, 'E', 'blocked', [candidate.id], '摘录核对程序失败')
    }
    for (const [index, excerpt] of candidate.opposingExcerpts.entries()) {
      if (!excerpt.trim() || !options.verifyOpposingExcerpt) {
        return stop(options, record, 'E', 'needs_human', [candidate.id], '反向摘录缺少可定位原文核对，不能交给 Jev 判断')
      }
      try {
        const verification = await options.verifyOpposingExcerpt(candidate, excerpt, index)
        if (!verification.verified || !verification.evidenceRef.trim()) {
          return stop(options, record, 'E', 'needs_human', [candidate.id], '反向摘录未完成独立原文核对')
        }
        verifiedExcerpts.push(`${candidate.id}:opposing-${index}:${verification.evidenceRef}`)
      } catch {
        return stop(options, record, 'E', 'blocked', [candidate.id], '反向摘录核对程序失败')
      }
    }
  }
  await recordStage(options, record, event('E', record.baseRevision, 'closed', [
    ...review.candidates.map((item) => `${item.id}:${item.source.id}:${item.originalLocation}`),
    ...verifiedExcerpts,
  ], '候选断言和来源摘录已核对，等待窄判断'))

  const narrowQuestions = review.candidates.flatMap((item) => item.opposingExcerpts.map((excerpt, index) => ({
    id: `narrow-${item.id}${index ? `-${index + 1}` : ''}`, claimId: item.claim.id,
    question: `只比较这条窄断言“${item.claim.statement}”：A 是否更直接支持其成立，还是 B 更直接削弱其成立？若两段摘录不足以判断，选 unclear。不要推断摘录之外的历史事实。`,
    evidenceA: item.supportExcerpt, evidenceB: excerpt,
  })))
  const judged = await judgeNarrowQuestions(narrowQuestions, options.judge)
  if (judged.unresolved.length) return stop(options, record, 'J', judged.failed ? 'blocked' : 'needs_human', judged.decisions.map((item) => item.questionId), judged.unresolved.join('；'))
  await recordStage(options, record, event('J', record.baseRevision, 'closed', judged.decisions.map((item) => `${item.questionId}:${item.verdict}`),
    narrowQuestions.length ? '窄判断已记录，结论仍需来源和人审' : '本轮无明确争议题；无需调用 Jev'))

  const decisions = review.candidates.map((candidate) => screenEvidence(
    candidate, options.policy, options.reviews.get(candidate.id) ?? null,
    judged.decisions.filter((item) => item.questionId === `narrow-${candidate.id}` || item.questionId.startsWith(`narrow-${candidate.id}-`)),
  ))
  if (gaps.length && !coverageApproved) {
    return stop(options, record, 'R', 'needs_human', gaps, '搜索覆盖缺口尚无负责人签字，不能生成候选包')
  }
  const withdrawals = review.proposedEdits.filter((edit): edit is Extract<ClaimEdit, { kind: 'withdraw' }> => edit.kind === 'withdraw')
  for (const withdrawal of withdrawals) {
    const approval = options.withdrawalReviews.get(withdrawal.previousClaimId)
    if (!approval?.reviewer.trim() || !approval.reason.trim() || approval.evidenceRefs.length === 0 || !policyIsApproved(options.policy)) {
      return stop(options, record, 'R', 'needs_human', [withdrawal.previousClaimId], '撤回断言缺少政策批准、理由、证据与负责人复核')
    }
  }
  if (decisions.some((item) => item.result !== 'retain')) {
    return stop(options, record, 'R', 'needs_human', decisions.map((item) => `${item.candidateId}:${item.result}:${item.reasons.join('|')}`), '筛选未全部通过，不能输出发布候选')
  }
  await recordStage(options, record, event('R', record.baseRevision, 'closed', decisions.map((item) => `${item.candidateId}:${item.reviewer}`), '逐维评审与政策版本已记录'))

  const approved = new Set(decisions.map((item) => item.candidateId))
  const edits = review.proposedEdits.filter((edit) => edit.kind === 'withdraw' || approved.has(edit.evidence.id))
  if (edits.length !== review.proposedEdits.length) return stop(options, record, 'R', 'needs_human', [], '存在未完成独立审核的撤回或变更')
  try {
    const candidate = buildCandidate(story, sources, edits, options.references)
    record.candidatePath = await (options.persistCandidate ?? ((item) => writeCandidate(options.root, item)))(candidate)
    record.status = 'candidate'
    await recordStage(options, record, event('O', record.baseRevision, 'closed', [record.candidatePath], '候选三件套校验通过；尚未发布或交接 B'))
  } catch {
    return stop(options, record, 'O', 'blocked', [], '输出或契约校验失败；旧发布包未覆盖')
  }
  return record
}
