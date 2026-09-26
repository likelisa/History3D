import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { SourcesFile, StoryFile } from '../contracts/src/types.ts'
import { dedupeHits } from '../collector/src/dedupe.ts'
import { extractCandidate } from '../collector/src/evidence.ts'
import { clarifyFeedback, receiveFeedback } from '../collector/src/feedback.ts'
import { buildCandidate, readReferences, validateCandidate } from '../collector/src/output.ts'
import { runRevision, type PipelineOptions } from '../collector/src/pipeline.ts'
import { RUBRIC_DIMENSIONS, type HumanReview } from '../collector/src/policy.ts'
import { CrossrefProvider, OpenAlexProvider, WikipediaProvider, createSearchPlan, createSearchSnapshot, runSearch, searchPlanSha256, type SearchApproval, type SearchProvider } from '../collector/src/search.ts'
import type { EvidenceCandidate, SearchHit } from '../collector/src/types.ts'

const fixture = path.resolve('contracts/fixtures/collection/silk-road-demo')
const hit: SearchHit = {
  provider: 'test-archive', queryId: 'q-1', title: 'Synthetic archive record',
  url: 'https://example.org/synthetic-record', snippet: 'Synthetic, not historical evidence',
  sourceType: 'museum', author: 'Test curator', publishedAt: '2026-09-01', doi: null,
  rights: 'Test fixture, no external reuse', retrievedAt: '2026-09-25T00:00:00Z',
}

async function base() {
  const story = JSON.parse(await readFile(path.join(fixture, 'story.json'), 'utf8')) as StoryFile
  const sources = JSON.parse(await readFile(path.join(fixture, 'sources.json'), 'utf8')) as SourcesFile
  return { story, sources, references: await readReferences(fixture, story, sources) }
}

function evidence(story: StoryFile): EvidenceCandidate {
  return extractCandidate(hit, {
    subjectId: story.storyId, property: 'narrative', statement: '合成测试断言', value: '合成测试值', unit: null,
    evidenceType: 'documented', originalLocation: 'fixture §1', supportExcerpt: '合成测试原文，不代表史实',
    isDirectQuote: true, extractionNote: '仅用于测试数据流',
  }, [story.storyId])
}

