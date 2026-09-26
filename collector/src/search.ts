import { createHash } from 'node:crypto'

import type { StoryFile } from '../../contracts/src/types.ts'
import type { FeedbackRecord, SearchHit, SearchPlan, SearchQuery, SearchTrace } from './types.ts'

export interface SearchProvider {
  id: string
  sourceTypes: string[]
  search(query: SearchQuery): Promise<SearchHit[]>
}

export interface SearchRun {
  hits: SearchHit[]
  trace: SearchTrace[]
  coverageGaps: string[]
}

/** Deliberate, auditable permission to send only this exact reviewed plan to these providers. */
export interface SearchApproval {
  feedbackId: string
  reviewedBy: string
  reviewedAt: string
  redactionNote: string
  providerIds: string[]
  plan: SearchPlan
  planSha256: string
}

/** A reviewed search result for offline replay. Hashes detect accidental changes, not forged authorship. */
export interface SearchSnapshot {
  approval: SearchApproval
  run: SearchRun
  runSha256: string
  reviewedBy: string
  reviewedAt: string
  evidenceRef: string
  snapshotSha256: string
}

export function searchPlanSha256(plan: SearchPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

function searchRunSha256(run: SearchRun): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex')
}

function searchSnapshotSha256(snapshot: Omit<SearchSnapshot, 'snapshotSha256'>): string {
  const { approval, run, runSha256, reviewedBy, reviewedAt, evidenceRef } = snapshot
  return createHash('sha256').update(JSON.stringify({
    approval, run, runSha256, reviewedBy, reviewedAt, evidenceRef,
  })).digest('hex')
}

function validDate(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value))
}

function pairKey(queryId: string, providerId: string): string {
  return JSON.stringify([queryId, providerId])
}

function queryRecipientError(plan: SearchPlan, providerIds: readonly string[]): string | null {
  if (!Array.isArray(plan.queries) || plan.queries.length === 0 ||
      new Set(plan.queries.map((query) => query?.id)).size !== plan.queries.length) {
    return '审核后的查询计划为空或查询 ID 重复'
  }
  const allowed = new Set(providerIds)
  const used = new Set<string>()
  for (const query of plan.queries) {
    if (!query || typeof query.id !== 'string' || !query.id.trim() ||
        typeof query.text !== 'string' || !query.text.trim()) return '审核后的查询计划含有空查询'
    if (!Array.isArray(query.providerIds) || query.providerIds.length === 0 ||
        query.providerIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(query.providerIds).size !== query.providerIds.length ||
        query.providerIds.some((id) => !allowed.has(id))) return '每条查询必须指定唯一且获批的接收方'
    for (const id of query.providerIds) used.add(id)
  }
  if (used.size !== allowed.size) return '存在未分配给任何查询的接收方'
  return null
}

