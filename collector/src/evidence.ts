import { createHash } from 'node:crypto'

import type { Claim, SourceEntry } from '../../contracts/src/types.ts'
import type { EvidenceCandidate, SearchHit } from './types.ts'

export interface ExtractedAssertion {
  subjectId: string
  property: Claim['property']
  statement: string
  value: Claim['value']
  unit: Claim['unit']
  evidenceType: 'documented' | 'inferred'
  originalLocation: string
  supportExcerpt: string
  opposingExcerpts?: string[]
  isDirectQuote: boolean
  extractionNote: string
}

function shortId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

export function extractCandidate(hit: SearchHit, assertion: ExtractedAssertion, allowedSubjects: readonly string[]): EvidenceCandidate {
  if (!allowedSubjects.includes(assertion.subjectId)) throw new Error('断言主体未在故事中登记')
  if (!assertion.statement.trim() || !assertion.supportExcerpt.trim() || !assertion.originalLocation.trim()) {
    throw new Error('断言必须带原文位置、摘录和明确陈述')
  }
  if (!hit.url.startsWith('https://') && !hit.url.startsWith('http://')) throw new Error('来源 URL 无效')
  if (assertion.value === null) throw new Error('已知断言必须带值；证据不足时应保留 unknown')
  if (assertion.property === 'dimensions' && assertion.unit !== 'm') throw new Error('尺寸单位必须为 m')
  if (assertion.property === 'count' && assertion.unit !== 'count') throw new Error('数量单位必须为 count')
  if (!['dimensions', 'count'].includes(assertion.property) && assertion.unit !== null) throw new Error('该属性不允许单位')
  const sourceId = `src-${shortId(hit.doi || hit.url)}`
  const claimId = `claim-${shortId(`${sourceId}|${assertion.subjectId}|${assertion.property}|${assertion.statement}`)}`
  const source: SourceEntry = {
    id: sourceId,
    title: hit.title,
    type: hit.sourceType,
    locator: { url: hit.url, localPath: null },
    citation: [hit.author, hit.title, hit.publishedAt].filter(Boolean).join('，') || hit.title,
    location: assertion.originalLocation,
    excerpt: assertion.isDirectQuote ? assertion.supportExcerpt : `归纳：${assertion.supportExcerpt}`,
    rights: hit.rights?.trim() || '待核对来源及素材使用权利',
    accessedAt: hit.retrievedAt.slice(0, 10),
  }
  const claim: Claim = {
    id: claimId,
    subjectId: assertion.subjectId,
    property: assertion.property,
    statement: assertion.statement,
    value: assertion.value,
    unit: assertion.unit,
    valueStatus: 'known',
    evidenceType: assertion.evidenceType,
    sourceIds: [sourceId],
    note: assertion.extractionNote || (assertion.isDirectQuote ? '直接摘录，需复核上下文' : '归纳陈述，需复核原文'),
  }
  return {
    id: `ev-${shortId(claimId)}`,
    claim,
    source,
    originalLocation: assertion.originalLocation,
    supportExcerpt: assertion.supportExcerpt,
    opposingExcerpts: assertion.opposingExcerpts ?? [],
    derivedFrom: [hit.provider, hit.queryId, hit.url],
    extractionNote: assertion.extractionNote,
  }
}
