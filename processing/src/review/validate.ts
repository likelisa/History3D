import type { ReviewEvidenceBundle, ReviewFinding, ReviewReport } from '../../../contracts/src/handoff-types.ts'

const categories = new Set(['evidence_gap', 'plan_gap', 'asset_gap', 'geometry', 'material', 'assembly', 'narrative', 'runtime'])
const decisions = new Set(['pass', 'needs_revision', 'needs_information', 'inconclusive'])
const owners = new Set(['collector', 'processor', 'viewer'])
const severities = new Set(['blocking', 'warning', 'info'])
const certainties = new Set(['observed', 'suspected', 'insufficient_evidence'])
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function validateReviewOutput(raw: unknown, evidence: ReviewEvidenceBundle): Pick<ReviewReport, 'decision' | 'findings' | 'unassessed' | 'suggestedStrategies' | 'normalizationNotes'> {
  if (!raw || typeof raw !== 'object') throw new Error('REVIEW_OUTPUT_INVALID: response is not an object')
  const value = raw as Record<string, unknown>
  if (!decisions.has(String(value.decision))) throw new Error('REVIEW_OUTPUT_INVALID: invalid decision')
  if (!Array.isArray(value.findings) || !Array.isArray(value.unassessed) || !Array.isArray(value.suggestedStrategies)) throw new Error('REVIEW_OUTPUT_INVALID: lists missing')
  const evidenceRefs = new Set([...evidence.images.map((item) => item.viewId), ...evidence.metrics.map((item) => item.name), ...evidence.texts.map((item) => item.refId)])
  const storyText = evidence.texts.find((item) => item.refId === 'story.json')?.text
  let storyId: string | null = null
  try { const parsed = JSON.parse(storyText ?? '') as { storyId?: unknown }; if (nonempty(parsed.storyId)) storyId = parsed.storyId } catch { /* world evidence may not include story.json */ }
  const subjects = new Set([...evidence.coverage.map((item) => item.subjectRef), ...evidence.images.map((item) => item.subjectRef), ...(storyId ? [storyId] : [])])
  const ids = new Set<string>()
  const findings: ReviewFinding[] = []
  const normalizationNotes: string[] = []
  for (const rawFinding of value.findings) {
    if (!rawFinding || typeof rawFinding !== 'object') throw new Error('REVIEW_OUTPUT_INVALID: finding malformed')
    const item = rawFinding as Record<string, unknown>
    if (!nonempty(item.findingId) || ids.has(item.findingId)) throw new Error('REVIEW_OUTPUT_INVALID: duplicate or empty findingId')
    ids.add(item.findingId)
    if (!categories.has(String(item.category)) || !owners.has(String(item.suggestedOwner)) || !severities.has(String(item.severity)) || !certainties.has(String(item.certainty))) throw new Error('REVIEW_OUTPUT_INVALID: invalid finding enum')
    if (!Array.isArray(item.subjectRefs) || item.subjectRefs.some((ref) => !subjects.has(ref))) throw new Error('REVIEW_OUTPUT_INVALID: unknown subject reference')
    if (item.subjectRefs.length === 0) {
      if (!storyId) throw new Error('REVIEW_OUTPUT_INVALID: subject reference missing')
      item.subjectRefs = [storyId]
      normalizationNotes.push(`${item.findingId}: empty subjectRefs attributed to storyId ${storyId}; B must confirm target before routing`)
    }
    if (!Array.isArray(item.evidenceRefs) || !item.evidenceRefs.length || item.evidenceRefs.some((ref) => !evidenceRefs.has(ref))) throw new Error('REVIEW_OUTPUT_INVALID: unknown evidence reference')
    for (const field of ['observation', 'expected', 'impact', 'acceptanceCheck']) if (!nonempty(item[field])) throw new Error(`REVIEW_OUTPUT_INVALID: ${field} missing`)
    for (const field of ['requestedInformation', 'repairGoal']) if (item[field] === undefined) { item[field] = null; normalizationNotes.push(`${item.findingId}: omitted ${field} normalized to null`) }
    if (!(item.requestedInformation === null || nonempty(item.requestedInformation)) || !(item.repairGoal === null || nonempty(item.repairGoal))) throw new Error('REVIEW_OUTPUT_INVALID: remedy missing')
    findings.push(item as unknown as ReviewFinding)
  }
  for (const entry of value.unassessed) {
    if (nonempty(entry)) continue
    if (!entry || typeof entry !== 'object') throw new Error('REVIEW_OUTPUT_INVALID: invalid unassessed item')
    const item = entry as Record<string, unknown>
    const subjectsValid = Array.isArray(item.subjectRefs) && item.subjectRefs.every((ref) => subjects.has(ref))
    const oldShape = nonempty(item.item) && nonempty(item.reason) && nonempty(item.requiredEvidence) && subjectsValid
    const newShape = nonempty(item.aspect) && nonempty(item.reason) && nonempty(item.neededEvidence) && subjectsValid && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => evidenceRefs.has(ref))
    const singularShape = nonempty(item.subjectRef) && subjects.has(item.subjectRef) && nonempty(item.item) && nonempty(item.reason) && nonempty(item.neededEvidence) && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((ref) => evidenceRefs.has(ref))
    if (!oldShape && !newShape && !singularShape) throw new Error('REVIEW_OUTPUT_INVALID: invalid unassessed item')
  }
  for (const entry of value.suggestedStrategies) {
    if (nonempty(entry)) continue
    if (!entry || typeof entry !== 'object') throw new Error('REVIEW_OUTPUT_INVALID: invalid strategy item')
    const item = entry as Record<string, unknown>
    const oldShape = nonempty(item.strategyId) && nonempty(item.action) && nonempty(item.rationale) && Array.isArray(item.targetFindingIds) && item.targetFindingIds.every((id) => ids.has(id))
    const newShape = nonempty(item.strategy) && nonempty(item.targetRef) && (subjects.has(item.targetRef) || evidenceRefs.has(item.targetRef)) && owners.has(String(item.suggestedOwner)) && nonempty(item.repairGoal) && nonempty(item.acceptanceCheck) && nonempty(item.priority)
    const findingShape = nonempty(item.findingId) && ids.has(item.findingId) && nonempty(item.strategy)
    if (!oldShape && !newShape && !findingShape) throw new Error('REVIEW_OUTPUT_INVALID: invalid strategy item')
  }
  const decision = value.decision as ReviewReport['decision']
  if (decision === 'pass' && (findings.some((item) => item.severity === 'blocking') || value.unassessed.length || evidence.coverage.some((item) => item.status === 'unassessed'))) throw new Error('REVIEW_OUTPUT_INVALID: cannot pass with blockers or missing coverage')
  return { decision, findings, unassessed: value.unassessed as ReviewReport['unassessed'], suggestedStrategies: value.suggestedStrategies as ReviewReport['suggestedStrategies'], normalizationNotes }
}
