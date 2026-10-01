import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { FeedbackRecord, RevisionRecord } from './types.ts'

const pending = new Map<string, Promise<void>>()

async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const previous = pending.get(file) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => appendFile(file, `${JSON.stringify(value)}\n`, 'utf8'))
  pending.set(file, next)
  try { await next }
  finally { if (pending.get(file) === next) pending.delete(file) }
}

async function readJsonLines<T>(file: string): Promise<T[]> {
  let text: string
  try { text = await readFile(file, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T)
}

export class CollectorStore {
  constructor(private readonly root: string) {}

  async saveFeedback(record: FeedbackRecord): Promise<void> {
    await appendJsonLine(path.join(this.root, 'state', 'feedback.jsonl'), record)
  }

  async feedbackRecords(): Promise<FeedbackRecord[]> {
    const snapshots = await readJsonLines<FeedbackRecord>(path.join(this.root, 'state', 'feedback.jsonl'))
    return [...new Map(snapshots.map((record) => [record.id, record])).values()]
  }

  async feedback(id: string): Promise<FeedbackRecord | null> {
    return (await this.feedbackRecords()).find((record) => record.id === id) ?? null
  }

  async saveRevision(record: RevisionRecord): Promise<void> {
    await appendJsonLine(path.join(this.root, 'state', 'revisions.jsonl'), record)
  }

  async revision(id: string): Promise<RevisionRecord | null> {
    const snapshots = await readJsonLines<RevisionRecord>(path.join(this.root, 'state', 'revisions.jsonl'))
    return [...snapshots].reverse().find((record) => record.id === id) ?? null
  }

  async revisionForFeedback(feedbackId: string): Promise<RevisionRecord | null> {
    return (await this.revisions()).find((record) => record.feedbackId === feedbackId) ?? null
  }

  async revisions(): Promise<RevisionRecord[]> {
    const snapshots = await readJsonLines<RevisionRecord>(path.join(this.root, 'state', 'revisions.jsonl'))
    return [...new Map(snapshots.map((record) => [record.id, record])).values()]
  }

  async saveResearch(revisionId: string, research: unknown): Promise<void> {
    await appendJsonLine(path.join(this.root, 'state', 'research.jsonl'), { revisionId, savedAt: new Date().toISOString(), research })
  }
}
