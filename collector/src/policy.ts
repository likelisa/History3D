import type { EvidenceCandidate, NarrowDecision, ScreeningDecision } from './types.ts'

export const RUBRIC_DIMENSIONS = [
  'sourceAuthority', 'topicRelevance', 'originalTraceability', 'periodPlaceFit',
  'sourceIndependence', 'contradictionHandling', 'rights',
] as const

export type RubricDimension = typeof RUBRIC_DIMENSIONS[number]

export interface RubricPolicy {
  version: string
  status: 'draft' | 'approved'
  approvedBy: string | null
  approvedAt: string | null
  calibrationRecord: string | null
}

export interface DimensionAssessment {
  dimension: RubricDimension
  level: 0 | 1 | 2 | 3
  reason: string
  evidenceRefs: string[]
}

export interface HumanReview {
  reviewer: string
  decision: 'retain' | 'reject' | 'needs_human'
  assessments: DimensionAssessment[]
  reasons: string[]
  reviewedAt: string
}

/** 描述性等级仅供逐维讨论；不将等级相加成历史真实性概率。 */
export const LEVELS = {
  0: '未核对或无法核对',
  1: '有线索但位置、适用性或独立性不足',
  2: '有可复核支持，仍有边界或冲突需说明',
  3: '可复核且适用于本断言，反证和权利边界已处理',
} as const

/** Dimension-specific anchors: a sum or average must never stand in for these gates. */
export const RUBRIC_ANCHORS: Record<RubricDimension, readonly [string, string, string, string]> = {
  sourceAuthority: [
    '来源身份不明', '可识别来源但作者或发布责任不清', '作者与发布责任可核实，适合此问题', '一手文献或专业机构资料，版本与责任链可核实',
  ],
  topicRelevance: [
    '未对应断言', '仅谈相近主题', '直接谈该断言或其限定范围', '直接谈该断言且上下文边界明确',
  ],
  originalTraceability: [
    '无可定位原文', '只有转述或搜索摘要', '原文位置、版本和摘录可独立核对', '原文、版本与引用链可重复核对',
  ],
  periodPlaceFit: [
    '时空不明或明显不符', '相近但跨时期或跨地区推断未说明', '时空直接适用或差异已限定', '时空和对象均吻合且适用边界明确',
  ],
  sourceIndependence: [
    '来源链不明', '多个网页实际共用同一出处', '独立出处可核实，或独有一手来源的范围被明确限定', '多条独立证据链互相印证且镜像已排除',
  ],
  contradictionHandling: [
    '未检查冲突', '发现冲突却未定位原文', '已查反向线索；有冲突则逐条注明并复核', '有代表性反证已比较并说明取舍和残余不确定性',
  ],
  rights: [
    '权利状态未知', '只知道来源可访问，未核对复用范围', '引用或素材使用范围明确，符合本次用途', '许可、署名和再发布边界均可核实',
  ],
}

export function policyIsApproved(policy: RubricPolicy): boolean {
  return policy.status === 'approved' && Boolean(
    policy.approvedBy?.trim() && policy.approvedAt?.trim() &&
    Number.isFinite(Date.parse(policy.approvedAt)) && policy.calibrationRecord?.trim(),
  )
}

export function screenEvidence(
  candidate: EvidenceCandidate,
  policy: RubricPolicy,
  review: HumanReview | null,
  jev: NarrowDecision | readonly NarrowDecision[] | null,
): ScreeningDecision {
  const reasons: string[] = []
  const decisions = jev === null ? [] : Array.isArray(jev) ? jev : [jev]
  if (!candidate.originalLocation.trim() || !candidate.supportExcerpt.trim()) reasons.push('缺少可复核原文位置或摘录')
  if (!candidate.source.locator.url && !candidate.source.locator.localPath) reasons.push('缺少来源定位')
  if (candidate.claim.sourceIds.length === 0 || !candidate.claim.sourceIds.includes(candidate.source.id)) reasons.push('断言没有绑定本来源')
  const expectedQuestions = candidate.opposingExcerpts.map((_, index) => `narrow-${candidate.id}${index ? `-${index + 1}` : ''}`)
  for (const id of expectedQuestions) {
    const matching = decisions.filter((item) => item.questionId === id)
    if (matching.length !== 1) reasons.push(`${id} 缺少唯一对应的窄判断`)
    if (matching[0]?.verdict === 'unclear') reasons.push(`${id} Jev 判断不明确`)
    if (matching[0]?.verdict === 'b') reasons.push(`${id} Jev 指向反证，不得自动保留断言`)
  }
  if (decisions.some((item) => !expectedQuestions.includes(item.questionId))) reasons.push('Jev 判断与当前断言不匹配')
  if (/待核|待确认|unknown/i.test(candidate.source.rights)) reasons.push('来源或素材使用权利待确认')
  if (reasons.some((reason) => reason.startsWith('缺少'))) {
    return { candidateId: candidate.id, result: 'reject', reasons, rubricVersion: policy.version, reviewer: review?.reviewer ?? null }
  }
  if (!policyIsApproved(policy)) {
    reasons.push('评分政策及校准记录尚未批准')
  }
  if (!review || !review.reviewer.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) reasons.push('缺少有效的史料负责人逐维评审记录')
  else {
    if (review.assessments.length !== RUBRIC_DIMENSIONS.length) reasons.push('逐维评估数量与政策不一致')
    for (const dimension of RUBRIC_DIMENSIONS) {
      const matching = review.assessments.filter((item) => item.dimension === dimension)
      const assessment = matching[0]
      if (matching.length !== 1 || !assessment || !assessment.reason.trim() ||
          assessment.evidenceRefs.length === 0 || assessment.evidenceRefs.some((ref) => !ref.trim()) ||
          !Number.isInteger(assessment.level) || assessment.level < 0 || assessment.level > 3) {
        reasons.push(`${dimension} 缺少带证据的评估`)
      } else if (assessment.level < 2) {
        reasons.push(`${dimension} 等级 ${assessment.level} 未达到保留门槛 2`)
      }
    }
  }
  if (candidate.opposingExcerpts.length > 0 && review?.decision === 'retain' && review.reasons.length === 0) {
    reasons.push('保留有争议断言须说明反证处理')
  }
  if (review?.decision === 'reject') {
    return { candidateId: candidate.id, result: 'reject', reasons: [...reasons, ...review.reasons], rubricVersion: policy.version, reviewer: review.reviewer }
  }
  if (reasons.length > 0) return { candidateId: candidate.id, result: 'needs_human', reasons, rubricVersion: policy.version, reviewer: review?.reviewer ?? null }
  return { candidateId: candidate.id, result: review!.decision, reasons: review!.reasons, rubricVersion: policy.version, reviewer: review!.reviewer }
}
