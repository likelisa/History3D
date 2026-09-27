import { createHash, randomUUID } from 'node:crypto'

import type { StoryFile } from '../../contracts/src/types.ts'
import type { FeedbackContext, FeedbackInput, FeedbackRecord } from './types.ts'

function canonicalText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function validContext(context: FeedbackContext, story: StoryFile): boolean {
  if (context.storyId && context.storyId !== story.storyId) return false
  if (context.claimId && !story.claims.some((claim) => claim.id === context.claimId)) return false
  if (context.subjectId && context.subjectId !== story.storyId && !story.objectBriefs.some((brief) => brief.id === context.subjectId)) return false
  if (context.hotspotId && !story.hotspots.some((hotspot) => hotspot.id === context.hotspotId)) return false
  return true
}

function locate(text: string, story: StoryFile, given: FeedbackContext): { context: FeedbackContext; question: string | null } {
  const context = { ...given, storyId: given.storyId ?? story.storyId }
  if (!validContext(context, story)) {
    // Drop stale object/claim IDs so a natural-language answer can actually recover.
    // Keep version pointers for the audit trail, but do not trust a mismatched story ID.
    return {
      context: { storyId: story.storyId, contentRevision: given.contentRevision, sceneRevision: given.sceneRevision },
      question: '返还信息中的故事或对象 ID 与当前资料不匹配。请用名称描述具体物件或故事点；若是旧版本，请说明看到的问题。',
    }
  }
  if (context.claimId || context.subjectId || context.hotspotId) return { context, question: null }

  const normalized = canonicalText(text)
  const matches = story.objectBriefs.filter((brief) =>
    normalized.includes(canonicalText(brief.label)) || normalized.includes(canonicalText(brief.id)),
  )
  const hotspotMatches = story.hotspots.filter((hotspot) =>
    normalized.includes(canonicalText(hotspot.title)) || normalized.includes(canonicalText(hotspot.id)),
  )
  if (matches.length === 1 && hotspotMatches.length === 0) return { context: { ...context, subjectId: matches[0].id }, question: null }
  if (hotspotMatches.length === 1 && matches.length === 0) return { context: { ...context, hotspotId: hotspotMatches[0].id }, question: null }
  if (matches.length + hotspotMatches.length > 1) {
    return { context, question: '我找到了多个可能的位置。你指的是哪一个物件或故事点？' }
  }
  if (normalized.includes(canonicalText(story.title)) || normalized.includes(canonicalText(story.storyId))) {
    return { context: { ...context, subjectId: story.storyId }, question: null }
  }
  return { context, question: '你说的是哪个故事、画面或物件？请用平常话描述位置；有截图也可以指出位置。' }
}

function fingerprint(text: string, context: FeedbackContext): string {
  return createHash('sha256')
    .update(JSON.stringify({ text: canonicalText(text), storyId: context.storyId, subjectId: context.subjectId, claimId: context.claimId, hotspotId: context.hotspotId, contentRevision: context.contentRevision }))
    .digest('hex')
}

export function receiveFeedback(input: FeedbackInput, story: StoryFile, prior: readonly FeedbackRecord[] = []): FeedbackRecord {
  const originalText = input.text.trim()
  if (!originalText) throw new Error('反馈内容不能为空')
  const located = locate(originalText, story, input.context ?? {})
  const key = fingerprint(originalText, located.context)
  const duplicate = prior.find((item) => !['rejected', 'queue_failed'].includes(item.status) && item.fingerprint === key)
  return {
    id: randomUUID(),
    origin: input.origin,
    originalText,
    clarification: [],
    receivedAt: new Date().toISOString(),
    context: located.context,
    evidenceUrls: input.evidenceUrls ?? [],
    status: duplicate ? 'duplicate' : located.question ? 'needs_clarification' : 'ready',
    question: duplicate ? null : located.question,
    duplicateOf: duplicate ? (duplicate.duplicateOf ?? duplicate.id) : null,
    fingerprint: key,
  }
}

export function clarifyFeedback(record: FeedbackRecord, answer: string, story: StoryFile): FeedbackRecord {
  if (record.status !== 'needs_clarification' || !record.question) throw new Error('该反馈当前不需要澄清')
  if (!answer.trim()) throw new Error('请描述你指的位置或对象')
  const located = locate(answer, story, record.context)
  const clarification = [...record.clarification, { question: record.question, answer: answer.trim() }]
  return {
    ...record,
    clarification,
    context: located.context,
    status: located.question ? 'needs_clarification' : 'ready',
    question: located.question,
    fingerprint: fingerprint(record.originalText, located.context),
  }
}
