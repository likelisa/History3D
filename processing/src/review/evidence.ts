import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlbBounds } from '../../../contracts/src/glb.ts'
import type { ReviewEvidenceBundle, ReviewScope } from '../../../contracts/src/handoff-types.ts'

const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
export const REQUIRED_ASSET_VIEWS = ['front', 'back', 'left', 'right', 'top', 'three-quarter'] as const

export async function buildAssetEvidence(args: {
  scope: 'input' | 'asset'; assetId: string; assetRevision: number; glbPath: string
  imageDir: string; planPath: string; storyPath: string; sourcesPath: string
  snapshotHash: string; rubricVersion: string
}): Promise<ReviewEvidenceBundle> {
  const glb = await readFile(args.glbPath)
  const bytes = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer
  const bounds = readGlbBounds(bytes)
  if (!bounds) throw new Error('ASSET_INVALID: cannot read GLB geometry')
  const subjectRef = `${args.assetId}@${args.assetRevision}:${hash(glb)}`
  const images: ReviewEvidenceBundle['images'] = []
  for (const viewId of REQUIRED_ASSET_VIEWS) {
    const file = path.join(args.imageDir, `${viewId}.png`)
    const content = await readFile(file)
    if (content.length < 100 || content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`REVIEW_EVIDENCE_INVALID: ${viewId} PNG missing or invalid`)
    images.push({ viewId, subjectRef, path: file, sha256: hash(content), camera: `blender-neutral-ortho-${viewId}-v1` })
  }
  const texts = await Promise.all([
    ['plan.md', args.planPath], ['story.json', args.storyPath], ['sources.json', args.sourcesPath],
  ].map(async ([refId, file]) => { const text = await readFile(file, 'utf8'); return { refId, text, sha256: hash(text) } }))
  const metrics: ReviewEvidenceBundle['metrics'] = [
    { subjectRef, name: 'boundsMin', value: JSON.stringify(bounds.min), unit: 'm' },
    { subjectRef, name: 'boundsMax', value: JSON.stringify(bounds.max), unit: 'm' },
    { subjectRef, name: 'dimensionsM', value: JSON.stringify(bounds.dimensions), unit: 'm' },
    { subjectRef, name: 'positionSamples', value: bounds.nodeCount, unit: 'count' },
    { subjectRef, name: 'glbBytes', value: glb.length, unit: 'bytes' },
  ]
  return { scope: args.scope, snapshotHash: args.snapshotHash, rubricVersion: args.rubricVersion, images, metrics, texts, coverage: [{ subjectRef, views: [...REQUIRED_ASSET_VIEWS], status: 'assessed' }] }
}

export async function buildWorldEvidence(args: {
  scope: Extract<ReviewScope, 'world' | 'release'>; snapshotHash: string; rubricVersion: string
  images: Array<{ viewId: string; subjectRef: string; path: string; camera: string }>
  texts: Array<{ refId: string; text: string }>
  metrics: ReviewEvidenceBundle['metrics']; requiredViewIds: string[]; subjectRef: string
}): Promise<ReviewEvidenceBundle> {
  const images = await Promise.all(args.images.map(async (item) => ({ ...item, sha256: hash(await readFile(item.path)) })))
  const available = new Set(images.map((item) => item.viewId))
  const missing = args.requiredViewIds.filter((id) => !available.has(id))
  return {
    scope: args.scope, snapshotHash: args.snapshotHash, rubricVersion: args.rubricVersion,
    images, metrics: args.metrics, texts: args.texts.map((item) => ({ ...item, sha256: hash(item.text) })),
    coverage: [{ subjectRef: args.subjectRef, views: [...available], status: missing.length ? 'unassessed' : 'assessed' }],
  }
}
