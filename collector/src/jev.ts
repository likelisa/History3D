import type { NarrowDecision, NarrowQuestion } from './types.ts'

export interface NarrowJudge {
  judge(question: NarrowQuestion): Promise<NarrowDecision>
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Official System One Choice API. No request/response bodies are logged or persisted. */
export class TypeSafeJevJudge implements NarrowJudge {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
    private readonly model = 'jev-latest',
    // Conservative engineering gate; historical calibration must set the final threshold.
    private readonly minConfidence = 0.8,
  ) {
    if (!apiKey.trim()) throw new Error('Jev API key 未配置')
  }

  async judge(question: NarrowQuestion): Promise<NarrowDecision> {
    if (!question.question.trim() || !question.evidenceA.trim() || !question.evidenceB.trim()) {
      throw new Error('Jev 窄判断缺少问题或证据')
    }
    const response = await this.request('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { claim: question.question, supportExcerpt: question.evidenceA, opposingExcerpt: question.evidenceB },
        model: this.model,
        questions: { verdict: {
          type: 'choice',
          instructions: 'Only compare the two excerpts for this single narrow claim. Which excerpt directly bears on the claim? If neither, both, or context is insufficient, choose unclear. Do not infer facts beyond the excerpts.',
          criteria: {
            a: 'Excerpt A directly supports the narrow claim more than B weakens it.',
            b: 'Excerpt B directly weakens or contradicts the narrow claim.',
            unclear: 'The excerpts are insufficient, incomparable, or ambiguous.',
          },
        } },
      }),
    })
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`)
    let payload: JsonObject
    try { payload = object(await response.json()) }
    catch { throw new Error('Jev 响应格式无效') }
    const answer = object(object(payload.answers).verdict)
    const probabilities = object(answer.probabilities)
    const a = probabilities.a; const b = probabilities.b; const unclear = probabilities.unclear
    if (answer.type !== 'choice' || !['a', 'b', 'unclear'].includes(String(answer.choice)) ||
        !probability(answer.confidence) || !probability(a) || !probability(b) || !probability(unclear) ||
        Math.abs(a + b + unclear - 1) > 0.02 || typeof payload.model !== 'string' || !payload.model.trim()) {
      throw new Error('Jev 响应格式无效')
    }
    const probabilitiesTyped = { a, b, unclear }
    const selected = answer.choice as 'a' | 'b' | 'unclear'
    // Official Choice semantics: `choice` is the highest-probability option.
    // A contradictory or tied result is not a safe positive judgment.
    const highest = Math.max(a, b, unclear)
    if (probabilitiesTyped[selected] !== highest || [a, b, unclear].filter((p) => p === highest).length !== 1) {
      throw new Error('Jev 响应格式无效')
    }
    const verdict = answer.confidence >= this.minConfidence ? selected : 'unclear'
    return {
      questionId: question.id, verdict, model: payload.model,
      confidence: answer.confidence, probabilities: probabilitiesTyped,
      rationale: verdict === 'unclear' ? '低置信度或无法判断；需人工复核' : '仅为摘录窄比较；不代表史料真实性结论',
      rawResponseRef: 'not-stored',
    }
  }
}

/** Jev 只处理已经拆成 A/B/不确定的窄问题；调用失败时流程必须停在 J。 */
export async function judgeNarrowQuestions(
  questions: readonly NarrowQuestion[],
  judge: NarrowJudge | null,
): Promise<{ decisions: NarrowDecision[]; unresolved: string[] }> {
  if (questions.length === 0) return { decisions: [], unresolved: [] }
  if (!judge) return { decisions: [], unresolved: questions.map((item) => `${item.id}: Jev 未配置`) }
  const decisions: NarrowDecision[] = []
  const unresolved: string[] = []
  for (const question of questions) {
    if (!question.question.trim() || !question.evidenceA.trim() || !question.evidenceB.trim()) {
      unresolved.push(`${question.id}: 问题或两侧证据不完整`)
      continue
    }
    try {
      const decision = await judge.judge(question)
      if (decision.questionId !== question.id || !['a', 'b', 'unclear'].includes(decision.verdict)) {
        unresolved.push(`${question.id}: 判断响应与提问不匹配`)
      } else {
        decisions.push(decision)
        if (decision.verdict === 'unclear') unresolved.push(`${question.id}: Jev 判断不明确`)
      }
    } catch {
      // Provider exceptions may contain authentication headers or signed URLs.
      unresolved.push(`${question.id}: Jev 调用失败；请查看受控服务端诊断`)
    }
  }
  return { decisions, unresolved }
}
