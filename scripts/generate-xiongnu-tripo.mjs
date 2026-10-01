import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// A single bounded task. An unknown submission is never automatically resubmitted.
const root = path.resolve('.processing-data/xiongnu-tripo')
const api = 'https://openapi.tripo3d.ai/v3'
const key = process.env.TRIPO_API_KEY
if (!key) throw new Error('TRIPO_API_KEY is required')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const request = {
  prompt: 'One anonymous adult Xiongnu steppe horseman, historically informed illustrative reconstruction for 2nd-century BCE. Neutral natural face, calm expression, simple close-fitting soft cap. Knee-length narrow-sleeved overlapping robe tied closed at right side, muted reddish-brown wool fabric, loose dark trousers, low plain felt boots with flat soles. Narrow leather belt with a small rectangular bronze plaque. Full body standing in relaxed low A-pose, hands separated from torso, feet visible and level. Real wool weave, leather wear, garment seams and folds. Anatomically proportioned museum diorama figure. No horse, weapon, armor, royal crown, background, pedestal or text. No modern Mongolian standing collar or decorative button rows, Qing shaved hairstyle, long braid, upturned boots or exaggerated face. Garment cut and colors are interpretive, not a portrait.',
  model: 'v3.1-20260211', texture: true, pbr: true,
  face_limit: 50000, geometry_quality: 'standard', texture_quality: 'detailed',
}
const requestDigest = digest(JSON.stringify(request))
const recordPath = path.join(root, 'generation.json')
async function load(file) { try { return JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function save(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n') }
async function call(method, suffix, body) {
  const response = await fetch(api + suffix, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  const result = await response.json()
  if (!response.ok || result.code !== 0) throw new Error(`TRIPO_REQUEST_FAILED status=${response.status} code=${result.code}`)
  return result.data
}
await mkdir(root, { recursive: true })
const command = process.argv[2] ?? 'status'
try {
  let record = await load(recordPath)
  if (command === 'balance') {
    const balance = await call('GET', '/account/balance')
    await save(path.join(root, 'balance-before.json'), { ...balance, checkedAt: new Date().toISOString() })
    console.log(JSON.stringify(balance))
  } else if (command === 'create') {
    if (record) {
      if (record.requestDigest !== requestDigest) throw new Error('EXISTING_REQUEST_MISMATCH')
      console.log(JSON.stringify(record))
    } else {
      if (await load(path.join(root, 'submission-intent.json'))) throw new Error('SUBMISSION_OUTCOME_UNKNOWN_DO_NOT_RESUBMIT')
      const balance = await call('GET', '/account/balance')
      if (Number(balance.balance) < 30) throw new Error('INSUFFICIENT_30_CREDITS')
      await save(path.join(root, 'balance-before.json'), { ...balance, checkedAt: new Date().toISOString() })
      await save(path.join(root, 'request.json'), request)
      await writeFile(path.join(root, 'submission-intent.json'), JSON.stringify({ requestDigest, createdAt: new Date().toISOString(), expectedCredits: 30 }), { flag: 'wx' })
      const result = await call('POST', '/generation/text-to-model', request)
      if (!result.task_id) throw new Error('SUBMISSION_MISSING_TASK_ID')
      record = { assetId: 'asset-xiongnu', taskId: result.task_id, requestDigest, status: 'submitted', createdAt: new Date().toISOString(), expectedCredits: 30 }
      await save(recordPath, record)
      console.log(JSON.stringify(record))
    }
  } else if (command === 'poll') {
    if (!record?.taskId || record.requestDigest !== requestDigest) throw new Error('VERIFIED_TASK_REQUIRED')
    const result = await call('GET', '/tasks/' + encodeURIComponent(record.taskId))
    if (result.task_id !== record.taskId) throw new Error('TASK_ID_MISMATCH')
    record = { ...record, status: result.status, progress: result.progress, creditsConsumed: result.credits_consumed, checkedAt: new Date().toISOString() }
    if (result.status === 'success' && !record.rawSha256) {
      const url = result.output?.model_url ?? result.output?.pbr_model ?? result.output?.model
      if (!url || !url.startsWith('https://')) throw new Error('MODEL_URL_MISSING')
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error('MODEL_NOT_VALID_GLB')
      await writeFile(path.join(root, 'xiongnu-raw.glb'), bytes, { flag: 'wx' })
      record = { ...record, rawSha256: digest(bytes), rawBytes: bytes.length, rawPath: 'xiongnu-raw.glb' }
    }
    // Signed download URLs and account secrets are deliberately absent from the public evidence.
    await save(recordPath, record)
    console.log(JSON.stringify(record))
  } else if (command === 'status') console.log(JSON.stringify(record))
  else throw new Error('Usage: generate-xiongnu-tripo.mjs balance|create|poll|status')
} catch (error) {
  console.error(String(error?.message ?? error).split(key).join('[redacted]').replace(/https?:\/\/[^\s]+/g, '[URL redacted]'))
  process.exitCode = 1
}
