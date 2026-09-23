import type { Diagnostic } from './diagnostics.ts'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export type ClaimProperty =
  | 'dimensions'
  | 'appearance'
  | 'layout'
  | 'count'
  | 'narrative'
  | 'route'

export type EvidenceType = 'documented' | 'inferred' | 'illustrative' | null
export type ClaimValue = string | number | number[] | null

export const EVIDENCE_LABELS: Record<string, string> = {
  documented: '史料记载',
  inferred: '推测复原',
  illustrative: '演示设定',
}

export interface Claim {
  id: string
  subjectId: string
  property: ClaimProperty
  statement: string
  value: ClaimValue
  unit: 'm' | 'count' | null
  valueStatus: 'known' | 'unknown'
  evidenceType: EvidenceType
  sourceIds: string[]
  note: string
}

export interface ObjectBrief {
  id: string
  label: string
  purpose: string
  claimIds: string[]
  referenceSourceIds: string[]
}

export interface Hotspot {
  id: string
  title: string
  body: string
  claimIds: string[]
}

export interface StoryFile {
  schemaVersion: string
  storyId: string
  contentRevision: number
  title: string
  status: 'draft' | 'reviewed'
  historicalScope: {
    period: string | null
    place: string | null
    scopeNote: string
  }
  experienceQuestion: string
  claims: Claim[]
  objectBriefs: ObjectBrief[]
  hotspots: Hotspot[]
  routeOverview: { kind: 'schematic'; imagePath: string }
}

export interface SourceEntry {
  id: string
  title: string
  type: 'book' | 'paper' | 'museum' | 'map' | 'image' | 'website' | 'other'
  locator: { url: string | null; localPath: string | null }
  citation: string
  location: string
  excerpt: string
  rights: string
  accessedAt: string
}

export interface SourcesFile {
  schemaVersion: string
  storyId: string
  contentRevision: number
  sources: SourceEntry[]
}

export interface SceneAsset {
  id: string
  path: string
  dimensionsM: Vec3
  format: 'glb'
  rights: string
}

export type SceneRender =
  | { type: 'primitive'; shape: 'box'; color: string }
  | { type: 'asset'; assetId: string }

export interface SceneObject {
  id: string
  briefId: string
  label: string
  render: SceneRender
  position: Vec3
  rotation: Vec3
  scale: Vec3
  dimensionsM: Vec3
  evidence: {
    dimensions: string[]
    appearance: string[]
    placement: string[]
    quantity: string[]
  }
}

export type HotspotAnchor =
  | { type: 'object'; objectId: string; offset: Vec3 }
  | { type: 'world'; position: Vec3 }

export interface HotspotBinding {
  hotspotId: string
  anchor: HotspotAnchor
}

export interface Blocker {
  id: string
  min: Vec2
  max: Vec2
}

export interface SceneFile {
  schemaVersion: string
  storyId: string
  contentRevision: number
  sceneRevision: number
  storyPath: string
  sourcesPath: string
  units: 'm'
  upAxis: 'Y'
  handedness: 'right'
  ground: { type: 'plane'; y: number }
  assets: SceneAsset[]
  objects: SceneObject[]
  hotspotBindings: HotspotBinding[]
  cameras: {
    firstPerson: {
      spawnFeet: Vec3
      eyeHeightM: number
      yawRad: number
      pitchRad: number
      moveSpeedMps: number
      radiusM: number
    }
    overview: { position: Vec3; target: Vec3; up: Vec3 }
  }
  walkableBounds: { min: Vec2; max: Vec2 }
  blockers: Blocker[]
}

export interface LoadedPackage {
  scene: SceneFile
  story: StoryFile
  sources: SourcesFile
  diagnostics: Diagnostic[]
}