describe('采集反馈与搜索', () => {
  it('用户自然语言含糊时先追问，澄清后才可规划搜索', async () => {
    const { story } = await base()
    const first = receiveFeedback({ origin: 'user', text: '这个尺寸不对' }, story)
    expect(first.status).toBe('needs_clarification')
    expect(() => createSearchPlan(first, story)).toThrow()
    const clarified = clarifyFeedback(first, '我说的是 brief-beast', story)
    expect(clarified.status).toBe('ready')
    expect(clarified.context.subjectId).toBe('brief-beast')
    expect(clarified.originalText).toBe(first.originalText)
    expect(clarified.clarification).toHaveLength(1)
  })

  it('B 层返回过期对象 ID 时能追问并用自然语言恢复定位', async () => {
    const { story } = await base()
    const first = receiveFeedback({
      origin: 'generator', text: '原来的行囊比例不对',
      context: { storyId: story.storyId, subjectId: 'old-pack-id', contentRevision: 1, sceneRevision: 4 },
    }, story)
    expect(first.status).toBe('needs_clarification')
    expect(first.context.subjectId).toBeUndefined()
    const clarified = clarifyFeedback(first, '我说的是行囊', story)
    expect(clarified.status).toBe('ready')
    expect(clarified.context.subjectId).toBe('brief-pack')
    expect(clarified.context.sceneRevision).toBe(4)
  })

  it('相同反馈保留新原话记录并关联旧记录', async () => {
    const { story } = await base()
    const input = { origin: 'viewer' as const, text: 'brief-beast 造型不对', context: { storyId: story.storyId, contentRevision: 1 } }
    const first = receiveFeedback(input, story)
    const second = receiveFeedback(input, story, [first])
    expect(second.status).toBe('duplicate')
    expect(second.duplicateOf).toBe(first.id)
    expect(second.id).not.toBe(first.id)
  })

  it('争议搜索按线索触发，空结果和错误留痕；DOI 同源去重', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'user', text: 'brief-beast 是否真实存在？' }, story)
    const ordinary = createSearchPlan(feedback, story)
    expect(ordinary.queries.every((item) => item.purpose !== 'challenge')).toBe(true)
    const disputed = createSearchPlan(feedback, story, { controversySignal: '资料说法相反' })
    expect(disputed.queries.some((item) => item.purpose === 'challenge')).toBe(true)
    ordinary.queries.forEach((query) => { query.providerIds = ['empty'] })
    const provider: SearchProvider = { id: 'empty', sourceTypes: ['museum'], async search() { return [] } }
    const approval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成测试检索词，经人工审核', providerIds: ['empty'],
      plan: ordinary, planSha256: searchPlanSha256(ordinary),
    }
    const result = await runSearch(ordinary, [provider], approval)
    expect(result.trace.every((item) => item.status === 'empty')).toBe(true)
    expect(result.coverageGaps.some((item) => item.includes('paper'))).toBe(true)
    const clusters = dedupeHits([{ ...hit, doi: 'https://doi.org/10.1/test' }, { ...hit, url: 'https://mirror.example/test', doi: '10.1/test' }])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].mirrors).toHaveLength(1)
  })

  it('搜索源异常即使含秘密或检索词，也不写入审计轨迹', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'user', text: 'brief-pack 需要核查' }, story)
    const rawPlan = createSearchPlan(feedback, story)
    const plan = { ...rawPlan, question: 'sanitized', queries: [{ ...rawPlan.queries[0], text: 'cargo bundle sources', providerIds: ['error-fixture'] }] }
    const approval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '已脱敏', providerIds: ['error-fixture'], plan, planSha256: searchPlanSha256(plan),
    }
    const result = await runSearch(plan, [{
      id: 'error-fixture', sourceTypes: ['website'],
      async search() { throw new Error('https://example.org/?q=private-search&token=synthetic-secret') },
    }], approval)
    expect(result.trace[0].status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    expect(JSON.stringify(result)).not.toContain('private-search')
  })

  it('每条获批查询只发给其指定接收方，快照轨迹也只要求实际批准的配对', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'generator', text: 'claim-story-context 需要复查', context: { storyId: story.storyId, claimId: 'claim-story-context' } }, story)
    const raw = createSearchPlan(feedback, story)
    const plan = { ...raw, question: 'Synthetic approved research', queries: [
      { ...raw.queries[0], id: 'q-1', text: 'synthetic Chinese term', providerIds: ['archive-zh'] },
      { ...raw.queries[0], id: 'q-2', text: 'synthetic English term', providerIds: ['archive-en'] },
    ] }
    const approval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成词且每条接收方分别获批', providerIds: ['archive-zh', 'archive-en'],
      plan, planSha256: searchPlanSha256(plan),
    }
    const calls: string[] = []
    const providers: SearchProvider[] = [
      { id: 'archive-zh', sourceTypes: ['book'], async search(query) { calls.push(`zh:${query.text}`); return [] } },
      { id: 'archive-en', sourceTypes: ['paper'], async search(query) { calls.push(`en:${query.text}`); return [] } },
    ]
    const result = await runSearch(plan, providers, approval)
    expect(calls).toEqual(['zh:synthetic Chinese term', 'en:synthetic English term'])
    expect(result.trace.map((item) => `${item.queryId}:${item.provider}`)).toEqual(['q-1:archive-zh', 'q-2:archive-en'])
    expect(createSearchSnapshot(approval, result, 'synthetic-reviewer', 'fixture-search-log').run.trace).toHaveLength(2)
    expect(() => createSearchSnapshot(approval, {
      ...result, trace: [{ ...result.trace[0], provider: 'archive-en' }, result.trace[1]],
    }, 'synthetic-reviewer', 'fixture-search-log')).toThrow('轨迹')
    await expect(runSearch({
      ...plan, queries: [{ ...plan.queries[0], providerIds: ['archive-en'] }, plan.queries[1]],
    }, providers, approval)).rejects.toThrow('变化')
    expect(calls).toHaveLength(2)
  })

  it('缺少逐查询接收方、越权接收方或空接收方时，公共搜索一律零调用', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'generator', text: 'claim-story-context 需要复查', context: { storyId: story.storyId, claimId: 'claim-story-context' } }, story)
    const raw = createSearchPlan(feedback, story)
    let calls = 0
    const provider: SearchProvider = { id: 'archive-zh', sourceTypes: ['book'], async search() { calls += 1; return [] } }
    for (const recipients of [undefined, [], ['archive-other'], ['archive-zh', 'archive-zh']]) {
      const plan = { ...raw, queries: [{ ...raw.queries[0], text: 'synthetic approved term', providerIds: recipients }] } as unknown as ReturnType<typeof createSearchPlan>
      const approval: SearchApproval = {
        feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
        redactionNote: '合成词', providerIds: ['archive-zh'], plan, planSha256: searchPlanSha256(plan),
      }
      await expect(runSearch(plan, [provider], approval)).rejects.toThrow('接收方')
    }
    const extraProvider: SearchProvider = { id: 'unused-provider', sourceTypes: ['website'], async search() { calls += 1; return [] } }
    const validPlan = { ...raw, queries: [{ ...raw.queries[0], text: 'synthetic approved term', providerIds: ['archive-zh'] }] }
    const overBroadApproval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成词', providerIds: ['archive-zh', 'unused-provider'],
      plan: validPlan, planSha256: searchPlanSha256(validPlan),
    }
    await expect(runSearch(validPlan, [provider, extraProvider], overBroadApproval)).rejects.toThrow('未分配')
    expect(calls).toBe(0)
  })

  it('搜索源回调或调用方修改原计划后，不得改变后续查询词与接收方', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'generator', text: 'claim-story-context 需要复查', context: { storyId: story.storyId, claimId: 'claim-story-context' } }, story)
    const raw = createSearchPlan(feedback, story)
    const plan = { ...raw, queries: [
      { ...raw.queries[0], id: 'q-1', text: 'approved-first', providerIds: ['archive-a'] },
      { ...raw.queries[0], id: 'q-2', text: 'approved-second', providerIds: ['archive-b'] },
    ] }
    const approval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成词与逐查询路由已审核', providerIds: ['archive-a', 'archive-b'],
      plan, planSha256: searchPlanSha256(plan),
    }
    const calls: string[] = []
    const providers: SearchProvider[] = [
      { id: 'archive-a', sourceTypes: ['book'], async search(query) {
        calls.push(`a:${query.text}`)
        plan.queries[0].providerIds.push('archive-b')
        plan.queries[1].text = 'changed-after-approval'
        query.text = 'changed-by-provider'
        return []
      } },
      { id: 'archive-b', sourceTypes: ['paper'], async search(query) { calls.push(`b:${query.text}`); return [] } },
    ]
    const run = await runSearch(plan, providers, approval)
    expect(calls).toEqual(['a:approved-first', 'b:approved-second'])
    expect(run.trace.map((trace) => `${trace.queryId}:${trace.provider}`)).toEqual(['q-1:archive-a', 'q-2:archive-b'])
  })

  it('前一搜索源改变维基 provider 的公开属性，也不能让英文批准改发中文站', async () => {
    const { story } = await base()
    const feedback = receiveFeedback({ origin: 'generator', text: 'claim-story-context 需要复查', context: { storyId: story.storyId, claimId: 'claim-story-context' } }, story)
    const raw = createSearchPlan(feedback, story)
    const plan = { ...raw, queries: [
      { ...raw.queries[0], id: 'q-1', text: 'approved-first', providerIds: ['mutator'] },
      { ...raw.queries[0], id: 'q-2', text: 'approved-second', providerIds: ['wikipedia-en'] },
    ] }
    const approval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成词与逐查询接收方已审核', providerIds: ['mutator', 'wikipedia-en'],
      plan, planSha256: searchPlanSha256(plan),
    }
    const requested: string[] = []
    const mockedFetch = async (input: RequestInfo | URL): Promise<Response> => {
      requested.push(String(input))
      return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 })
    }
    const wiki = new WikipediaProvider('en', mockedFetch as typeof fetch)
    const mutator: SearchProvider = { id: 'mutator', sourceTypes: ['website'], async search() {
      ;(wiki as unknown as { language: string }).language = 'zh'
      return []
    } }
    const run = await runSearch(plan, [mutator, wiki], approval)
    expect(requested).toHaveLength(1)
    expect(new URL(requested[0]).hostname).toBe('en.wikipedia.org')
    expect(run.trace.map((trace) => `${trace.queryId}:${trace.provider}`)).toEqual(['q-1:mutator', 'q-2:wikipedia-en'])
  })

  it('内建 provider 的审计 ID 在运行时不可改写，不能伪装另一接收方', () => {
    const mockedFetch = async (): Promise<Response> => new Response('{}', { status: 200 })
    for (const [provider, expected] of [
      [new OpenAlexProvider(mockedFetch as typeof fetch), 'openalex'],
      [new CrossrefProvider(mockedFetch as typeof fetch), 'crossref'],
      [new WikipediaProvider('en', mockedFetch as typeof fetch), 'wikipedia-en'],
    ] as const) {
      expect(Object.isFrozen(provider)).toBe(true)
      expect(() => { (provider as { id: string }).id = 'wikipedia-zh' }).toThrow()
      expect(provider.id).toBe(expected)
    }
  })

  it('Crossref 只把元数据列为候选，DOI/作者/日期可追但不伪称全文证据', async () => {
    const calls: string[] = []
    const mocked = async (input: RequestInfo | URL): Promise<Response> => {
      calls.push(String(input))
      return new Response(JSON.stringify({ message: { items: [{
        title: ['Synthetic publication'], DOI: '10.1234/synthetic', URL: 'https://doi.org/10.1234/synthetic',
        type: 'journal-article', author: [{ given: 'A', family: 'Scholar' }],
        published: { 'date-parts': [[2020, 5, 1]] },
      }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const provider = new CrossrefProvider(mocked as typeof fetch, 20)
    const found = await provider.search({ id: 'q-1', text: 'sanitized historic source', language: 'en', purpose: 'support', sourceTypes: ['paper'], providerIds: ['crossref'] })
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]).searchParams.get('query.bibliographic')).toBe('sanitized historic source')
    expect(found[0]).toMatchObject({ doi: '10.1234/synthetic', author: 'A Scholar', publishedAt: '2020-5-1', snippet: '' })
    expect(found[0].rights).toContain('不代表全文')
  })

  it('三个内建公共搜索源都拒绝自动跟随重定向，避免检索词流向未批准域名', async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = []
    const mockedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), redirect: init?.redirect })
      return new Response(null, { status: 302, headers: { location: 'https://unapproved.example/collect' } })
    }
    const query = {
      id: 'q-1', text: 'synthetic public keyword', language: 'en', purpose: 'support' as const,
      sourceTypes: ['paper', 'website'], providerIds: ['openalex', 'crossref', 'wikipedia-en'],
    }
    for (const provider of [
      new OpenAlexProvider(mockedFetch as typeof fetch),
      new CrossrefProvider(mockedFetch as typeof fetch),
      new WikipediaProvider('en', mockedFetch as typeof fetch),
    ]) {
      await expect(provider.search(query)).rejects.toThrow('HTTP 302')
    }
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.redirect === 'error')).toBe(true)
  })
})