function validateSearchRun(approval: SearchApproval, run: SearchRun): string | null {
  const recipientError = queryRecipientError(approval.plan, approval.providerIds)
  if (recipientError) return recipientError
  if (!Array.isArray(run.hits) || !Array.isArray(run.trace) || !Array.isArray(run.coverageGaps) ||
      run.coverageGaps.some((gap) => typeof gap !== 'string')) return '检索快照数据结构不完整'
  const expectedPairs = new Set(approval.plan.queries.flatMap((query) => query.providerIds.map((id) => pairKey(query.id, id))))
  const observedPairs = new Set<string>()
  const counts = new Map<string, number>()
  for (const hit of run.hits) {
    if (!hit || !expectedPairs.has(pairKey(hit.queryId, hit.provider)) ||
        typeof hit.title !== 'string' || !hit.title.trim() || typeof hit.url !== 'string' || !hit.url.trim() ||
        !validDate(hit.retrievedAt)) return '检索快照含未知查询/接收方或不完整命中'
    const pair = pairKey(hit.queryId, hit.provider)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  for (const trace of run.trace) {
    if (!trace) return '检索快照轨迹缺失、重复或不匹配'
    const pair = pairKey(trace.queryId, trace.provider)
    if (!expectedPairs.has(pair) || observedPairs.has(pair) || !validDate(trace.at) ||
        !Number.isSafeInteger(trace.hitCount) || trace.hitCount < 0) return '检索快照轨迹缺失、重复或不匹配'
    observedPairs.add(pair)
    if ((trace.status === 'ok' && (trace.hitCount === 0 || trace.error !== null)) ||
        (trace.status === 'empty' && (trace.hitCount !== 0 || trace.error !== null)) ||
        (trace.status === 'error' && (trace.hitCount !== 0 || typeof trace.error !== 'string' || !trace.error.trim())) ||
        !['ok', 'empty', 'error'].includes(trace.status) ||
        (counts.get(pair) ?? 0) !== trace.hitCount) return '检索快照轨迹与命中数量不匹配'
  }
  if (observedPairs.size !== expectedPairs.size) return '检索快照缺少查询与接收方的完整轨迹'
  return null
}

/** A snapshot is created only after the exact approved public-search run was reviewed. */
export function createSearchSnapshot(approval: SearchApproval, run: SearchRun, reviewedBy: string, evidenceRef: string): SearchSnapshot {
  const unsigned: Omit<SearchSnapshot, 'snapshotSha256'> = {
    approval: structuredClone(approval), run: structuredClone(run), runSha256: searchRunSha256(run),
    reviewedBy, reviewedAt: new Date().toISOString(), evidenceRef,
  }
  const snapshot: SearchSnapshot = { ...unsigned, snapshotSha256: searchSnapshotSha256(unsigned) }
  const error = validateSearchSnapshot(snapshot, approval.plan, approval.feedbackId)
  if (error) throw new Error(error)
  return snapshot
}

export function validateSearchSnapshot(snapshot: SearchSnapshot, plan: SearchPlan, feedbackId: string): string | null {
  try { return validateSearchSnapshotUnchecked(snapshot, plan, feedbackId) }
  catch { return '检索快照结构无效或不可序列化' }
}

function validateSearchSnapshotUnchecked(snapshot: SearchSnapshot, plan: SearchPlan, feedbackId: string): string | null {
  if (!snapshot?.approval || !snapshot.run || typeof snapshot.reviewedBy !== 'string' || !snapshot.reviewedBy.trim() ||
      !validDate(snapshot.reviewedAt) || typeof snapshot.evidenceRef !== 'string' || !snapshot.evidenceRef.trim()) return '检索快照缺少人工审核记录'
  const approval = snapshot.approval
  if (typeof approval.feedbackId !== 'string' || !approval.feedbackId.trim() || approval.feedbackId !== feedbackId ||
      typeof approval.reviewedBy !== 'string' || !approval.reviewedBy.trim() ||
      !validDate(approval.reviewedAt) || typeof approval.redactionNote !== 'string' || !approval.redactionNote.trim()) {
    return '检索快照批准记录与反馈不匹配或不完整'
  }
  if (!Array.isArray(approval.providerIds) || approval.providerIds.length === 0 ||
      approval.providerIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(approval.providerIds).size !== approval.providerIds.length) return '检索快照没有唯一、明确的接收方'
  if (!plan || !approval.plan || !Array.isArray(approval.plan.queries) ||
      !Array.isArray(plan.queries) || plan.queries.length === 0 ||
      plan.queries.some((query) => !query || typeof query.id !== 'string' || !query.id.trim() ||
        typeof query.text !== 'string' || !query.text.trim()) ||
      new Set(plan.queries.map((query) => query.id)).size !== plan.queries.length ||
      approval.planSha256 !== searchPlanSha256(plan) || approval.planSha256 !== searchPlanSha256(approval.plan)) {
    return '检索快照的批准计划与当前计划不一致'
  }
  const runError = validateSearchRun(approval, snapshot.run)
  if (runError) return runError
  if (snapshot.runSha256 !== searchRunSha256(snapshot.run)) return '检索快照结果在审核后发生变化'
  if (snapshot.snapshotSha256 !== searchSnapshotSha256(snapshot)) return '检索快照的批准或审查记录在审核后发生变化'
  return null
}

export function searchApprovalError(
  plan: SearchPlan,
  providers: readonly SearchProvider[],
  approval: SearchApproval | null,
  feedbackId?: string,
): string | null {
  try { return searchApprovalErrorUnchecked(plan, providers, approval, feedbackId) }
  catch { return '检索批准或查询计划结构无效' }
}

function searchApprovalErrorUnchecked(
  plan: SearchPlan,
  providers: readonly SearchProvider[],
  approval: SearchApproval | null,
  feedbackId?: string,
): string | null {
  if (providers.length === 0) return null
  if (!approval) return '公共检索前缺少人工审核的脱敏查询计划'
  if (feedbackId && approval.feedbackId !== feedbackId) return '检索批准与反馈 ID 不匹配'
  if (!approval.reviewedBy.trim() || !approval.redactionNote.trim() || !Number.isFinite(Date.parse(approval.reviewedAt))) {
    return '检索批准缺少审核人、时间或脱敏说明'
  }
  if (approval.planSha256 !== searchPlanSha256(plan) || approval.planSha256 !== searchPlanSha256(approval.plan)) {
    return '查询计划在审核后发生变化'
  }
  const providerIds = providers.map((provider) => provider.id)
  if (new Set(providerIds).size !== providerIds.length ||
      new Set(approval.providerIds).size !== approval.providerIds.length ||
      providerIds.length !== approval.providerIds.length ||
      providerIds.some((id) => !approval.providerIds.includes(id))) {
    return '实际搜索源与审核批准的接收方不一致'
  }
  return queryRecipientError(plan, approval.providerIds)
}

function uniqueQueries(queries: SearchQuery[]): SearchQuery[] {
  const seen = new Set<string>()
  return queries.filter((query) => {
    const key = `${query.text.normalize('NFKC').toLowerCase()}|${query.purpose}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function safeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^(OpenAlex|Wikipedia|Crossref) HTTP [1-5]\d{2}$/.test(message)
    ? message
    : '搜索源调用失败；原始错误可能含检索词或凭据，未写入审计记录'
}

export function createSearchPlan(
  feedback: FeedbackRecord,
  story: StoryFile,
  options: { translations?: string[]; controversySignal?: string | null; extraQueries?: string[] } = {},
): SearchPlan {
  if (feedback.status !== 'ready') throw new Error('反馈尚未定位或澄清，不能开始搜索')
  const question = `${story.title} ${feedback.originalText}`.trim()
  const queries: SearchQuery[] = []
  const add = (text: string, purpose: SearchQuery['purpose'], language: string) => {
    if (!text.trim()) return
    queries.push({ id: `q-${queries.length + 1}`, text: text.trim(), purpose, language, sourceTypes: ['paper', 'book', 'museum', 'map', 'website'], providerIds: [] })
  }
  add(question, 'support', '原文')
  if (story.historicalScope.period || story.historicalScope.place) {
    add(`${story.historicalScope.period ?? ''} ${story.historicalScope.place ?? ''} ${feedback.originalText}`, 'context', '原文')
  }
  for (const text of options.translations ?? []) add(text, 'support', '扩展语种')
  for (const text of options.extraQueries ?? []) add(text, 'context', '人工补充')
  if (options.controversySignal) {
    add(`${feedback.originalText} 争议 反证 不同解释`, 'challenge', '中文')
    for (const text of options.translations ?? []) add(`${text} criticism alternative interpretation`, 'challenge', '扩展语种')
  }
  const planned = uniqueQueries(queries).map((query, index) => ({ ...query, id: `q-${index + 1}` }))
  return {
    storyId: story.storyId,
    baseRevision: story.contentRevision,
    question,
    period: story.historicalScope.period,
    place: story.historicalScope.place,
    queries: planned,
    controversySignal: options.controversySignal ?? null,
    omittedCoverage: options.translations?.length ? [] : ['跨语种检索词未提供，需人工补充或记录漏检风险'],
    stopReason: '查询计划已列出；实际停止须结合命中、空结果、访问限制与人工覆盖检查决定',
  }
}

export async function runSearch(
  plan: SearchPlan,
  providers: readonly SearchProvider[],
  approval: SearchApproval | null = null,
): Promise<SearchRun> {
  const authorizationError = searchApprovalError(plan, providers, approval)
  if (authorizationError) throw new Error(authorizationError)
  let approvedPlan: SearchPlan
  try { approvedPlan = structuredClone(plan) }
  catch { throw new Error('审核后的查询计划无法安全复制') }
  const approvedProviders = providers.map((provider) => ({
    id: provider.id, sourceTypes: [...provider.sourceTypes], search: provider.search.bind(provider),
  }))
  const hits: SearchHit[] = []
  const trace: SearchTrace[] = []
  const coverageGaps = [...approvedPlan.omittedCoverage]
  if (approvedProviders.length === 0) coverageGaps.push('没有配置搜索源')
  const availableTypes = new Set(approvedProviders.flatMap((provider) => provider.sourceTypes))
  for (const type of ['paper', 'book', 'museum', 'map', 'website']) {
    if (!availableTypes.has(type)) coverageGaps.push(`未配置 ${type} 类型的搜索源`)
  }
  for (const query of approvedPlan.queries) {
    for (const provider of approvedProviders) {
      if (!query.providerIds.includes(provider.id)) continue
      const at = new Date().toISOString()
      try {
        const found = await provider.search(structuredClone(query))
        hits.push(...found.map((hit) => ({ ...hit, provider: provider.id, queryId: query.id })))
        trace.push({ queryId: query.id, provider: provider.id, at, status: found.length ? 'ok' : 'empty', hitCount: found.length, error: null })
      } catch (error) {
        const reason = safeProviderError(error)
        trace.push({ queryId: query.id, provider: provider.id, at, status: 'error', hitCount: 0, error: reason })
        coverageGaps.push(`${provider.id} 对 ${query.id} 查询失败：${reason}`)
      }
    }
  }
  return { hits, trace, coverageGaps }
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject { return value && typeof value === 'object' ? value as JsonObject : {} }
function string(value: unknown): string { return typeof value === 'string' ? value : '' }

export class OpenAlexProvider implements SearchProvider {
  readonly id = 'openalex'
  readonly sourceTypes = ['paper', 'book']
  readonly #request: typeof fetch
  readonly #perPage: number
  constructor(request: typeof fetch = fetch, perPage = 25) {
    this.#request = request
    this.#perPage = perPage
    Object.freeze(this)
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const url = new URL('https://api.openalex.org/works')
    url.searchParams.set('search', query.text)
    url.searchParams.set('per-page', String(this.#perPage))
    const response = await this.#request(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`)
    const body = object(await response.json())
    const results = Array.isArray(body.results) ? body.results : []
    return results.map((raw): SearchHit => {
      const item = object(raw)
      const primary = object(item.primary_location)
      const doi = string(item.doi)
      const landing = string(primary.landing_page_url)
      return {
        provider: this.id, queryId: query.id, title: string(item.display_name),
        url: landing || doi || string(item.id), snippet: '',
        sourceType: item.type === 'book' ? 'book' : 'paper',
        author: Array.isArray(item.authorships) ? string(object(object(item.authorships[0]).author).display_name) || null : null,
        publishedAt: string(item.publication_date) || null, doi: doi || null,
        rights: string(primary.license) || null, retrievedAt: new Date().toISOString(),
      }
    }).filter((hit) => hit.title && hit.url)
  }
}

export class WikipediaProvider implements SearchProvider {
  readonly id: string
  readonly sourceTypes = ['website']
  readonly #language: 'en' | 'zh'
  readonly #request: typeof fetch
  constructor(language: 'en' | 'zh', request: typeof fetch = fetch) {
    this.#language = language
    this.#request = request
    this.id = `wikipedia-${language}`
    Object.freeze(this)
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const url = new URL(`https://${this.#language}.wikipedia.org/w/api.php`)
    for (const [key, value] of Object.entries({ action: 'query', list: 'search', srsearch: query.text, format: 'json', srlimit: '20' })) {
      url.searchParams.set(key, value)
    }
    const response = await this.#request(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`)
    const results = object(object(await response.json()).query).search
    if (!Array.isArray(results)) return []
    return results.map((raw): SearchHit => {
      const item = object(raw)
      const title = string(item.title)
      return {
        provider: this.id, queryId: query.id, title,
        url: `https://${this.#language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        snippet: string(item.snippet).replace(/<[^>]*>/g, ''), sourceType: 'website',
        author: null, publishedAt: null, doi: null,
        rights: '页面许可须按条目及素材分别核对', retrievedAt: new Date().toISOString(),
      }
    }).filter((hit) => hit.title)
  }
}

/** Crossref metadata broadens discovery but never substitutes for the article's full text. */
export class CrossrefProvider implements SearchProvider {
  readonly id = 'crossref'
  readonly sourceTypes = ['paper', 'book']
  readonly #request: typeof fetch
  readonly #rows: number
  constructor(request: typeof fetch = fetch, rows = 25) {
    this.#request = request
    this.#rows = rows
    Object.freeze(this)
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const url = new URL('https://api.crossref.org/works')
    url.searchParams.set('query.bibliographic', query.text)
    url.searchParams.set('rows', String(this.#rows))
    const response = await this.#request(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`)
    const items = object(object(await response.json()).message).items
    if (!Array.isArray(items)) return []
    return items.map((raw): SearchHit => {
      const item = object(raw)
      const title = Array.isArray(item.title) ? string(item.title[0]) : string(item.title)
      const doi = string(item.DOI)
      const url = string(item.URL) || (doi ? `https://doi.org/${doi}` : '')
      const author = Array.isArray(item.author) ? object(item.author[0]) : {}
      const authorName = [string(author.given), string(author.family)].filter(Boolean).join(' ') || null
      const published = object(item.published)
      const dateParts = Array.isArray(published['date-parts']) ? published['date-parts'][0] : null
      const publishedAt = Array.isArray(dateParts) ? dateParts.join('-') : null
      const license = Array.isArray(item.license) ? string(object(item.license[0]).URL) : ''
      return {
        provider: this.id, queryId: query.id, title, url, snippet: '',
        sourceType: item.type === 'book' || item.type === 'book-chapter' ? 'book' : 'paper',
        author: authorName, publishedAt, doi: doi || null,
        rights: license || '元数据可检索不代表全文或图像可复用', retrievedAt: new Date().toISOString(),
      }
    }).filter((hit) => hit.title && hit.url)
  }
}
