import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Exactly three authorized text-to-model tasks. Never retry an uncertain POST.
// Credentials come exclusively from the root-owned, in-memory environment wrapper.
const repo = fileURLToPath(new URL('..', import.meta.url))
const publicDir = path.join(repo, 'viewer/public/mural-assets/tripo-story-r9')
const stateDir = path.join(repo, '.processing-data/tripo-story-r9')
const planFile = path.join(publicDir, 'plan.json')
const publicBase = '/mural-assets/tripo-story-r9/'
const ids = ['zhangqian', 'ganfu', 'qiong-bamboo']
const estimatedPerTaskCredits = 50
const estimatedTotalCredits = 150
const controls = {
  model: 'v3.1-20260211', texture: true, pbr: true,
  geometry_quality: 'detailed', texture_quality: 'detailed', texture_version: 'v3.0-20250812',
}
const requestKeys = new Set([...Object.keys(controls), 'prompt', 'negative_prompt', 'face_limit', 'model_seed', 'image_seed', 'texture_seed'])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const requestHash = item => sha(canonical(item.request))
const now = () => new Date().toISOString()

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function save(file, value, exclusive = false) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { ...(exclusive ? { flag: 'wx' } : {}), mode: 0o600 })
}
async function event(type, details = {}) {
  await appendFile(path.join(stateDir, 'events.jsonl'), JSON.stringify({ at: now(), type, ...details }) + '\n', { mode: 0o600 })
}
function validatePlan(config) {
  const cases = config.cases ?? config.assets
  if (!Array.isArray(cases) || cases.length !== 3 || new Set(cases.map(item => item.id)).size !== 3 || cases.some(item => !ids.includes(item.id))) throw new Error('STORY_R9_SCOPE_MUST_BE_THREE_APPROVED_IDS')
  if (config.experimentId && config.experimentId !== 'tripo-story-r9') throw new Error('STORY_R9_EXPERIMENT_ID_MISMATCH')
  if (config.cost?.estimatedTotalCredits != null && config.cost.estimatedTotalCredits !== estimatedTotalCredits) throw new Error('STORY_R9_BUDGET_MUST_BE_150_CREDITS')
  if (config.cost?.estimatedPerTaskCredits != null && config.cost.estimatedPerTaskCredits !== estimatedPerTaskCredits) throw new Error('STORY_R9_PER_TASK_BUDGET_MUST_BE_50_CREDITS')
  for (const item of cases) {
    const request = item.request
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('REQUEST_OBJECT_REQUIRED_' + item.id)
    if (Object.keys(request).some(key => !requestKeys.has(key))) throw new Error('UNAPPROVED_REQUEST_FIELD_' + item.id)
    for (const [key, value] of Object.entries(controls)) if (request[key] !== value) throw new Error('STORY_R9_CONTROL_MISMATCH_' + item.id + '_' + key)
    if (request.face_limit !== (item.id === 'qiong-bamboo' ? 30000 : 60000)) throw new Error('STORY_R9_FACE_LIMIT_MISMATCH_' + item.id)
    if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0 || request.prompt.length > 1024) throw new Error('PROMPT_INVALID_OR_OVER_1024_' + item.id)
    if (request.negative_prompt != null && (typeof request.negative_prompt !== 'string' || request.negative_prompt.length > 255)) throw new Error('NEGATIVE_PROMPT_INVALID_OR_OVER_255_' + item.id)
    for (const key of ['model_seed', 'image_seed', 'texture_seed']) if (request[key] != null && (!Number.isSafeInteger(request[key]) || request[key] < 0)) throw new Error('INVALID_SEED_' + item.id)
  }
  return cases
}
async function api(method, endpoint, body) {
  const key = process.env.TRIPO_API_KEY?.trim()
  if (!key) throw new Error('TRIPO_API_KEY_ENV_REQUIRED')
  const response = await fetch('https://openapi.tripo3d.ai/v3' + endpoint, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body == null ? undefined : canonical(body), signal: AbortSignal.timeout(60000),
  })
  let result
  try { result = await response.json() } catch { throw new Error('TRIPO_INVALID_JSON_HTTP_' + response.status) }
  if (!response.ok || result.code !== 0) throw new Error('TRIPO_HTTP_' + response.status + '_CODE_' + String(result.code))
  if (!result.data || typeof result.data !== 'object') throw new Error('TRIPO_DATA_MISSING')
  return result.data
}
function glbStats(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('INVALID_GLB_HEADER_OR_LENGTH')
  const jsonLength = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || jsonLength % 4 !== 0 || jsonLength > bytes.length - 20) throw new Error('INVALID_GLB_JSON_CHUNK')
  let cursor = 12, binaryChunks = 0
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) throw new Error('INVALID_GLB_CHUNK_HEADER')
    const length = bytes.readUInt32LE(cursor), type = bytes.readUInt32LE(cursor + 4)
    if (length % 4 !== 0 || cursor + 8 + length > bytes.length) throw new Error('INVALID_GLB_CHUNK_LENGTH')
    if (type === 0x004e4942) binaryChunks++
    cursor += 8 + length
  }
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim())
  if (doc.asset?.version !== '2.0') throw new Error('INVALID_GLTF_ASSET_VERSION')
  // A raw delivered GLB must be self-contained; recursively reject every URI.
  function rejectUri(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === 'uri' && child) throw new Error('GLB_EXTERNAL_OR_DATA_URI_NOT_ALLOWED')
      rejectUri(child)
    }
  }
  rejectUri(doc)
  const materials = doc.materials ?? [], images = doc.images ?? [], textures = doc.textures ?? []
  if (!doc.meshes?.length || !materials.length || !images.length || !binaryChunks) throw new Error('GLB_GEOMETRY_PBR_OR_EMBEDDED_TEXTURE_MISSING')
  for (const image of images) if (!Number.isInteger(image.bufferView) || !doc.bufferViews?.[image.bufferView] || !/^image\/(png|jpeg|webp|ktx2)$/.test(image.mimeType ?? '')) throw new Error('GLB_IMAGE_NOT_EMBEDDED')
  const pbr = materials.filter(material => material.pbrMetallicRoughness?.baseColorTexture)
  if (!pbr.length) throw new Error('GLB_PBR_BASE_COLOR_TEXTURE_MISSING')
  for (const material of pbr) {
    for (const info of [material.pbrMetallicRoughness.baseColorTexture, material.pbrMetallicRoughness.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture].filter(Boolean)) {
      const texture = textures[info.index]
      const source = texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source
      if (!Number.isInteger(source) || !images[source]) throw new Error('GLB_PBR_TEXTURE_REFERENCE_INVALID')
    }
  }
  let triangles = 0, vertices = 0
  const bounds = []
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives ?? []) {
    const position = doc.accessors?.[primitive.attributes?.POSITION]
    if (!position || !Number.isInteger(position.count) || position.count <= 0) throw new Error('GLB_POSITION_ACCESSOR_INVALID')
    vertices += position.count
    if (position.min && position.max) bounds.push({ min: position.min, max: position.max })
    if ((primitive.mode ?? 4) === 4) {
      const index = doc.accessors?.[primitive.indices]
      triangles += Math.floor((index?.count ?? position.count) / 3)
    }
  }
  return { meshes: doc.meshes.length, nodes: doc.nodes?.length ?? 0, triangles, vertices, materials: materials.length,
    embeddedImages: images.length, externalResources: 0, pbrMaterials: pbr.length,
    normalMappedMaterials: materials.filter(material => material.normalTexture).length,
    metallicRoughnessMappedMaterials: materials.filter(material => material.pbrMetallicRoughness?.metallicRoughnessTexture).length,
    animations: doc.animations?.length ?? 0, bounds }
}
function previewFormat(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'jpg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  throw new Error('PREVIEW_IMAGE_MAGIC_INVALID')
}
async function download(url, timeout = 120000) {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('PROVIDER_HTTPS_OUTPUT_MISSING')
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error('PROVIDER_OUTPUT_DOWNLOAD_HTTP_' + response.status)
  return Buffer.from(await response.arrayBuffer())
}
async function saveAsset(file, bytes) {
  try { await writeFile(file, bytes, { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST' || sha(await readFile(file)) !== sha(bytes)) throw new Error('EXISTING_ASSET_HASH_CONFLICT') }
}
function safeSource(item) {
  const input = item.source ?? item.sources ?? item.sourceReferences
  const clean = value => {
    if (typeof value === 'string') {
      if (/https?:\/\//i.test(value)) {
        try { const url = new URL(value); return url.protocol === 'https:' && !url.search && !url.username && !url.password ? url.href : null } catch { return null }
      }
      return /(?:secret|token|authorization|api.?key|signature)/i.test(value) ? null : value
    }
    if (Array.isArray(value)) return value.map(clean).filter(value => value !== null)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => ['title', 'institution', 'url', 'type', 'reference', 'localImage', 'localReference', 'identification', 'limitations', 'note', 'evidence'].includes(key))
      .map(([key, value]) => [key, clean(value)]).filter(([, value]) => value !== null))
    return null
  }
  return { provider: 'Tripo', generationType: 'text-to-model', model: controls.model, references: clean(input) }
}
async function readRecord(item) {
  const digest = requestHash(item)
  const [record, intent, frozen, receipt] = await Promise.all([
    readJson(path.join(stateDir, item.id + '.json')),
    readJson(path.join(stateDir, item.id + '-intent.json')),
    readJson(path.join(stateDir, item.id + '-request.json')),
    readJson(path.join(stateDir, item.id + '-receipt.json')),
  ])
  if ([record, intent, receipt].some(value => value && value.requestHash !== digest) || (frozen && sha(canonical(frozen)) !== digest)) throw new Error('FROZEN_REQUEST_CHANGED_' + item.id)
  if (record?.taskId && receipt?.taskId && record.taskId !== receipt.taskId) throw new Error('PERSISTED_TASK_ID_CONFLICT_' + item.id)
  if (record && (!intent || !frozen || !receipt)) throw new Error('SUBMISSION_EVIDENCE_INCOMPLETE_' + item.id)
  return { record: record ?? (receipt ? { ...receipt, status: 'submitted' } : null), intent, frozen }
}
async function publicResult(item) {
  const { record, intent } = await readRecord(item)
  return { id: item.id, source: safeSource(item), status: record?.status ?? (intent ? 'submission_unknown_do_not_repeat' : 'not_submitted'),
    taskId: record?.taskId ?? null, creditsConsumed: record?.creditsConsumed ?? null,
    requestHash: requestHash(item), path: record?.path ?? null, sha256: record?.sha256 ?? null,
    bytes: record?.bytes ?? null, stats: record?.stats ?? null,
    preview: record?.preview ?? null, previewStatus: record?.previewStatus ?? null,
    progress: record?.progress ?? null, submittedAt: record?.submittedAt ?? null, checkedAt: record?.checkedAt ?? null }
}
async function publish(cases) {
  const assets = await Promise.all(cases.map(publicResult))
  const common = { experimentId: 'tripo-story-r9', updatedAt: now(), endpoint: '/v3/generation/text-to-model', estimatedTotalCredits }
  await save(path.join(publicDir, 'manifest.json'), { ...common, assets })
  await save(path.join(publicDir, 'results.json'), { ...common, cases: assets })
}
async function verifyRecord(item, record) {
  if (record?.sha256) {
    const bytes = await readFile(path.join(publicDir, item.id + '-raw.glb'))
    if (sha(bytes) !== record.sha256 || bytes.length !== record.bytes) throw new Error('SAVED_GLB_HASH_MISMATCH_' + item.id)
    glbStats(bytes)
  }
  if (record?.preview) {
    const filename = record.preview.path?.slice(publicBase.length)
    if (!record.preview.path?.startsWith(publicBase) || filename?.includes('/') || filename?.includes('\\')) throw new Error('PREVIEW_PATH_INVALID')
    const bytes = await readFile(path.join(publicDir, filename))
    if (sha(bytes) !== record.preview.sha256 || bytes.length !== record.preview.bytes) throw new Error('SAVED_PREVIEW_HASH_MISMATCH_' + item.id)
    previewFormat(bytes)
  }
}

try {
  const config = await readJson(planFile)
  if (!config) throw new Error('STORY_R9_PLAN_MISSING')
  const cases = validatePlan(config)
  const [command = 'plan', id, flag, ...extra] = process.argv.slice(2)
  if (extra.length) throw new Error('UNEXPECTED_ARGUMENTS')
  if (command === 'plan') {
    if (id || flag) throw new Error('PLAN_TAKES_NO_ARGUMENTS')
    console.log(JSON.stringify({ experimentId: 'tripo-story-r9', tasks: 3, estimatedPerTaskCredits, estimatedTotalCredits, controls,
      cases: cases.map(item => ({ id: item.id, requestHash: requestHash(item), promptCharacters: item.request.prompt.length, faceLimit: item.request.face_limit })),
      commandSubmitsTasks: false, commandWritesFiles: false }, null, 2))
  } else if (command === 'balance') {
    if (id || flag) throw new Error('BALANCE_TAKES_NO_ARGUMENTS')
    const balance = await api('GET', '/account/balance')
    const available = Number(balance.balance ?? balance.available_balance)
    if (!Number.isFinite(available)) throw new Error('BALANCE_UNVERIFIED')
    await mkdir(stateDir, { recursive: true })
    const result = { availableCredits: available, checkedAt: now() }
    await save(path.join(stateDir, 'balance.json'), result)
    console.log(JSON.stringify(result))
  } else if (command === 'status' || command === 'verify') {
    if (id || flag) throw new Error('STATUS_OR_VERIFY_TAKES_NO_ARGUMENTS')
    if (command === 'verify') for (const item of cases) await verifyRecord(item, (await readRecord(item)).record)
    console.log(JSON.stringify({ experimentId: 'tripo-story-r9', cases: await Promise.all(cases.map(publicResult)), commandSubmitsTasks: false }, null, 2))
  } else {
    const item = cases.find(item => item.id === id)
    if (!item) throw new Error('UNKNOWN_STORY_R9_ID')
    if (!['submit', 'poll'].includes(command)) throw new Error('COMMAND: plan | balance | status | verify | submit <id> --run | poll <id>')
    if (command === 'submit' && flag !== '--run') throw new Error('SUBMIT_REQUIRES_EXPLICIT_--run')
    if (command === 'poll' && flag) throw new Error('POLL_TAKES_NO_FLAG')
    await mkdir(stateDir, { recursive: true })
    const file = path.join(stateDir, id + '.json')
    const previous = await readRecord(item)
    let record = previous.record
    if (command === 'submit') {
      if (record?.taskId) { await verifyRecord(item, record); console.log(JSON.stringify(await publicResult(item))); process.exit(0) }
      if (previous.intent || previous.frozen) throw new Error('UNKNOWN_SUBMISSION_DO_NOT_REPEAT_' + id)
      const balance = await api('GET', '/account/balance')
      const available = Number(balance.balance ?? balance.available_balance)
      if (!Number.isFinite(available) || available < estimatedTotalCredits) throw new Error('BALANCE_UNVERIFIED_OR_BELOW_150_CREDIT_BUDGET')
      await event('balance_preflight', { id, availableCredits: available })
      await save(path.join(stateDir, id + '-request.json'), item.request, true)
      await save(path.join(stateDir, id + '-intent.json'), { id, requestHash: requestHash(item), createdAt: now(), policy: 'Exactly one POST; uncertain outcome must never be retried.' }, true)
      await event('submission_intent', { id, requestHash: requestHash(item) })
      let data
      try { data = await api('POST', '/generation/text-to-model', item.request) }
      catch { await event('submission_unknown', { id, requestHash: requestHash(item) }); throw new Error('SUBMISSION_UNKNOWN_DO_NOT_REPEAT_' + id) }
      if (typeof data.task_id !== 'string' || !data.task_id) throw new Error('SUBMISSION_MISSING_TASK_ID_DO_NOT_REPEAT_' + id)
      const receipt = { id, taskId: data.task_id, requestHash: requestHash(item), submittedAt: now() }
      await save(path.join(stateDir, id + '-receipt.json'), receipt, true)
      record = { ...receipt, status: 'submitted' }
      await save(file, record, true)
      await event('submitted', { id, taskId: record.taskId, requestHash: record.requestHash })
    } else {
      if (!record?.taskId) throw new Error('VERIFIED_PERSISTED_TASK_ID_REQUIRED_' + id)
      await verifyRecord(item, record)
      if (!record.sha256 || (!record.preview && record.previewStatus !== 'unavailable')) {
        const data = await api('GET', '/tasks/' + encodeURIComponent(record.taskId))
        if (data.task_id && data.task_id !== record.taskId) throw new Error('TASK_ID_MISMATCH')
        record = { ...record, status: data.status, progress: data.progress ?? null,
          creditsConsumed: data.credits_consumed ?? record.creditsConsumed ?? null, checkedAt: now() }
        await save(file, record)
        await event('polled', { id, taskId: record.taskId, status: record.status, progress: record.progress, creditsConsumed: record.creditsConsumed })
        if (data.status === 'success') {
          if (!record.sha256) {
            const url = data.output?.model_url ?? data.output?.pbr_model ?? data.output?.model
            const bytes = await download(url)
            const stats = glbStats(bytes)
            await saveAsset(path.join(publicDir, id + '-raw.glb'), bytes)
            record = { ...record, path: publicBase + id + '-raw.glb', sha256: sha(bytes), bytes: bytes.length, stats }
            await save(file, record)
          }
          if (!record.preview) {
            const previewUrl = data.output?.rendered_image_url ?? data.output?.preview_image_url
            if (previewUrl) {
              const bytes = await download(previewUrl, 60000)
              const extension = previewFormat(bytes)
              const filename = id + '-preview.' + extension
              await saveAsset(path.join(publicDir, filename), bytes)
              record.preview = { path: publicBase + filename, sha256: sha(bytes), bytes: bytes.length, format: extension }
              record.previewStatus = 'downloaded'
            } else record.previewStatus = 'unavailable'
          }
          record.status = 'downloaded'
          await save(file, record)
          await event('downloaded', { id, taskId: record.taskId, sha256: record.sha256, bytes: record.bytes, previewSha256: record.preview?.sha256 ?? null })
        }
      }
    }
    await publish(cases)
    console.log(JSON.stringify(await publicResult(item), null, 2))
  }
} catch (error) {
  // Do not expose credentials, signed output URLs, raw response bodies or headers.
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[url]'))
  process.exitCode = 1
}