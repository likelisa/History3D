export type HandoffKind = 'collection' | 'processing-feedback' | 'world-release' | 'world-feedback'
export type ReviewScope = 'input' | 'asset' | 'world' | 'release'
export type IssueOwner = 'collector' | 'processor' | 'viewer'

export interface FileDigest {
  path: string
  sha256: string
  bytes: number
}

export interface HandoffManifest {
  handoffVersion: '1.0.0'
  kind: HandoffKind
  submissionId: string
  storyId: string
  sourceContentRevision: number
  createdAt: string
  producer: string
  files: FileDigest[]
  supersedesSubmissionId?: string
  resolvesIssueIds?: string[]
  resolvesRequestIds?: string[]
}

export interface CollectionAsset {
  assetId: string
  assetRevision: number
  path: string
  sha256: string
  label: string
  briefId: string
  sourceIds: string[]
  claimIds: string[]
  rights: string
  role: string
  intendedUse: string
  knownIssues: string[]
  generation: { provider: string; taskId: string; promptPath: string } | null
  inputUnits: 'm' | null
  upAxis: 'Y' | 'Z' | null
  forwardAxis: string | null
  pivot: string | null
  dimensionsM: [number, number, number] | null
  scaleStatus: 'known' | 'unknown'
}

export interface CollectionPlan {
  requiredBriefIds: string[]
  optionalBriefIds: string[]
  focusBriefId: string | null
  relations: Array<{ id: string; parentBriefId: string; childBriefId: string; kind: 'attachment' | 'spatial'; note: string }>
  beats: Array<{ id: string; description: string; briefIds: string[] }>
  constraints: Array<{ id: string; severity: 'must' | 'should'; statement: string; sourceIds: string[]; illustrative: boolean }>
  unknowns: string[]
}

export interface ProcessingIssue {
  issueId: string
  severity: 'blocking' | 'warning' | 'info'
  owner: IssueOwner
  subjectRef: string
  fieldPath: string
  message: string
  expectedChange: string
  evidenceRefs: string[]
  status: 'open' | 'resolved'
}

export interface InformationRequest {
  requestId: string
  relatedIssueIds: string[]
  targetRef: string
  missingInformation: string
  whyNeeded: string
  acceptableEvidence: string[]
  expectedResponseFields: string[]
  blocks: string[]
  status: 'open' | 'resolved'
}

export interface ReviewEvidenceBundle {
  scope: ReviewScope
  snapshotHash: string
  rubricVersion: string
  images: Array<{ viewId: string; subjectRef: string; path: string; sha256: string; camera: string }>
  metrics: Array<{ subjectRef: string; name: string; value: number | string | null; unit: string | null }>
  texts: Array<{ refId: string; text: string; sha256: string }>
  coverage: Array<{ subjectRef: string; views: string[]; status: 'assessed' | 'unassessed' }>
}

export interface ReviewFinding {
  findingId: string
  category: 'evidence_gap' | 'plan_gap' | 'asset_gap' | 'geometry' | 'material' | 'assembly' | 'narrative' | 'runtime'
  subjectRefs: string[]
  observation: string
  expected: string
  impact: string
  evidenceRefs: string[]
  certainty: 'observed' | 'suspected' | 'insufficient_evidence'
  severity: 'blocking' | 'warning' | 'info'
  suggestedOwner: IssueOwner
  requestedInformation: string | null
  repairGoal: string | null
  acceptanceCheck: string
}

export interface ReviewReport {
  reviewId: string
  scope: ReviewScope
  snapshotHash: string
  rubricVersion: string
  modelRecord: {
    provider: string; requestedModel: string; responseModel: string | null
    requestId: string | null; promptVersion: string; latencyMs: number | null
    tokens: { input: number; output: number } | null
  }
  coverage: ReviewEvidenceBundle['coverage']
  decision: 'pass' | 'needs_revision' | 'needs_information' | 'inconclusive'
  findings: ReviewFinding[]
  unassessed: string[]
  suggestedStrategies: string[]
  normalizationNotes: string[]
}

export interface AssetStrategy {
  id: string
  kind: 'generate' | 'prompt-compare' | 'blender' | 'procedural' | 'recompose'
  available: boolean
  reason: string | null
}

export interface StrategyPolicy {
  maxPaidAttempts: number
  maxCostUsd: number
  allowedStrategyIds: string[]
  requireAssetReview: boolean
  requireWorldReview: boolean
}

export interface ProcessingFeedback {
  feedbackId: string
  importId: string
  submissionId: string
  storyId: string
  sourceContentRevision: number
  status: 'needs_input' | 'needs_review' | 'failed'
  summary: string
  assetResults: Array<{
    assetId: string
    inputRevision: number
    inputHash: string
    result: 'accepted' | 'modified' | 'needs_revision' | 'rejected'
    derivedAssetRef: string | null
    operations: string[]
    beforeMetrics: Record<string, number> | null
    afterMetrics: Record<string, number> | null
  }>
  issues: ProcessingIssue[]
  planChanges: Array<{ changeId: string; originalItemId: string | null; before: string | null; proposed: string; reason: string; requiresCollectorReview: boolean }>
  attachments: Array<{ path: string; kind: 'original' | 'derived-candidate' | 'adopted'; assetId: string | null; parentRevision: number | null }>
  reviewRefs: string[]
  informationRequests: InformationRequest[]
  basedOnSnapshotHash: string
}
