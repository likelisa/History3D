import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

import { hasBlockingError } from '../../contracts/src/diagnostics.ts'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import type { StoryFile, SourcesFile } from '../../contracts/src/types.ts'
import { validateCollection } from '../../contracts/src/validate.ts'
import { clarifyFeedback, receiveFeedback } from './feedback.ts'
import type { BaseCollection } from './coordinator.ts'
import { CollectorStore } from './store.ts'
import type { FeedbackContext, FeedbackInput, FeedbackRecord } from './types.ts'

const STORY_ID = /^[a-z0-9][a-z0-9-]*$/

interface LoadedCollection { story: StoryFile; sources: SourcesFile; directory: string; demo: boolean }
class FeedbackMutex {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await task() }
    finally { release() }
  }
}

export interface FeedbackStore {
  saveFeedback(record: FeedbackRecord): Promise<void>
  feedbackRecords(): Promise<FeedbackRecord[]>
  feedback(id: string): Promise<FeedbackRecord | null>
  revisionForFeedback?(feedbackId: string): Promise<import('./types.ts').RevisionRecord | null>
  revision?(id: string): Promise<import('./types.ts').RevisionRecord | null>
}
export interface RevisionEnqueuer { enqueue(feedback: FeedbackRecord, base: BaseCollection): Promise<string> }
export interface CollectorServerOptions { root: string; demoFixture?: string; outputDirectory?: string; store?: FeedbackStore; coordinator?: RevisionEnqueuer }

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('请使用 JSON 请求')
  let text = ''
  for await (const chunk of request) {
    text += String(chunk)
    if (text.length > 65536) throw new Error('反馈内容过长')
  }
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求内容格式错误')
  return parsed as Record<string, unknown>
}

function contextOf(value: unknown): FeedbackContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const context: FeedbackContext = {}
  for (const key of ['storyId', 'subjectId', 'claimId', 'hotspotId'] as const) {
    if (typeof raw[key] === 'string') context[key] = raw[key] as string
  }
  for (const key of ['contentRevision', 'sceneRevision'] as const) {
    if (Number.isInteger(raw[key])) context[key] = raw[key] as number
  }
  return context
}

async function loadCollection(directory: string, demo: boolean): Promise<LoadedCollection | null> {
  const result = await validateCollection(createNodeReader(directory))
  if (hasBlockingError(result.diagnostics) || !result.story || !result.sources || path.basename(directory) !== result.story.storyId) return null
  return { story: result.story, sources: result.sources, directory, demo }
}

