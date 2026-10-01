import { describe, expect, it } from 'vitest'

import { extractCandidate } from '../collector/src/evidence.ts'
import { RUBRIC_DIMENSIONS, screenEvidence, type HumanReview, type RubricPolicy } from '../collector/src/policy.ts'
import type { NarrowDecision, SearchHit } from '../collector/src/types.ts'

const hit: SearchHit = {
  provider: 'fixture', queryId: 'q-1', title: 'Synthetic primary record',
  url: 'https://example.org/record', snippet: 'fixture only', sourceType: 'museum',
  author: 'Fixture curator', publishedAt: '2026-09-25', doi: null,
  rights: 'Synthetic fixture; reuse in tests allowed', retrievedAt: '2026-09-25T00:00:00Z',
}
const candidate = extractCandidate(hit, {
  subjectId: 'fixture-story', property: 'narrative', statement: 'Synthetic claim', value: 'Synthetic value',
  unit: null, evidenceType: 'documented', originalLocation: 'fixture page 1',
  supportExcerpt: 'Synthetic excerpt', isDirectQuote: true, extractionNote: 'Not a historical claim',
}, ['fixture-story'])
const policy: RubricPolicy = {
  version: 'synthetic-approved', status: 'approved', approvedBy: 'fixture-owner',
  approvedAt: '2026-09-25T00:00:00Z', calibrationRecord: 'synthetic-calibration',
}
function review(): HumanReview {
  return {
    reviewer: 'fixture-reviewer', decision: 'retain', reviewedAt: '2026-09-25T00:00:00Z', reasons: [],
    assessments: RUBRIC_DIMENSIONS.map((dimension) => ({
      dimension, level: 2, reason: `${dimension} verified in synthetic fixture`, evidenceRefs: ['fixture page 1'],
    })),
  }
}

describe('筛选门槛反例校准（全部为合成数据）', () => {
  it('七维都有定位、等级至少 2、政策获批且人审时才可保留', () => {
    expect(screenEvidence(candidate, policy, review(), null).result).toBe('retain')
  })

  it.each(RUBRIC_DIMENSIONS)('%s 单维降到 1，即使其余六维满分也不能保留', (dimension) => {
    const low = review()
    low.assessments = low.assessments.map((item) => ({
      ...item, level: item.dimension === dimension ? 1 : 3,
    }))
    const decision = screenEvidence(candidate, policy, low, null)
    expect(decision.result).toBe('needs_human')
    expect(decision.reasons.some((reason) => reason.includes(`${dimension} 等级 1`))).toBe(true)
  })

  it('重复维度或空证据指针不能伪装成完整逐维审核', () => {
    const duplicate = review()
    duplicate.assessments.push({ ...duplicate.assessments[0] })
    expect(screenEvidence(candidate, policy, duplicate, null).result).toBe('needs_human')
    const emptyRef = review()
    emptyRef.assessments[0].evidenceRefs = ['  ']
    expect(screenEvidence(candidate, policy, emptyRef, null).result).toBe('needs_human')
  })

  it('人审明确拒绝时不得被高等级分数覆盖', () => {
    const rejected = review()
    rejected.decision = 'reject'
    rejected.reasons = ['合成反例不适用']
    expect(screenEvidence(candidate, policy, rejected, null).result).toBe('reject')
  })

  it('Jev 指向反证、判断不匹配或不明确，均不得自动保留', () => {
    const disputed = { ...candidate, opposingExcerpts: ['Synthetic opposing excerpt'] }
    const baseline: NarrowDecision = {
      questionId: `narrow-${candidate.id}`, verdict: 'b', model: 'synthetic',
      rationale: 'Synthetic counterargument', rawResponseRef: 'fixture',
    }
    const human = review()
    human.reasons = ['对比反证后的合成理由']
    expect(screenEvidence(disputed, policy, human, baseline).result).toBe('needs_human')
    expect(screenEvidence(disputed, policy, human, { ...baseline, verdict: 'unclear' }).result).toBe('needs_human')
    expect(screenEvidence(disputed, policy, human, { ...baseline, questionId: 'other', verdict: 'a' }).result).toBe('needs_human')
  })

  it('评分政策未批准、来源权利待核，都不能输出保留结论', () => {
    expect(screenEvidence(candidate, { ...policy, status: 'draft' }, review(), null).result).toBe('needs_human')
    expect(screenEvidence(candidate, { ...policy, approvedAt: 'not-a-date' }, review(), null).result).toBe('needs_human')
    const unknownRights = { ...candidate, source: { ...candidate.source, rights: '待确认' } }
    expect(screenEvidence(unknownRights, policy, review(), null).result).toBe('needs_human')
  })

  it('伪造额外维度或无效评审时间不能绕过校准', () => {
    const extra = review()
    extra.assessments.push({ dimension: 'madeUpDimension' as 'rights', level: 3, reason: 'invalid', evidenceRefs: ['fixture'] })
    expect(screenEvidence(candidate, policy, extra, null).result).toBe('needs_human')
    const invalidTime = review()
    invalidTime.reviewedAt = 'not-a-date'
    expect(screenEvidence(candidate, policy, invalidTime, null).result).toBe('needs_human')
  })
})
