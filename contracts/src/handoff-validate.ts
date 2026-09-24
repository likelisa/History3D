import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { CollectionAsset, CollectionPlan, HandoffManifest } from './handoff-types.ts'
import type { PackageReader } from './validate.ts'
import { validateCollection } from './validate.ts'
import { readGlbBounds } from './glb.ts'
import { sizeTolerance } from './geometry.ts'
import handoffSchema from '../schemas/handoff/handoff.schema.json'
import planSchema from '../schemas/handoff/collection-plan.schema.json'
import assetsSchema from '../schemas/handoff/asset-manifest.schema.json'

export interface HandoffProblem { path: string; message: string }
export const REQUIRED_COLLECTION_FILES = ['story.json', 'sources.json', 'plan.md', 'plan.json', 'assets/asset-manifest.json'] as const
const safePath = (value: string): boolean => Boolean(value) && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some((part) => part === '..' || part === '' || part === '.')
const hexHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value)
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const schemas = { 'handoff.json': ajv.compile(handoffSchema), 'plan.json': ajv.compile(planSchema), 'assets/asset-manifest.json': ajv.compile(assetsSchema) }

export async function validateCollectionHandoff(reader: PackageReader): Promise<HandoffProblem[]> {
  const problems: HandoffProblem[] = []
  async function json<T>(path: keyof typeof schemas): Promise<T | null> {
    const value = await reader.readText(path)
    if (value === null) { problems.push({ path, message: 'required file missing' }); return null }
    try {
      const parsed: unknown = JSON.parse(value)
      if (!schemas[path](parsed)) { for (const error of schemas[path].errors ?? []) problems.push({ path, message: `${error.instancePath || '/'} ${error.message}` }); return null }
      return parsed as T
    } catch { problems.push({ path, message: 'invalid JSON' }); return null }
  }
  const handoff = await json<HandoffManifest>('handoff.json')
  const assets = await json<{ assets: CollectionAsset[] }>('assets/asset-manifest.json')
  const plan = await json<CollectionPlan>('plan.json')
  if (await reader.readText('plan.md') === null) problems.push({ path: 'plan.md', message: 'original plan missing' })
  const collection = await validateCollection(reader)
  const collectionErrors = collection.diagnostics.filter((item) => item.severity === 'error')
  problems.push(...collectionErrors.map((item) => ({ path: item.file, message: item.message })))
  if (!handoff || !assets || !plan) return problems
  if (handoff.handoffVersion !== '1.0.0' || handoff.kind !== 'collection' || !handoff.submissionId || !handoff.producer || !Number.isInteger(handoff.sourceContentRevision)) problems.push({ path: 'handoff.json', message: 'invalid handoff identity' })
  if (collection.story && collection.sources && (handoff.storyId !== collection.story.storyId || handoff.storyId !== collection.sources.storyId || handoff.sourceContentRevision !== collection.story.contentRevision)) problems.push({ path: 'handoff.json', message: 'story or revision mismatch' })
  if (!Array.isArray(handoff.files) || !Array.isArray(assets.assets)) return [...problems, { path: 'handoff.json', message: 'file or asset list missing' }]
  const listed = new Set<string>()
  for (const file of handoff.files) {
    if (!safePath(file.path) || listed.has(file.path) || !hexHash(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) { problems.push({ path: 'handoff.json', message: `invalid file entry: ${file.path}` }); continue }
    listed.add(file.path)
    const binary = await reader.readBinary(file.path)
    if (!binary) { problems.push({ path: file.path, message: 'listed file missing' }); continue }
    const bytes = Buffer.from(binary)
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) problems.push({ path: file.path, message: 'file digest mismatch' })
  }
  for (const required of REQUIRED_COLLECTION_FILES) if (!listed.has(required)) problems.push({ path: required, message: 'required file not listed' })
  if (collectionErrors.length || !collection.story || !collection.sources) return problems
  const briefs = new Set(collection.story?.objectBriefs.map((item) => item.id))
  const sources = new Set(collection.sources?.sources.map((item) => item.id))
  const claims = new Set(collection.story?.claims.map((item) => item.id))
  const assetIds = new Set<string>()
  for (const asset of assets.assets) {
    if (assetIds.has(asset.assetId)) problems.push({ path: asset.path, message: 'duplicate assetId' })
    assetIds.add(asset.assetId)
    if (!safePath(asset.path) || !asset.path.endsWith('.glb') || !listed.has(asset.path) || handoff.files.find((item) => item.path === asset.path)?.sha256 !== asset.sha256) problems.push({ path: asset.path, message: 'asset path or digest mismatch' })
    if (!briefs.has(asset.briefId) || asset.sourceIds.some((id) => !sources.has(id)) || asset.claimIds.some((id) => !claims.has(id))) problems.push({ path: asset.path, message: 'unknown brief, source, or claim' })
    if (asset.scaleStatus === 'unknown' && asset.dimensionsM !== null) problems.push({ path: asset.path, message: 'unknown scale must have null dimensions' })
    if (asset.scaleStatus === 'known' && (!asset.dimensionsM || asset.dimensionsM.some((value) => !Number.isFinite(value) || value <= 0))) problems.push({ path: asset.path, message: 'known scale needs positive dimensions' })
    if (asset.scaleStatus === 'known' && (asset.inputUnits !== 'm' || asset.upAxis !== 'Y')) problems.push({ path: asset.path, message: 'known GLB must be normalized to meter units and Y-up' })
    const binary = safePath(asset.path) ? await reader.readBinary(asset.path) : null
    const bounds = binary ? readGlbBounds(binary) : null
    if (binary && !bounds) problems.push({ path: asset.path, message: 'invalid GLB geometry' })
    if (bounds && asset.scaleStatus === 'known' && asset.dimensionsM && bounds.dimensions.some((measured, axis) => Math.abs(measured - asset.dimensionsM![axis]) > sizeTolerance(asset.dimensionsM![axis]))) problems.push({ path: asset.path, message: 'known dimensions do not match GLB bounds' })
    if (bounds && asset.pivot === 'bottom-center' && asset.dimensionsM) {
      const tolerance = asset.dimensionsM.map((dimension) => Math.max(0.01, Math.min(0.05, sizeTolerance(dimension))))
      if (Math.abs(bounds.min[1]) > tolerance[1] || Math.abs(bounds.min[0] + bounds.max[0]) > 2 * tolerance[0] || Math.abs(bounds.min[2] + bounds.max[2]) > 2 * tolerance[2]) problems.push({ path: asset.path, message: 'declared bottom-center pivot disagrees with GLB bounds' })
    }
  }
  for (const requiredBriefId of plan.requiredBriefIds) if (!assets.assets.some((asset) => asset.briefId === requiredBriefId)) problems.push({ path: 'plan.json', message: `required asset missing: ${requiredBriefId}` })
  for (const id of plan.requiredBriefIds) if (!briefs.has(id)) problems.push({ path: 'plan.json', message: `unknown required brief: ${id}` })
  for (const id of plan.optionalBriefIds) if (!briefs.has(id)) problems.push({ path: 'plan.json', message: `unknown optional brief: ${id}` })
  if (plan.focusBriefId !== null && !briefs.has(plan.focusBriefId)) problems.push({ path: 'plan.json', message: `unknown focus brief: ${plan.focusBriefId}` })
  for (const beat of plan.beats) for (const id of beat.briefIds) if (!briefs.has(id)) problems.push({ path: 'plan.json', message: `unknown beat brief: ${beat.id}/${id}` })
  for (const relation of plan.relations) if (!briefs.has(relation.parentBriefId) || !briefs.has(relation.childBriefId)) problems.push({ path: 'plan.json', message: `unknown relation brief: ${relation.id}` })
  return problems
}
