import type { Claim, SourceEntry, StoryFile, SourcesFile } from '../../contracts/src/types.ts'

export type FeedbackOrigin = 'user' | 'generator' | 'viewer'
export type FeedbackStatus = 'needs_clarification' | 'ready' | 'queue_failed' | 'duplicate' | 'rejected'

export interface FeedbackContext {
  storyId?: string
  contentRevision?: number
  sceneRevision?: number
  subjectId?: string
  claimId?: string
  hotspotId?: string
}

export interface FeedbackInput {
  origin: FeedbackOrigin
  text: string
  context?: FeedbackContext
  evidenceUrls?: string[]
}

export interface FeedbackRecord {
  id: string
  origin: FeedbackOrigin
  originalText: string
  clarification: Array<{ question: string; answer: string }>
  receivedAt: string
  context: FeedbackContext
  evidenceUrls: string[]
  status: FeedbackStatus
  question: string | null
  duplicateOf: string | null
  fingerprint: string
}

export type Stage = 'P' | 'S' | 'D' | 'E' | 'J' | 'R' | 'O'

export interface StageEvent {
  stage: Stage
  at: string
  inputRevision: number
  status: 'closed' | 'needs_human' | 'blocked'
  evidence: string[]
  note: string
}

export interface RevisionRecord {
  id: string
  feedbackId: string
  storyId: string
  baseRevision: number
  status: 'queued' | 'running' | 'needs_human' | 'blocked' | 'candidate' | 'published'
  stages: StageEvent[]
  unresolved: string[]
  candidatePath: string | null
  publishedPath: string | null
}

export interface SearchQuery {
  id: string
  text: string
  language: string
  purpose: 'support' | 'context' | 'challenge'
  sourceTypes: string[]
  /** Exact destinations for this query; empty until a researcher approves a redacted plan. */
  providerIds: string[]
}

export interface SearchPlan {
  storyId: string
  baseRevision: number
  question: string
  period: string | null
  place: string | null
  queries: SearchQuery[]
  controversySignal: string | null
  omittedCoverage: string[]
  stopReason: string
}

export interface SearchHit {
  provider: string
  queryId: string
  title: string
  url: string
  snippet: string
  sourceType: SourceEntry['type']
  author: string | null
  publishedAt: string | null
  doi: string | null
  rights: string | null
  retrievedAt: string
}

export interface SearchTrace {
  queryId: string
  provider: string
  at: string
  status: 'ok' | 'empty' | 'error'
  hitCount: number
  error: string | null
}

export interface SourceCluster {
  key: string
  primary: SearchHit
  mirrors: SearchHit[]
  reason: string
}

export interface EvidenceCandidate {
  id: string
  claim: Claim
  source: SourceEntry
  originalLocation: string
  supportExcerpt: string
  opposingExcerpts: string[]
  derivedFrom: string[]
  extractionNote: string
}

export interface NarrowQuestion {
  id: string
  claimId: string
  question: string
  evidenceA: string
  evidenceB: string
}

export interface NarrowDecision {
  questionId: string
  verdict: 'a' | 'b' | 'unclear'
  model: string
  rationale: string
  rawResponseRef: string
  confidence?: number
  probabilities?: { a: number; b: number; unclear: number }
}

export interface ScreeningDecision {
  candidateId: string
  result: 'retain' | 'reject' | 'needs_human'
  reasons: string[]
  rubricVersion: string
  reviewer: string | null
}

export interface CollectionCandidate {
  story: StoryFile
  sources: SourcesFile
  references: Array<{ path: string; bytes: Uint8Array }>
  changes: string[]
  unresolved: string[]
}
