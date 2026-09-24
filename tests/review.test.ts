import { describe, expect, it } from 'vitest'
import type { ReviewEvidenceBundle } from '../contracts/src/handoff-types.ts'
import { validateReviewOutput } from '../processing/src/review/validate.ts'
import { reviewWithDeepSeek } from '../processing/src/review/deepseek.ts'
import { reviewCacheKey } from '../processing/src/review/orchestrator.ts'
import path from 'node:path'

const evidence: ReviewEvidenceBundle = {
  scope: 'input', snapshotHash: 'a'.repeat(64), rubricVersion: 'input-v1',
  images: [{ viewId: 'front', subjectRef: 'asset@1:hash', path: path.resolve('records/screenshots/04-overview.png'), sha256: 'b'.repeat(64), camera: 'test' }],
  metrics: [{ subjectRef: 'asset@1:hash', name: 'dimensionsM', value: '[1,1,1]', unit: 'm' }],
  texts: [{ refId: 'plan.md', text: 'sample', sha256: 'c'.repeat(64) }],
  coverage: [{ subjectRef: 'asset@1:hash', views: ['front'], status: 'assessed' }],
}

describe('AI review gate', () => {
  it('invalidates review reuse when a rendered view changes', () => {
    const changed = { ...evidence, images: evidence.images.map((item) => ({ ...item, sha256: 'd'.repeat(64) })) }
    expect(reviewCacheKey(changed)).not.toBe(reviewCacheKey(evidence))
  })
  it('rejects invented subjects and citations', () => {
    const finding = { findingId: 'f1', category: 'geometry', subjectRefs: ['fake'], observation: 'bad', expected: 'good', impact: 'blocked', evidenceRefs: ['front'], certainty: 'observed', severity: 'blocking', suggestedOwner: 'processor', requestedInformation: null, repairGoal: 'repair', acceptanceCheck: 'inspect again' }
    expect(() => validateReviewOutput({ decision: 'needs_revision', findings: [finding], unassessed: [], suggestedStrategies: [] }, evidence)).toThrow('unknown subject')
    finding.subjectRefs = ['asset@1:hash']
    finding.evidenceRefs = ['nonexistent-view']
    expect(() => validateReviewOutput({ decision: 'needs_revision', findings: [finding], unassessed: [], suggestedStrategies: [] }, evidence)).toThrow('unknown evidence')
  })

  it('never lets missing visual coverage become pass', () => {
    const incomplete = { ...evidence, coverage: [{ subjectRef: 'asset@1:hash', views: ['front'], status: 'unassessed' as const }] }
    expect(() => validateReviewOutput({ decision: 'pass', findings: [], unassessed: [], suggestedStrategies: [] }, incomplete)).toThrow('cannot pass')
  })

  it('records story-level attribution when the model omits a subject', () => {
    const withStory = { ...evidence, texts: [...evidence.texts, { refId: 'story.json', text: '{"storyId":"fixture-story"}', sha256: 'd'.repeat(64) }] }
    const finding = { findingId: 'f1', category: 'plan_gap', subjectRefs: [], observation: 'gap', expected: 'clarify', impact: 'blocked', evidenceRefs: ['plan.md'], certainty: 'observed', severity: 'blocking', suggestedOwner: 'collector', requestedInformation: 'clarify plan', repairGoal: null, acceptanceCheck: 'new plan reviewed' }
    const result = validateReviewOutput({ decision: 'needs_information', findings: [finding], unassessed: [], suggestedStrategies: [] }, withStory)
    expect(result.findings[0].subjectRefs).toEqual(['fixture-story'])
    expect(result.normalizationNotes).toHaveLength(1)
  })

  it('accepts structured gaps and strategies only with known references', () => {
    const finding = { findingId: 'f1', category: 'assembly', subjectRefs: ['asset@1:hash'], observation: 'gap', expected: 'attach', impact: 'visible', evidenceRefs: ['front'], certainty: 'observed', severity: 'warning', suggestedOwner: 'processor', requestedInformation: null, repairGoal: 'attach', acceptanceCheck: 'inspect again' }
    const response = { decision: 'needs_revision', findings: [finding], unassessed: [{ item: 'motion', reason: 'still image', requiredEvidence: 'video', subjectRefs: ['asset@1:hash'] }], suggestedStrategies: [{ strategyId: 's1', targetFindingIds: ['f1'], action: 'repair', rationale: 'attachment gap' }] }
    expect(validateReviewOutput(response, evidence).suggestedStrategies).toHaveLength(1)
    response.suggestedStrategies[0].targetFindingIds = ['invented']
    expect(() => validateReviewOutput(response, evidence)).toThrow('invalid strategy')
  })

  it('accepts asset comparison gaps with checked evidence and subject IDs', () => {
    const response = { decision: 'needs_information', findings: [], unassessed: [{ aspect: 'assembly', reason: 'only asset images', neededEvidence: 'world frame', subjectRefs: ['asset@1:hash'], evidenceRefs: ['front', 'plan.md'] }], suggestedStrategies: [{ strategy: 'contrast-probe', targetRef: 'asset@1:hash', suggestedOwner: 'processor', repairGoal: 'compare contrast', acceptanceCheck: 'readable silhouette', priority: 'medium' }] }
    expect(validateReviewOutput(response, evidence).unassessed).toHaveLength(1)
    response.unassessed[0].evidenceRefs = ['fabricated-view']
    expect(() => validateReviewOutput(response, evidence)).toThrow('invalid unassessed')
    response.unassessed[0].evidenceRefs = ['front']
    response.suggestedStrategies[0].targetRef = 'plan.md'
    expect(validateReviewOutput(response, evidence).suggestedStrategies).toHaveLength(1)
    response.suggestedStrategies[0].targetRef = 'fabricated-target'
    expect(() => validateReviewOutput(response, evidence)).toThrow('invalid strategy')
  })

  it('rejects truncated and empty model output', async () => {
    const fakeFetch = (reason: string, content: string) => (async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: reason, message: { content } }] }) })) as unknown as typeof fetch
    await expect(reviewWithDeepSeek(evidence, { apiKey: 'test', fetchImpl: fakeFetch('length', '{}') })).rejects.toThrow('REVIEW_OUTPUT_INVALID')
    await expect(reviewWithDeepSeek(evidence, { apiKey: 'test', fetchImpl: fakeFetch('stop', '') })).rejects.toThrow('empty content')
  })
})
