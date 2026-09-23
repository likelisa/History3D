export {
  SUPPORTED_SCHEMA_VERSION,
  errorDiagnostic,
  hasBlockingError,
  sortDiagnostics,
  warningDiagnostic,
} from './diagnostics.ts'
export type { Diagnostic, DiagnosticCode, Severity } from './diagnostics.ts'

export {
  cameraEyePosition,
  distance3,
  expandBlocker,
  formatMeters,
  grayBoxCenterOffset,
  isBlocked,
  isInsideRect,
  isInsideWalkable,
  normalizeDirection,
  resolveMove,
  shrinkBounds,
  sizeTolerance,
  viewDirection,
} from './geometry.ts'
export type { MoveResult, RectBounds } from './geometry.ts'

export { readGlbBounds } from './glb.ts'
export type { GlbBounds } from './glb.ts'

export {
  SCENE_FILE,
  SOURCES_FILE,
  STORY_FILE,
  validateCollection,
  validateScenePackage,
} from './validate.ts'
export type {
  CollectionResult,
  PackageOptions,
  PackageReader,
  PackageResult,
} from './validate.ts'

export { EVIDENCE_LABELS } from './types.ts'
export type {
  Blocker,
  Claim,
  ClaimProperty,
  ClaimValue,
  EvidenceType,
  Hotspot,
  HotspotAnchor,
  HotspotBinding,
  LoadedPackage,
  ObjectBrief,
  SceneAsset,
  SceneFile,
  SceneObject,
  SceneRender,
  SourceEntry,
  SourcesFile,
  StoryFile,
  Vec2,
  Vec3,
} from './types.ts'
