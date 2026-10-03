import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repo = fileURLToPath(new URL('..', import.meta.url))
const publicDir = path.join(repo, 'viewer/public/tripo-prompt-lab')
const config = JSON.parse(await readFile(path.join(publicDir, 'experiment.json'), 'utf8'))
const allowed = ['staff-a', 'staff-b', 'gate-a', 'gate-b']
if (config.cases.length !== allowed.length || new Set(config.cases.map(item => item.id)).size !== 4 || config.cases.some(item => !allowed.includes(item.id))) throw new Error('EXPERIMENT_SCOPE_MUST_REMAIN_FOUR_CASES')
for (const asset of ['staff', 'gate']) {
  const pair = config.cases.filter(item => item.asset === asset)
  const controls = pair.map(item => JSON.stringify(Object.fromEntries(Object.entries(item.request).filter(([key]) => key !== 'prompt').sort(([a], [b]) => a.localeCompare(b)))))
  if (pair.length !== 2 || controls[0] !== controls[1]) throw new Error('A_B_CONTROLS_DIFFER')
  if (pair.some(item => item.request.prompt.length > 1024 || item.request.negative_prompt.length > 255)) throw new Error('PROMPT_EXCEEDS_PROVIDER_LIMIT')
}
const stateDir = path.join(repo, '.processing-data', config.experimentId)
const [command = 'plan', id, flag] = process.argv.slice(2)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const requestHash = item => hash(JSON.stringify(item.request))
async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
async function save(file, data, exclusive = false) {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', exclusive ? { flag: 'wx' } : undefined)
}
async function api(method, endpoint, body) {
  const key = process.env.TRIPO_API_KEY?.trim() || (await readFile(path.join(homedir(), '.config/history3d/tripo.key'), 'utf8').catch(() => '')).trim()
  if (!key) throw new Error('TRIPO_CREDENTIALS_MISSING: use TRIPO_API_KEY or ~/.config/history3d/tripo.key')
  const response = await fetch('https://openapi.tripo3d.ai/v3' + endpoint, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  })
  const result = await response.json()
  if (!response.ok || result.code !== 0) throw new Error(`TRIPO_HTTP_${response.status}_CODE_${result.code}`)
  return result.data
}
function glbStats(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('INVALID_GLB')
  const size = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || size > bytes.length - 20) throw new Error('INVALID_GLB_JSON')
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + size).trim())
  let triangles = 0
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if ((primitive.mode ?? 4) !== 4) continue
    const accessor = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]
    triangles += Math.floor((accessor?.count ?? 0) / 3)
  }
  return { triangles, meshes: json.meshes?.length ?? 0, materials: json.materials?.length ?? 0,
    images: json.images?.length ?? 0, normalMappedMaterials: (json.materials ?? []).filter(material => material.normalTexture).length }
}
async function publish() {
  const cases = []
  for (const item of config.cases) {
    const record = await readJson(path.join(stateDir, item.id + '.json'))
    // Signed provider output URLs stay in local state, outside public delivery.
    cases.push({ id: item.id, status: record?.status ?? 'not_submitted', progress: record?.progress ?? null, taskId: record?.taskId ?? null,
      creditsConsumed: record?.creditsConsumed ?? null, requestHash: requestHash(item),
      path: record?.path ?? null, sha256: record?.sha256 ?? null, bytes: record?.bytes ?? null, stats: record?.stats ?? null })
  }
  await save(path.join(publicDir, 'results.json'), { experimentId: config.experimentId, updatedAt: new Date().toISOString(), cases })
}
try {
  if (command === 'plan') {
    console.log(JSON.stringify({ experimentId: config.experimentId, tasks: config.cases.length,
      estimatedCredits: config.cost.estimatedTotalCredits, controls: config.controls,
      cases: config.cases.map(item => ({ id: item.id, requestHash: requestHash(item), promptCharacters: item.request.prompt.length })), commandSubmitsTasks: false }, null, 2))
  } else if (command === 'balance') {
    const balance = await api('GET', '/account/balance')
    await mkdir(stateDir, { recursive: true })
    await save(path.join(stateDir, 'balance.json'), { ...balance, checkedAt: new Date().toISOString() })
    console.log(JSON.stringify(balance))
  } else if (command === 'status') {
    await publish()
    console.log(await readFile(path.join(publicDir, 'results.json'), 'utf8'))
  } else {
    const item = config.cases.find(item => item.id === id)
    if (!item) throw new Error('UNKNOWN_CASE')
    await mkdir(stateDir, { recursive: true })
    const file = path.join(stateDir, id + '.json')
    let record = await readJson(file)
    if (record && record.requestHash !== requestHash(item)) throw new Error('FROZEN_REQUEST_CHANGED')
    if (command === 'submit') {
      if (flag !== '--run') throw new Error('SUBMIT_REQUIRES_EXPLICIT_--run')
      if (record) { console.log(JSON.stringify({ id, status: record.status, taskId: record.taskId })); process.exit(0) }
      const intent = path.join(stateDir, id + '-intent.json')
      if (await readJson(intent)) throw new Error('UNKNOWN_SUBMISSION_DO_NOT_REPEAT')
      // Read-only preflight before writing the irreversible submission marker.
      const balance = await api('GET', '/account/balance')
      const available = balance.balance ?? balance.available_balance
      if (!Number.isFinite(Number(available)) || Number(available) < config.cost.estimatedTotalCredits) throw new Error('BALANCE_UNVERIFIED_OR_BELOW_EXPERIMENT_BUDGET')
      await save(path.join(stateDir, id + '-request.json'), item.request, true)
      await save(intent, { requestHash: requestHash(item), createdAt: new Date().toISOString() }, true)
      const data = await api('POST', '/generation/text-to-model', item.request)
      if (!data.task_id) throw new Error('SUBMISSION_MISSING_TASK_ID_DO_NOT_REPEAT')
      record = { id, requestHash: requestHash(item), taskId: data.task_id, status: 'submitted', submittedAt: new Date().toISOString() }
      await save(file, record)
    } else if (command === 'poll') {
      if (!record?.taskId) throw new Error('VERIFIED_TASK_ID_REQUIRED')
      if (!record.sha256) {
        const data = await api('GET', '/tasks/' + encodeURIComponent(record.taskId))
        if (data.task_id && data.task_id !== record.taskId) throw new Error('TASK_ID_MISMATCH')
        record = { ...record, status: data.status, progress: data.progress, creditsConsumed: data.credits_consumed ?? null, checkedAt: new Date().toISOString() }
        await save(file, record)
        if (data.status === 'success') {
          const url = data.output?.model_url ?? data.output?.pbr_model ?? data.output?.model
          if (!url?.startsWith('https://')) throw new Error('OUTPUT_GLB_URL_MISSING')
          const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
          if (!response.ok) throw new Error('OUTPUT_DOWNLOAD_FAILED_' + response.status)
          const bytes = Buffer.from(await response.arrayBuffer())
          const stats = glbStats(bytes)
          const assetFile = path.join(publicDir, id + '.glb')
          try { await writeFile(assetFile, bytes, { flag: 'wx' }) } catch (error) {
            if (error.code !== 'EEXIST' || hash(await readFile(assetFile)) !== hash(bytes)) throw error
          }
          record = { ...record, status: 'downloaded', path: `/tripo-prompt-lab/${id}.glb`, sha256: hash(bytes), bytes: bytes.length, stats }
          await save(file, record)
        }
      }
    } else throw new Error('COMMAND: plan | balance | status | submit <id> --run | poll <id>')
    await publish()
    console.log(JSON.stringify({ id, status: record.status, progress: record.progress ?? null, taskId: record.taskId, creditsConsumed: record.creditsConsumed ?? null, stats: record.stats ?? null }))
  }
} catch (error) {
  // No raw headers, tokens, response URLs or provider debug bodies in logs.
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[url]'))
  process.exitCode = 1
}
