import { describe, expect, it } from 'vitest'

import { TypeSafeJevJudge } from '../collector/src/jev.ts'
import type { NarrowQuestion } from '../collector/src/types.ts'

const question: NarrowQuestion = {
  id: 'narrow-fixture', claimId: 'claim-fixture',
  question: 'Compare the evidence for this narrow synthetic claim only.',
  evidenceA: 'Synthetic support excerpt A', evidenceB: 'Synthetic counter excerpt B',
}

describe('Jev 官方 System One 协议适配（只用模拟 HTTP，不发送真实史料）', () => {
  it('只发送窄判断与两侧摘录，读取 Choice 概率、置信度及版本', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const mocked = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(url), init: init! })
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { verdict: {
        type: 'choice', choice: 'a', confidence: 0.82,
        probabilities: { a: 0.87, b: 0.08, unclear: 0.05 },
      } }, usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 })
    }
    const judge = new TypeSafeJevJudge('synthetic-test-key', mocked as typeof fetch)
    const decision = await judge.judge(question)
    expect(requests[0].url).toBe('https://api.typesafe.ai/v1/systemone')
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>
    expect(body.model).toBe('jev-latest')
    expect(body.state).toEqual({ claim: question.question, supportExcerpt: question.evidenceA, opposingExcerpt: question.evidenceB })
    expect(body.questions).toMatchObject({ verdict: { type: 'choice', criteria: { a: expect.any(String), b: expect.any(String), unclear: expect.any(String) } } })
    expect(requests[0].init.headers).toMatchObject({ authorization: 'Bearer synthetic-test-key' })
    expect(decision).toMatchObject({ questionId: question.id, verdict: 'a', model: 'jev-1.13.0', confidence: 0.82,
      probabilities: { a: 0.87, b: 0.08, unclear: 0.05 } })
    expect(JSON.stringify(decision)).not.toContain('synthetic-test-key')
    expect(JSON.stringify(decision)).not.toContain(question.evidenceA)
  })

  it('低置信度、缺少概率或异常响应一律不作为明确支持', async () => {
    const low = new TypeSafeJevJudge('synthetic', (async () => new Response(JSON.stringify({
      model: 'jev-1.13.0', answers: { verdict: { type: 'choice', choice: 'a', confidence: 0.3,
        probabilities: { a: 0.5, b: 0.3, unclear: 0.2 } } },
    }), { status: 200 })) as typeof fetch)
    expect((await low.judge(question)).verdict).toBe('unclear')
    const malformed = new TypeSafeJevJudge('synthetic', (async () => new Response(JSON.stringify({
      model: 'jev-1.13.0', answers: { verdict: { type: 'choice', choice: 'a', confidence: 1 } },
    }), { status: 200 })) as typeof fetch)
    await expect(malformed.judge(question)).rejects.toThrow('响应格式')
  })

  it('Choice 自报 a 与最高概率 b 冲突时拒绝判断', async () => {
    const inconsistent = new TypeSafeJevJudge('synthetic', (async () => new Response(JSON.stringify({
      model: 'jev-1.13.0', answers: { verdict: { type: 'choice', choice: 'a', confidence: 0.95,
        probabilities: { a: 0.01, b: 0.98, unclear: 0.01 } } },
    }), { status: 200 })) as typeof fetch)
    await expect(inconsistent.judge(question)).rejects.toThrow('响应格式')
  })

  it('HTTP 错误不回显服务端原文、提问或密钥', async () => {
    const judge = new TypeSafeJevJudge('synthetic-secret', (async () => new Response(
      'synthetic-secret Synthetic support excerpt A', { status: 401 },
    )) as typeof fetch)
    await expect(judge.judge(question)).rejects.toThrow('HTTP 401')
    try { await judge.judge(question) } catch (error) {
      expect(String(error)).not.toContain('synthetic-secret')
      expect(String(error)).not.toContain(question.evidenceA)
    }
  })
})