describe('完整修订链（全部资料均为合成测试）', () => {
  async function options(policyApproved: boolean, opposition = false): Promise<PipelineOptions> {
    const { story, sources, references } = await base()
    const feedback = receiveFeedback({ origin: 'generator', text: 'claim-story-context 需要更正', context: { storyId: story.storyId, claimId: 'claim-story-context', contentRevision: 1 } }, story)
    const item = evidence(story)
    if (opposition) item.opposingExcerpts = ['合成反证 B']
    const review: HumanReview = {
      reviewer: 'synthetic-reviewer', decision: 'retain', reviewedAt: '2026-09-25T00:00:00Z', reasons: ['合成校准用例'],
      assessments: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, level: 2, reason: '合成测试评估', evidenceRefs: ['fixture §1'] })),
    }
    const rawPlan = createSearchPlan(feedback, story)
    const reviewedPlan = {
      ...rawPlan, question: 'Synthetic research question',
      queries: [{ ...rawPlan.queries[0], text: 'Silk Road caravan historical sources', providerIds: ['test-archive'] }],
    }
    const searchApproval: SearchApproval = {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '合成测试仅发送研究关键词，不发送原始反馈', providerIds: ['test-archive'],
      plan: reviewedPlan, planSha256: searchPlanSha256(reviewedPlan),
    }
    return {
      feedback, story, sources, references, root: 'unused-in-test',
      providers: [{ id: 'test-archive', sourceTypes: ['paper', 'book', 'museum', 'map', 'website'], async search() { return [hit] } }],
      searchApproval,
      recheckSource: async (source) => ({ sourceId: source.id, status: 'ok', checkedAt: '2026-09-25T00:00:00Z', note: '合成复查' }),
      extractor: { async extract() { return { candidates: [item], proposedEdits: [{ kind: 'replace', previousClaimId: 'claim-story-context', evidence: item }], unresolved: [] } } },
      judge: null,
      policy: { version: 'synthetic-test', status: policyApproved ? 'approved' : 'draft', approvedBy: policyApproved ? 'test' : null, approvedAt: policyApproved ? '2026-09-25' : null, calibrationRecord: policyApproved ? 'test-cases' : null },
      reviews: new Map([[item.id, review]]), withdrawalReviews: new Map(),
      verifyExcerpt: async () => ({ verified: true, evidenceRef: 'fixture §1' }),
      verifyOpposingExcerpt: async () => ({ verified: true, evidenceRef: 'fixture §2' }),
      coverageReview: { reviewer: 'synthetic-reviewer', reason: '合成测试接受无跨语种词' },
      persistCandidate: async (candidate) => { await validateCandidate(candidate); return 'synthetic-candidate-path' },
    }
  }

  it('P→S→D→E→J→R→O 全链生成合法候选，保留基线版本', async () => {
    const input = await options(true)
    const result = await runRevision(input)
    expect(result.status).toBe('candidate')
    expect(result.stages.map((item) => item.stage)).toEqual(['P', 'S', 'D', 'E', 'J', 'R', 'O'])
    expect(result.candidatePath).toBe('synthetic-candidate-path')
    expect(result.publishedPath).toBeNull()
    expect(input.story.contentRevision).toBe(1)
  })

  it('评分政策未批准时阻断输出', async () => {
    const result = await runRevision(await options(false))
    expect(result.status).toBe('needs_human')
    expect(result.stages.at(-1)?.stage).toBe('R')
    expect(result.candidatePath).toBeNull()
  })

  it('未批准搜索计划时停在 P，搜索源零调用', async () => {
    const input = await options(true)
    let calls = 0
    input.providers = [{ id: 'public-test', sourceTypes: ['website'], async search() { calls += 1; return [hit] } }]
    input.searchApproval = null
    const result = await runRevision(input)
    expect(result.status).toBe('needs_human')
    expect(result.stages.map((stage) => stage.stage)).toEqual(['P'])
    expect(calls).toBe(0)
  })

  it('审核过的脱敏计划只把指定关键词发给指定搜索源', async () => {
    const input = await options(true)
    input.feedback.originalText = 'claim-story-context 联系我 example@example.com 需要更正'
    const queries: string[] = []
    input.providers = [{ id: 'test-archive', sourceTypes: ['paper', 'book', 'museum', 'map', 'website'], async search(query) {
      queries.push(query.text)
      return [hit]
    } }]
    const result = await runRevision(input)
    expect(result.status).toBe('candidate')
    expect(queries).toEqual(['Silk Road caravan historical sources'])
    expect(queries.join(' ')).not.toContain('example@example.com')
  })

  it('计划修改或接收方变化后，直接 runSearch 也拒绝外发', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    let calls = 0
    const provider: SearchProvider = { id: 'test-archive', sourceTypes: ['website'], async search() { calls += 1; return [] } }
    await expect(runSearch({ ...approval.plan, question: 'tampered' }, [provider], approval)).rejects.toThrow('变化')
    await expect(runSearch(approval.plan, [{ ...provider, id: 'other-destination' }], approval)).rejects.toThrow('接收方')
    expect(calls).toBe(0)
  })

  it('人工审查过的检索快照可离线完整复跑，不再调用公网搜索源', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    input.searchSnapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    let calls = 0
    input.providers = [{ id: 'unexpected-public', sourceTypes: ['website'], async search() { calls += 1; return [] } }]
    const blocked = await runRevision(input)
    expect(blocked.status).toBe('blocked')
    expect(calls).toBe(0)
    input.providers = []
    const resumed = await runRevision(input)
    expect(resumed.status).toBe('candidate')
    expect(resumed.stages.map((stage) => stage.stage)).toEqual(['P', 'S', 'D', 'E', 'J', 'R', 'O'])
    expect(calls).toBe(0)
  })

  it('检索快照命中/轨迹被修改或缺少审查记录时，在 P 阶段阻断', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    const snapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    input.providers = []
    input.searchSnapshot = { ...snapshot, run: { ...snapshot.run, hits: [{ ...snapshot.run.hits[0], title: 'tampered' }] } }
    const tampered = await runRevision(input)
    expect(tampered.status).toBe('blocked')
    expect(tampered.stages.map((stage) => stage.stage)).toEqual(['P'])
    input.searchSnapshot = { ...snapshot, evidenceRef: '' }
    expect((await runRevision(input)).status).toBe('blocked')
  })

  it('检索快照不接受缺失或重复的查询轨迹，即使重新生成摘要也不放行', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    expect(() => createSearchSnapshot(approval, { ...recorded, trace: [] }, 'synthetic-reviewer', 'fixture-search-log')).toThrow('轨迹')
    expect(() => createSearchSnapshot(approval, { ...recorded, trace: [...recorded.trace, ...recorded.trace] }, 'synthetic-reviewer', 'fixture-search-log')).toThrow('轨迹')
    expect(() => createSearchSnapshot(approval, { ...recorded, hits: [{ ...recorded.hits[0], provider: 'unapproved' }] }, 'synthetic-reviewer', 'fixture-search-log')).toThrow('未知')
  })

  it('快照审核人与证据指针或原批准记录修改后也必须失效', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    const snapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    input.providers = []
    input.searchApproval = null
    for (const changed of [
      { ...snapshot, reviewedBy: 'changed-reviewer' },
      { ...snapshot, evidenceRef: 'changed-log' },
      { ...snapshot, approval: { ...snapshot.approval, redactionNote: 'changed-note' } },
    ]) {
      input.searchSnapshot = changed
      const result = await runRevision(input)
      expect(result.status).toBe('blocked')
      expect(result.stages.map((stage) => stage.stage)).toEqual(['P'])
    }
  })

  it('P 阶段后外部回调即使改写原快照，后续研究仍只使用已校验副本', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    const snapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    input.providers = []
    input.searchSnapshot = snapshot
    let researchedTitle = ''
    input.onProgress = async (record) => {
      if (record.stages.at(-1)?.stage === 'P') snapshot.run.hits[0].title = 'mutated-after-validation'
    }
    input.onResearch = async (_record, research) => { researchedTitle = research.search.hits[0].title }
    const result = await runRevision(input)
    expect(result.status).toBe('candidate')
    expect(researchedTitle).toBe('Synthetic archive record')
  })

  it('格式不完整的外部检索快照在 P 阶段安全阻断，而非执行搜索或抛异常', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    const snapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    input.providers = []
    input.searchApproval = null
    input.searchSnapshot = { ...snapshot, approval: {
      ...snapshot.approval, plan: undefined,
      planSha256: searchPlanSha256(createSearchPlan(input.feedback, input.story)),
    } } as unknown as typeof snapshot
    const result = await runRevision(input)
    expect(result.status).toBe('blocked')
    expect(result.stages.map((stage) => stage.stage)).toEqual(['P'])
  })

  it('含循环引用的恶意运行时快照在 P 阶段安全阻断', async () => {
    const input = await options(true)
    const approval = input.searchApproval!
    const recorded = await runSearch(approval.plan, input.providers, approval)
    const snapshot = createSearchSnapshot(approval, recorded, 'synthetic-reviewer', 'fixture-search-log')
    input.providers = []
    input.searchApproval = null
    for (const location of ['plan', 'run'] as const) {
      const cyclic = structuredClone(snapshot)
      if (location === 'plan') {
        const plan = cyclic.approval.plan as typeof cyclic.approval.plan & { cycle?: unknown }
        plan.cycle = plan
      } else {
        const run = cyclic.run as typeof cyclic.run & { cycle?: unknown }
        run.cycle = run
      }
      input.searchSnapshot = cyclic
      const result = await runRevision(input)
      expect(result.status).toBe('blocked')
      expect(result.stages.map((stage) => stage.stage)).toEqual(['P'])
    }
  })

  it('旧版反馈没有复核不得继续搜索，有复核后仍须完整重跑', async () => {
    const input = await options(true)
    input.story.contentRevision = 2
    input.sources.contentRevision = 2
    input.searchApproval!.plan.baseRevision = 2
    input.searchApproval!.planSha256 = searchPlanSha256(input.searchApproval!.plan)
    let calls = 0
    input.providers = [{ id: 'test-archive', sourceTypes: ['paper', 'book', 'museum', 'map', 'website'], async search() { calls += 1; return [hit] } }]
    const blocked = await runRevision(input)
    expect(blocked.status).toBe('needs_human')
    expect(blocked.stages.map((stage) => stage.stage)).toEqual(['P'])
    expect(calls).toBe(0)
    input.rebaseReview = { feedbackId: input.feedback.id, targetRevision: 2, reviewer: 'synthetic-reviewer', reason: '合成测试确认旧问题仍在' }
    const continued = await runRevision(input)
    expect(continued.stages.map((stage) => stage.stage)).toEqual(['P', 'S', 'D', 'E', 'J', 'R', 'O'])
    expect(calls).toBeGreaterThan(0)
  })

  it('争议题没有 Jev 时停在 J', async () => {
    const result = await runRevision(await options(true, true))
    expect(result.status).toBe('blocked')
    expect(result.stages.at(-1)?.stage).toBe('J')
  })

  it('未经原文核对的反向摘录先停在 E，不能交给 Jev', async () => {
    const input = await options(true, true)
    let calls = 0
    input.judge = { async judge(question) {
      calls += 1
      return { questionId: question.id, verdict: 'a', model: 'synthetic', rationale: 'fixture', rawResponseRef: 'fixture' }
    } }
    input.verifyOpposingExcerpt = undefined
    const result = await runRevision(input)
    expect(result.status).toBe('needs_human')
    expect(result.stages.at(-1)?.stage).toBe('E')
    expect(calls).toBe(0)
  })

  it('每条已核对的反证都必须分别判断；第二条指向反证时不能输出候选', async () => {
    const input = await options(true, true)
    const originalExtract = input.extractor.extract
    input.extractor = { async extract(args) {
      const review = await originalExtract(args)
      review.candidates[0].opposingExcerpts.push('第二条合成反证 C')
      return review
    } }
    const questions: string[] = []
    input.judge = { async judge(question) {
      questions.push(question.id)
      return {
        questionId: question.id, verdict: questions.length === 1 ? 'a' : 'b',
        model: 'synthetic', rationale: 'fixture', rawResponseRef: 'fixture',
      }
    } }
    const result = await runRevision(input)
    expect(questions).toHaveLength(2)
    expect(result.status).toBe('needs_human')
    expect(result.candidatePath).toBeNull()
  })

  it('更正时旧断言引用会改指新断言，旧版不变', async () => {
    const { story, sources, references } = await base()
    const item = evidence(story)
    const candidate = buildCandidate(story, sources, [{ kind: 'replace', previousClaimId: 'claim-story-context', evidence: item }], references)
    await validateCandidate(candidate)
    expect(candidate.story.contentRevision).toBe(2)
    expect(candidate.sources.contentRevision).toBe(2)
    expect(candidate.story.claims.some((claim) => claim.id === 'claim-story-context')).toBe(false)
    expect(story.claims.some((claim) => claim.id === 'claim-story-context')).toBe(true)
  })
})