async function listStories(options: CollectorServerOptions): Promise<LoadedCollection[]> {
  const output = options.outputDirectory ?? path.join(options.root, 'output')
  let entries: string[] = []
  try { entries = (await readdir(output, { withFileTypes: true })).filter((entry) => entry.isDirectory() && STORY_ID.test(entry.name)).map((entry) => entry.name) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const loaded = await Promise.all(entries.map((id) => loadCollection(path.join(output, id), false)))
  if (options.demoFixture) loaded.push(await loadCollection(options.demoFixture, true))
  const byId = new Map<string, LoadedCollection>()
  for (const item of loaded) if (item && (!byId.has(item.story.storyId) || !item.demo)) byId.set(item.story.storyId, item)
  return [...byId.values()]
}

function unlocated(text: string, origin: FeedbackInput['origin'], context: FeedbackContext): FeedbackRecord {
  return {
    id: randomUUID(), origin, originalText: text, clarification: [], receivedAt: new Date().toISOString(),
    context, evidenceUrls: [], status: 'needs_clarification',
    question: '你说的是哪一段故事？请告诉我故事名称，或在页面上选一个故事。',
    duplicateOf: null, fingerprint: createHash('sha256').update(text).digest('hex'),
  }
}

function payload(record: FeedbackRecord, revisionId: string | null = null) {
  return { id: record.id, status: record.status, question: record.question, storyId: record.context.storyId ?? null, duplicateOf: record.duplicateOf, revisionId }
}

async function handleFeedback(request: IncomingMessage, response: ServerResponse, options: CollectorServerOptions, store: FeedbackStore, mutex: FeedbackMutex): Promise<void> {
  const input = await body(request)
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text) { json(response, 400, { error: '请描述你发现的问题' }); return }
  const origin = input.origin === 'generator' || input.origin === 'viewer' ? input.origin : 'user'
  const context = contextOf(input.context)
  const evidenceUrls = Array.isArray(input.evidenceUrls) ? input.evidenceUrls.filter((item): item is string => typeof item === 'string' && /^https?:\/\//.test(item)) : []
  const result = await mutex.run(async () => {
    const stories = await listStories(options)
    const selected = context.storyId ? stories.find((item) => item.story.storyId === context.storyId) : stories.length === 1 ? stories[0] : null
    const record = selected
      ? receiveFeedback({ origin, text, context: { ...context, storyId: selected.story.storyId }, evidenceUrls }, selected.story, await store.feedbackRecords())
      : unlocated(text, origin, context)
    if (!selected) record.evidenceUrls = evidenceUrls
    await store.saveFeedback(record)
    let revisionId: string | null = null
    if (record.status === 'ready' && selected && options.coordinator) {
      try { revisionId = await options.coordinator.enqueue(record, selected) }
      catch (error) {
        await store.saveFeedback({ ...record, status: 'queue_failed' })
        throw error
      }
    } else if (record.status === 'duplicate' && selected && options.coordinator && store.revisionForFeedback) {
      const prior = await store.feedback(record.duplicateOf!)
      if (prior?.status === 'ready' && !await store.revisionForFeedback(prior.id)) {
        // A prior ready record may have been saved just before enqueue failed;
        // retry its original ID so coordinator idempotency and audit lineage hold.
        revisionId = await options.coordinator.enqueue(prior, selected)
      }
    }
    return payload(record, revisionId)
  })
  json(response, 202, result)
}

async function handleClarification(id: string, request: IncomingMessage, response: ServerResponse, options: CollectorServerOptions, store: FeedbackStore, mutex: FeedbackMutex): Promise<void> {
  const input = await body(request)
  const answer = typeof input.answer === 'string' ? input.answer.trim() : ''
  if (!answer) { json(response, 400, { error: '请补充你指的故事或位置' }); return }
  const result = await mutex.run(async () => {
    const original = await store.feedback(id)
    if (!original) return { status: 404, value: { error: '没有找到这条反馈' } }
    if (original.status !== 'needs_clarification') return { status: 409, value: { error: '这条反馈不需要澄清' } }
    const stories = await listStories(options)
    const selected = stories.find((item) => item.story.storyId === original.context.storyId)
    ?? stories.find((item) => answer.includes(item.story.storyId) || answer.includes(item.story.title))
    ?? (stories.length === 1 ? stories[0] : undefined)
    let next: FeedbackRecord
    if (!selected) {
      next = { ...original, clarification: [...original.clarification, { question: original.question ?? '', answer }], question: '我还没找到对应故事，请从页面的故事列表选择名称。' }
    } else if (!original.context.storyId || original.context.storyId !== selected.story.storyId) {
      const located = receiveFeedback({
        origin: original.origin, text: `${original.originalText} ${answer}`,
        context: { contentRevision: original.context.contentRevision, sceneRevision: original.context.sceneRevision, storyId: selected.story.storyId },
        evidenceUrls: original.evidenceUrls,
      }, selected.story)
      next = { ...located, id: original.id, originalText: original.originalText, receivedAt: original.receivedAt,
        clarification: [...original.clarification, { question: original.question ?? '', answer }] }
    } else {
      next = clarifyFeedback(original, answer, selected.story)
    }
    if (next.status === 'ready') {
      const prior = (await store.feedbackRecords()).find((item) => item.id !== next.id &&
        item.fingerprint === next.fingerprint && !['rejected', 'queue_failed'].includes(item.status))
      if (prior) next = { ...next, status: 'duplicate', duplicateOf: prior.duplicateOf ?? prior.id, question: null }
    }
    await store.saveFeedback(next)
    let revisionId: string | null = null
    if (next.status === 'ready' && selected && options.coordinator) {
      try { revisionId = await options.coordinator.enqueue(next, selected) }
      catch (error) {
        await store.saveFeedback({ ...next, status: 'queue_failed' })
        throw error
      }
    } else if (next.status === 'duplicate' && selected && options.coordinator && store.revisionForFeedback) {
      const prior = await store.feedback(next.duplicateOf!)
      if (prior?.status === 'ready' && !await store.revisionForFeedback(prior.id)) {
        revisionId = await options.coordinator.enqueue(prior, selected)
      }
    }
    return { status: 200, value: payload(next, revisionId) }
  })
  json(response, result.status, result.value)
}

async function handleHandoff(storyId: string, requested: string | null, expectedRevision: string | null, response: ServerResponse, options: CollectorServerOptions): Promise<void> {
  if (!STORY_ID.test(storyId)) { json(response, 400, { error: '故事 ID 无效' }); return }
  const loaded = await loadCollection(path.join(options.outputDirectory ?? path.join(options.root, 'output'), storyId), false)
  if (!loaded) { json(response, 404, { error: '没有可交接的已发布资料包' }); return }
  if (expectedRevision !== null) {
    if (!/^[1-9]\d*$/.test(expectedRevision)) { json(response, 400, { error: '资料版本无效' }); return }
    if (Number(expectedRevision) !== loaded.story.contentRevision) { json(response, 409, { error: '资料版本已变化，请重新获取清单' }); return }
  }
  const files = new Set<string>(['story.json', 'sources.json', loaded.story.routeOverview.imagePath])
  for (const source of loaded.sources.sources) if (source.locator.localPath) files.add(source.locator.localPath)
  if (requested === null || requested === 'manifest') {
    json(response, 200, { schemaVersion: loaded.story.schemaVersion, storyId, contentRevision: loaded.story.contentRevision, status: loaded.story.status, files: [...files].sort() })
    return
  }
  if (!files.has(requested)) { json(response, 404, { error: '文件不属于交接包' }); return }
  const reader = createNodeReader(loaded.directory)
  const bytes = await reader.readBinary(requested)
  if (!bytes) { json(response, 404, { error: '文件不可读取' }); return }
  // Publishing swaps whole directories. Recheck after reading, so bytes cannot be
  // labelled with the revision loaded before a concurrent swap.
  const current = await loadCollection(loaded.directory, false)
  if (!current || current.story.contentRevision !== loaded.story.contentRevision) {
    json(response, 409, { error: '资料版本已变化，请重新获取清单' }); return
  }
  response.writeHead(200, {
    'content-type': requested.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream',
    'content-disposition': requested.endsWith('.json') ? 'inline' : 'attachment',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'x-story-revision': String(loaded.story.contentRevision),
  })
  response.end(Buffer.from(bytes))
}

export function createCollectorServer(options: CollectorServerOptions): Server {
  const store = options.store ?? new CollectorStore(options.root)
  const feedbackMutex = new FeedbackMutex()
  return createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? ''
      if (!/^((127\.0\.0\.1)|(localhost))(\:\d+)?$/.test(host)) { json(response, 403, { error: '仅允许本机访问' }); return }
      const address = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && (address.pathname === '/' || address.pathname === '/app.js')) {
        const filename = address.pathname === '/' ? 'index.html' : 'app.js'
        const file = await readFile(new URL(`../public/${filename}`, import.meta.url))
        response.writeHead(200, {
          'content-type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'",
        })
        response.end(file)
        return
      }
      if (request.method === 'GET' && address.pathname === '/api/collector/stories') {
        const stories = await listStories(options)
        json(response, 200, stories.map((item) => ({ storyId: item.story.storyId, title: item.story.title, status: item.story.status, contentRevision: item.story.contentRevision, demo: item.demo })))
        return
      }
      if (request.method === 'POST' && address.pathname === '/api/collector/feedback') {
        await handleFeedback(request, response, options, store, feedbackMutex); return
      }
      const revision = address.pathname.match(/^\/api\/collector\/revisions\/([a-f0-9-]+)$/)
      if (request.method === 'GET' && revision) {
        if (!store.revision) { json(response, 501, { error: '未配置修订状态存储' }); return }
        const found = await store.revision(revision[1])
        if (!found) { json(response, 404, { error: '没有找到这次修订' }); return }
        json(response, 200, found)
        return
      }
      const clarify = address.pathname.match(/^\/api\/collector\/feedback\/([a-f0-9-]+)\/clarify$/)
      if (request.method === 'POST' && clarify) { await handleClarification(clarify[1], request, response, options, store, feedbackMutex); return }
      const handoff = address.pathname.match(/^\/api\/collector\/handoff\/([^/]+)(?:\/(.*))?$/)
      if (request.method === 'GET' && handoff) {
        let storyId: string; let requested: string | null
        try { storyId = decodeURIComponent(handoff[1]); requested = handoff[2] ? decodeURIComponent(handoff[2]) : null }
        catch { json(response, 400, { error: '路径编码无效' }); return }
        await handleHandoff(storyId, requested, address.searchParams.get('contentRevision'), response, options); return
      }
      json(response, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && /^(请使用 JSON 请求|反馈内容过长|请求内容格式错误)$/.test(error.message))) {
        json(response, 400, { error: '请求内容格式不正确' })
      } else {
        json(response, 500, { error: '处理失败；请在本机检查服务日志' })
      }
    }
  })
}
