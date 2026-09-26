import { randomUUID } from 'node:crypto'

import type { SourcesFile, StoryFile } from '../../contracts/src/types.ts'
import { readReferences } from './output.ts'
import { runRevision, type PipelineOptions } from './pipeline.ts'
import type { FeedbackRecord, RevisionRecord } from './types.ts'

export interface BaseCollection { story: StoryFile; sources: SourcesFile; directory: string }
export type PipelineFactory = (feedback: FeedbackRecord, base: BaseCollection) => Promise<PipelineOptions>
export interface RevisionStore {
  revisions(): Promise<RevisionRecord[]>
  saveRevision(record: RevisionRecord): Promise<void>
  saveResearch(revisionId: string, research: unknown): Promise<void>
  feedback?(id: string): Promise<FeedbackRecord | null>
}

export class CollectorCoordinator {
  private queue: Promise<void> = Promise.resolve()
  private readonly pending = new Set<string>()

  constructor(
    private readonly root: string,
    private readonly store: RevisionStore,
    private readonly factory: PipelineFactory = (feedback, base) => this.defaultOptions(feedback, base),
  ) {}

  private async defaultOptions(feedback: FeedbackRecord, base: BaseCollection): Promise<PipelineOptions> {
    return {
      feedback, story: base.story, sources: base.sources, root: this.root,
      references: await readReferences(base.directory, base.story, base.sources),
      // Feedback may contain personal or confidential text. Prepare the query plan locally,
      // but do not send it to public search providers without a reviewed, sanitized plan.
      providers: [],
      recheckSource: async (source) => ({ sourceId: source.id, status: 'unreachable', checkedAt: new Date().toISOString(), note: '旧来源自动复查尚未配置；需人工打开原文核对' }),
      extractor: { async extract() { return { candidates: [], proposedEdits: [], unresolved: ['需要研究人员核对来源原文并提出候选断言'] } } },
      judge: null,
      policy: { version: 'rubric-v0.1-draft', status: 'draft', approvedBy: null, approvedAt: null, calibrationRecord: null },
      reviews: new Map(), withdrawalReviews: new Map(),
      verifyExcerpt: async () => ({ verified: false, evidenceRef: '' }),
      coverageReview: null,
    }
  }

  async enqueue(feedback: FeedbackRecord, base: BaseCollection): Promise<string> {
    if (feedback.status !== 'ready') throw new Error('反馈未定位，不能排入修订队列')
    // The HTTP layer only accepts feedback against the published package. A caller that
    // bypasses it must not quietly process a stale or mismatched story snapshot.
    if (feedback.context.storyId !== base.story.storyId || base.story.storyId !== base.sources.storyId ||
        base.story.contentRevision !== base.sources.contentRevision) {
      throw new Error('反馈与资料基线不匹配')
    }
    const existing = (await this.store.revisions()).find((item) =>
      item.feedbackId === feedback.id && ['queued', 'running', 'candidate', 'published'].includes(item.status),
    )
    if (existing) return existing.id
    const id = randomUUID()
    const queued: RevisionRecord = {
      id, feedbackId: feedback.id, storyId: base.story.storyId, baseRevision: base.story.contentRevision,
      status: 'queued', stages: [], unresolved: [], candidatePath: null, publishedPath: null,
    }
    await this.store.saveRevision(queued)
    this.schedule(queued, feedback, base)
    return id
  }

  private schedule(queued: RevisionRecord, feedback: FeedbackRecord, base: BaseCollection): void {
    const id = queued.id
    this.pending.add(id)
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        const options = await this.factory(feedback, base)
        const priorProgress = options.onProgress
        const priorResearch = options.onResearch
        const finished = await runRevision({
          ...options, revisionId: id,
          onProgress: async (record) => { await this.store.saveRevision(record); await priorProgress?.(record) },
          onResearch: async (record, research) => { await this.store.saveResearch(id, research); await priorResearch?.(record, research) },
        })
        await this.store.saveRevision(finished)
      } catch {
        const failed: RevisionRecord = { ...queued, status: 'blocked', unresolved: ['修订任务执行失败；查看受控服务端诊断，不会覆盖已发布包'] }
        await this.store.saveRevision(failed)
      } finally { this.pending.delete(id) }
    })
  }

  /** Resume persisted queued/running work after a local server restart. */
  async recoverQueued(loadBase: (storyId: string) => Promise<BaseCollection | null>): Promise<number> {
    let resumed = 0
    for (const record of await this.store.revisions()) {
      if (!['queued', 'running'].includes(record.status) || this.pending.has(record.id)) continue
      const feedback = await this.store.feedback?.(record.feedbackId) ?? null
      let base: BaseCollection | null = null
      try { base = await loadBase(record.storyId) } catch { /* Leave a recorded blocker below. */ }
      if (!feedback || feedback.status !== 'ready' || !base || base.story.storyId !== record.storyId ||
          base.story.contentRevision !== record.baseRevision || base.sources.contentRevision !== record.baseRevision) {
        await this.store.saveRevision({ ...record, status: 'needs_human',
          unresolved: [...record.unresolved, '重启恢复时反馈或发布基线缺失/变化，需人工核对后重新提交'] })
        continue
      }
      this.schedule(record, feedback, base)
      resumed += 1
    }
    return resumed
  }

  isPending(id: string): boolean { return this.pending.has(id) }

  async waitIdle(): Promise<void> { await this.queue }
}
