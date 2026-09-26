import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

import { CollectorCoordinator, type RevisionStore } from '../collector/src/coordinator.ts'
import { receiveFeedback } from '../collector/src/feedback.ts'
import { readReferences } from '../collector/src/output.ts'
import type { PipelineOptions } from '../collector/src/pipeline.ts'
import { createSearchPlan, searchPlanSha256 } from '../collector/src/search.ts'
import type { FeedbackRecord, RevisionRecord, SearchHit } from '../collector/src/types.ts'
import type { SourcesFile, StoryFile } from '../contracts/src/types.ts'

it('有效反馈按单队列自动重走 P/S/D/E，每步和搜索结果留痕', async () => {
  const directory = path.resolve('contracts/fixtures/collection/silk-road-demo')
  const story = JSON.parse(await readFile(path.join(directory, 'story.json'), 'utf8')) as StoryFile
  const sources = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as SourcesFile
  const base = { story, sources, directory }
  const revisions = new Map<string, RevisionRecord>()
  const snapshots: RevisionRecord[] = []
  const research: unknown[] = []
  const store: RevisionStore = {
    async revisions() { return [...revisions.values()] },
    async saveRevision(record) { snapshots.push(structuredClone(record)); revisions.set(record.id, structuredClone(record)) },
    async saveResearch(_revisionId, value) { research.push(value) },
  }
  let active = 0
  let maximum = 0
  const hit: SearchHit = {
    provider: 'fixture', queryId: 'q-1', title: 'Synthetic result', url: 'https://example.org/synthetic',
    snippet: 'test only', sourceType: 'website', author: null, publishedAt: null, doi: null,
    rights: 'test only', retrievedAt: '2026-09-25T00:00:00Z',
  }
  const factory = async (feedback: FeedbackRecord): Promise<PipelineOptions> => {
    const rawPlan = createSearchPlan(feedback, story)
    const reviewedPlan = { ...rawPlan, question: 'synthetic research', queries: [{ ...rawPlan.queries[0], text: 'synthetic historical sources', providerIds: ['fixture'] }] }
    return {
    feedback, story, sources, root: 'unused', references: await readReferences(directory, story, sources),
    providers: [{ id: 'fixture', sourceTypes: ['website'], async search() { return [hit] } }],
    searchApproval: {
      feedbackId: feedback.id, reviewedBy: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      redactionNote: '仅发送合成测试词', providerIds: ['fixture'], plan: reviewedPlan,
      planSha256: searchPlanSha256(reviewedPlan),
    },
    recheckSource: async (source) => ({ sourceId: source.id, status: 'ok', checkedAt: '2026-09-25T00:00:00Z', note: 'test' }),
    extractor: { async extract() {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return { candidates: [], proposedEdits: [], unresolved: ['合成测试：需人工原文核对'] }
    } },
    judge: null, policy: { version: 'draft', status: 'draft', approvedBy: null, approvedAt: null, calibrationRecord: null },
    reviews: new Map(), withdrawalReviews: new Map(), verifyExcerpt: async () => ({ verified: false, evidenceRef: '' }), coverageReview: null,
    }
  }
  const coordinator = new CollectorCoordinator('unused', store, factory)
  const first = receiveFeedback({ origin: 'user', text: 'brief-beast 大小不对' }, story)
  const second = receiveFeedback({ origin: 'viewer', text: 'brief-beast 颜色不对' }, story)
  const idA = await coordinator.enqueue(first, base)
  const idB = await coordinator.enqueue(second, base)
  await coordinator.waitIdle()
  expect(maximum).toBe(1)
  expect(revisions.get(idA)?.stages.map((stage) => stage.stage)).toEqual(['P', 'S', 'D', 'E'])
  expect(revisions.get(idB)?.status).toBe('needs_human')
  expect(snapshots.filter((item) => item.id === idA).length).toBeGreaterThan(3)
  expect(research).toHaveLength(2)
  expect(coordinator.isPending(idA)).toBe(false)
})

it('默认流程只在本地规划检索，不向公共搜索源外发用户反馈', async () => {
  const directory = path.resolve('contracts/fixtures/collection/silk-road-demo')
  const story = JSON.parse(await readFile(path.join(directory, 'story.json'), 'utf8')) as StoryFile
  const sources = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as SourcesFile
  const revisions = new Map<string, RevisionRecord>()
  const research: Array<{ search: { trace: unknown[]; coverageGaps: string[] } }> = []
  const store: RevisionStore = {
    async revisions() { return [...revisions.values()] },
    async saveRevision(record) { revisions.set(record.id, structuredClone(record)) },
    async saveResearch(_revisionId, value) { research.push(value as typeof research[number]) },
  }
  const feedback = receiveFeedback({ origin: 'user', text: 'brief-beast 联系我 example@example.com，尺寸不对' }, story)
  const coordinator = new CollectorCoordinator('unused', store)
  const id = await coordinator.enqueue(feedback, { story, sources, directory })
  await coordinator.waitIdle()
  expect(revisions.get(id)?.status).toBe('needs_human')
  expect(research).toHaveLength(1)
  expect(research[0].search.trace).toEqual([])
  expect(research[0].search.coverageGaps).toContain('没有配置搜索源')
})

it('进程重启后恢复已持久化的 queued 修订；版本变化时转人工而非静默丢失', async () => {
  const directory = path.resolve('contracts/fixtures/collection/silk-road-demo')
  const story = JSON.parse(await readFile(path.join(directory, 'story.json'), 'utf8')) as StoryFile
  const sources = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as SourcesFile
  const feedback = receiveFeedback({ origin: 'viewer', text: 'brief-pack restart recovery', context: { storyId: story.storyId, contentRevision: 1 } }, story)
  const queued: RevisionRecord = { id: 'synthetic-queued', feedbackId: feedback.id, storyId: story.storyId,
    baseRevision: 1, status: 'queued', stages: [], unresolved: [], candidatePath: null, publishedPath: null }
  const stale: RevisionRecord = { ...queued, id: 'synthetic-stale', baseRevision: 0 }
  const records = new Map([[queued.id, queued], [stale.id, stale]])
  const store: RevisionStore = {
    async revisions() { return [...records.values()] },
    async saveRevision(record) { records.set(record.id, structuredClone(record)) },
    async saveResearch() {},
    async feedback(id) { return id === feedback.id ? feedback : null },
  }
  const coordinator = new CollectorCoordinator('unused', store)
  const resumed = await coordinator.recoverQueued(async () => ({ story, sources, directory }))
  expect(resumed).toBe(1)
  await coordinator.waitIdle()
  expect(records.get(queued.id)?.stages.map((stage) => stage.stage)).toEqual(['P', 'S', 'D', 'E'])
  expect(records.get(stale.id)?.status).toBe('needs_human')
  expect(records.size).toBe(2)
})
