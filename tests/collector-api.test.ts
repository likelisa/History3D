import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createCollectorServer, type FeedbackStore } from '../collector/src/server.ts'
import type { FeedbackRecord } from '../collector/src/types.ts'

const saved = new Map<string, FeedbackRecord>()
const queued: string[] = []
const store: FeedbackStore = {
  async saveFeedback(record) { saved.set(record.id, record) },
  async feedbackRecords() { return [...saved.values()] },
  async feedback(id) { return saved.get(id) ?? null },
}
const server = createCollectorServer({
  root: 'unused-in-test',
  outputDirectory: path.resolve('contracts/fixtures/collection'),
  store,
  coordinator: { async enqueue(record) { queued.push(record.id); return 'synthetic-revision-id' } },
})
let baseUrl = ''

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

describe('两个采集业务接口', () => {
  it('用户只写自然语言即可提交，歧义会追问并保留原话', async () => {
    const response = await fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '这个不对' }),
    })
    expect(response.status).toBe(202)
    const first = await response.json() as { id: string; status: string; question: string }
    expect(first.status).toBe('needs_clarification')
    expect(first.question).toContain('哪个')
    const followUp = await fetch(`${baseUrl}/api/collector/feedback/${first.id}/clarify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'brief-beast' }),
    })
    expect(followUp.status).toBe(200)
    const second = await followUp.json() as { status: string; revisionId: string }
    expect(second.status).toBe('ready')
    expect(second.revisionId).toBe('synthetic-revision-id')
    expect(queued).toContain(first.id)
    expect(saved.get(first.id)?.originalText).toBe('这个不对')
    expect(saved.get(first.id)?.clarification).toHaveLength(1)
  })

  it('向 B 提供版本清单和三件套文件，只开放已引用素材', async () => {
    const manifestResponse = await fetch(`${baseUrl}/api/collector/handoff/silk-road-demo/manifest`)
    expect(manifestResponse.status).toBe(200)
    const manifest = await manifestResponse.json() as { contentRevision: number; files: string[] }
    expect(manifest.contentRevision).toBe(1)
    expect(manifest.files).toContain('story.json')
    expect(manifest.files).toContain('sources.json')
    expect(manifest.files).toContain('references/route-overview.svg')
    const storyResponse = await fetch(`${baseUrl}/api/collector/handoff/silk-road-demo/story.json`)
    expect(storyResponse.status).toBe(200)
    expect((await storyResponse.json() as { storyId: string }).storyId).toBe('silk-road-demo')
    expect((await fetch(`${baseUrl}/api/collector/handoff/silk-road-demo/references/not-in-package.svg`)).status).toBe(404)
  })

  it('不接受不合法反馈请求', async () => {
    const response = await fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    })
    expect(response.status).toBe(400)
  })

  it('B 可锁定清单版本逐个取文件，版本变化时拒绝混包', async () => {
    const correct = await fetch(`${baseUrl}/api/collector/handoff/silk-road-demo/story.json?contentRevision=1`)
    expect(correct.status).toBe(200)
    const stale = await fetch(`${baseUrl}/api/collector/handoff/silk-road-demo/sources.json?contentRevision=99`)
    expect(stale.status).toBe(409)
  })

  it('错误对象 ID 从 HTTP 追问后可恢复；重复提交不重复排队', async () => {
    const text = 'brief-pack 外形不对，测试反馈唯一值 alpha-2409'
    const firstResponse = await fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'generator', text, context: { storyId: 'silk-road-demo', subjectId: 'old-pack', contentRevision: 1 } }),
    })
    const first = await firstResponse.json() as { id: string; status: string; question: string }
    expect(first.status).toBe('needs_clarification')
    const clarifiedResponse = await fetch(`${baseUrl}/api/collector/feedback/${first.id}/clarify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: '我指的是 brief-pack' }),
    })
    const clarified = await clarifiedResponse.json() as { status: string }
    expect(clarified.status).toBe('ready')
    expect(saved.get(first.id)?.context.subjectId).toBe('brief-pack')
    const before = queued.length
    const duplicateResponse = await fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'generator', text, context: { storyId: 'silk-road-demo', subjectId: 'brief-pack', contentRevision: 1 } }),
    })
    const duplicate = await duplicateResponse.json() as { status: string; duplicateOf: string }
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.duplicateOf).toBe(first.id)
    expect(queued).toHaveLength(before)
  })

  it('同一原话先追问后定位到已有对象，最终指纹重复则不能再次排队', async () => {
    const text = 'brief-beast 颜色不对 synthetic-unique-clarified-duplicate'
    const post = (context: Record<string, unknown>) => fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, context }),
    })
    const first = await (await post({ storyId: 'silk-road-demo', subjectId: 'brief-beast', contentRevision: 1 })).json() as { id: string; status: string }
    expect(first.status).toBe('ready')
    const before = queued.length
    const second = await (await post({ storyId: 'silk-road-demo', subjectId: 'obsolete-beast', contentRevision: 1 })).json() as { id: string; status: string }
    expect(second.status).toBe('needs_clarification')
    const clarified = await (await fetch(`${baseUrl}/api/collector/feedback/${second.id}/clarify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: 'brief-beast' }),
    })).json() as { status: string; duplicateOf: string | null; revisionId: string | null }
    expect(clarified.status).toBe('duplicate')
    expect(clarified.duplicateOf).toBe(first.id)
    expect(clarified.revisionId).toBeNull()
    expect(queued).toHaveLength(before)
  })

  it('并发相同反馈只排队一次，已拒绝旧反馈可重新提交', async () => {
    const text = 'brief-pack synthetic-concurrent-unique-0926'
    const context = { storyId: 'silk-road-demo', subjectId: 'brief-pack', contentRevision: 1 }
    const post = () => fetch(`${baseUrl}/api/collector/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, context }),
    }).then((response) => response.json() as Promise<{ id: string; status: string; duplicateOf: string | null; revisionId: string | null }>)
    const old = await post()
    expect(old.status).toBe('ready')
    saved.set(old.id, { ...saved.get(old.id)!, status: 'rejected' })
    const before = queued.length
    const [a, b] = await Promise.all([post(), post()])
    expect([a.status, b.status].sort()).toEqual(['duplicate', 'ready'])
    expect(queued).toHaveLength(before + 1)
    const third = await post()
    expect(third.status).toBe('duplicate')
    expect(queued).toHaveLength(before + 1)
  })

  it('存储读取故意延迟时，并发相同反馈仍只保存一个 ready 并排队一次', async () => {
    const records = new Map<string, FeedbackRecord>()
    let enqueued = 0
    const delayedStore: FeedbackStore = {
      async saveFeedback(record) { records.set(record.id, record) },
      async feedbackRecords() {
        const snapshot = [...records.values()]
        await new Promise((resolve) => setTimeout(resolve, 30))
        return snapshot
      },
      async feedback(id) { return records.get(id) ?? null },
    }
    const isolated = createCollectorServer({
      root: 'unused-in-test', outputDirectory: path.resolve('contracts/fixtures/collection'),
      store: delayedStore, coordinator: { async enqueue() { enqueued += 1; return 'synthetic-revision-id' } },
    })
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(isolated.address() as AddressInfo).port}/api/collector/feedback`
    try {
      const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'brief-pack concurrent delayed snapshot', context: { storyId: 'silk-road-demo', contentRevision: 1 } }),
      }).then((response) => response.json() as Promise<{ status: string }>)
      const [a, b] = await Promise.all([post(), post()])
      expect([a.status, b.status].sort()).toEqual(['duplicate', 'ready'])
      expect(enqueued).toBe(1)
    } finally {
      await new Promise<void>((resolve) => isolated.close(() => resolve()))
    }
  })

  it('排队失败须留下可重试状态；再次提交相同反馈必须成功排队', async () => {
    const records = new Map<string, FeedbackRecord>()
    const failedStore: FeedbackStore = {
      async saveFeedback(record) { records.set(record.id, record) },
      async feedbackRecords() { return [...records.values()] },
      async feedback(id) { return records.get(id) ?? null },
    }
    let calls = 0
    const isolated = createCollectorServer({
      root: 'unused-in-test', outputDirectory: path.resolve('contracts/fixtures/collection'),
      store: failedStore, coordinator: { async enqueue() {
        calls += 1
        if (calls === 1) throw new Error('synthetic queue failure')
        return 'recovered-revision'
      } },
    })
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(isolated.address() as AddressInfo).port}/api/collector/feedback`
    const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'brief-pack synthetic queue recovery', context: { storyId: 'silk-road-demo', contentRevision: 1 } }),
    })
    try {
      const first = await post()
      expect(first.status).toBeGreaterThanOrEqual(500)
      expect([...records.values()].map((record) => record.status)).toEqual(['queue_failed'])
      const retry = await post()
      expect(retry.status).toBe(202)
      expect(await retry.json()).toMatchObject({ status: 'ready', revisionId: 'recovered-revision' })
      expect(calls).toBe(2)
    } finally {
      await new Promise<void>((resolve) => isolated.close(() => resolve()))
    }
  })

  it('失败状态自身写入失败时，重提仍能恢复原反馈排队', async () => {
    const records = new Map<string, FeedbackRecord>()
    const fragileStore: FeedbackStore = {
      async saveFeedback(record) {
        if (record.status === 'queue_failed') throw new Error('synthetic disk failure')
        records.set(record.id, record)
      },
      async feedbackRecords() { return [...records.values()] },
      async feedback(id) { return records.get(id) ?? null },
      async revisionForFeedback() { return null },
    }
    let calls = 0
    const isolated = createCollectorServer({
      root: 'unused-in-test', outputDirectory: path.resolve('contracts/fixtures/collection'),
      store: fragileStore, coordinator: { async enqueue() {
        calls += 1
        if (calls === 1) throw new Error('synthetic queue failure')
        return 'recovered-revision'
      } },
    })
    await new Promise<void>((resolve) => isolated.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(isolated.address() as AddressInfo).port}/api/collector/feedback`
    const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'brief-pack synthetic double failure', context: { storyId: 'silk-road-demo', contentRevision: 1 } }),
    })
    try {
      expect((await post()).status).toBe(500)
      const retried = await post()
      expect(retried.status).toBe(202)
      expect(await retried.json()).toMatchObject({ revisionId: 'recovered-revision' })
      expect(calls).toBe(2)
    } finally {
      await new Promise<void>((resolve) => isolated.close(() => resolve()))
    }
  })
})
