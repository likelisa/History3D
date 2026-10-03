import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// One authorized image-to-model trial. Any uncertain create result is terminal.
const root = fileURLToPath(new URL('..', import.meta.url))
const publicDir = path.join(root, 'viewer/public/mural-assets/zhangqian-mural-trial')
const evidenceDir = path.join(root, 'output/zhangqian-mural-trial-2026-10-03')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const base = { model: 'v3.1-20260211', texture: true, pbr: true, texture_version: 'v3.0-20250812', texture_quality: 'standard', geometry_quality: 'standard', face_limit: 40000, enable_image_autofix: false, texture_alignment: 'original_image', orientation: 'align_image', model_seed: 20261003, texture_seed: 20261003 }
const source = { title: '莫高窟第323窟《张骞出使西域图》', institution: '敦煌研究院', url: 'https://www.dha.ac.cn/info/1266/2524.htm', localImage: 'viewer/public/yuezhi/murals/full.jpg', dimensions: [1080, 895], crop: { x: 255, y: 716, width: 62, height: 147 }, inputDimensions: [310, 735], operation: 'Exact rectangular crop and 5x resample; no AI enhancement or repainting', identification: 'Lower-left kneeling envoy identified as Zhang Qian in the project mural-source reading', observed: 'Kneeling, facing right; muted purple-brown flowing robe with pale contour lines; dark indigo collar and lower hem; reddish dark headwear; arms forward in a court salutation', limitations: ['The original figure is small, damaged and partly overlaps an adjacent standing figure.', 'Upsampling adds no source detail.', 'Depth, back view and hidden anatomy are generated interpretation.', 'This depicts an Early Tang mural form and is not an archaeological reconstruction of Han dress.'] }
async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function save(file, object, exclusive = false) { await writeFile(file, JSON.stringify(object, null, 2) + '\n', exclusive ? { flag: 'wx', mode: 0o600 } : undefined) }
async function api(method, endpoint, body, multipart = false) {
  const key = (await readFile(path.join(homedir(), '.config/history3d/tripo.key'), 'utf8')).trim()
  if (!key) throw new Error('TRIPO_KEY_MISSING')
  const headers = { Authorization: 'Bearer ' + key }
  if (!multipart) headers['Content-Type'] = 'application/json'
  const response = await fetch('https://openapi.tripo3d.ai/v3' + endpoint, { method, headers, body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
  const value = await response.json()
  if (!response.ok || value.code !== 0) throw new Error('TRIPO_HTTP_' + response.status + '_CODE_' + value.code)
  return value.data
}
function stats(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('INVALID_GLB')
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)).trim())
  let triangles = 0, vertices = 0
  const bounds = []
  for (const mesh of doc.meshes ?? []) for (const p of mesh.primitives ?? []) {
    const a = doc.accessors[p.attributes.POSITION]; vertices += a.count
    if (a.min && a.max) bounds.push({ min: a.min, max: a.max })
    if ((p.mode ?? 4) === 4) triangles += Math.floor(doc.accessors[p.indices ?? p.attributes.POSITION].count / 3)
  }
  return { meshes: doc.meshes?.length ?? 0, nodes: doc.nodes?.length ?? 0, triangles, vertices, materials: doc.materials?.length ?? 0, embeddedImages: (doc.images ?? []).filter(i => Number.isInteger(i.bufferView)).length, externalImages: (doc.images ?? []).filter(i => i.uri).length, normalMappedMaterials: (doc.materials ?? []).filter(m => m.normalTexture).length, animations: doc.animations?.length ?? 0, bounds }
}
async function publish(record) {
  await save(path.join(publicDir, 'provenance.json'), { ...record, source, endpoint: '/v3/generation/image-to-model', generationType: 'image-to-model', modelSettings: base, checkedAt: new Date().toISOString(), review: 'Raw trial asset; scene integration is a separate decision.' })
}
await mkdir(evidenceDir, { recursive: true })
const recordFile = path.join(evidenceDir, 'record.json')
const intentFile = path.join(evidenceDir, 'submission-intent.json')
const [command = 'status', flag] = process.argv.slice(2)
try {
  let record = await readJson(recordFile)
  if (command === 'submit') {
    if (flag !== '--run') throw new Error('SUBMIT_REQUIRES_--run')
    if (record) { console.log(JSON.stringify(record)); process.exit(0) }
    if (await readJson(intentFile)) throw new Error('CALL_UNKNOWN_DO_NOT_REPEAT_CREATE')
    const balance = await api('GET', '/account/balance')
    const available = Number(balance.balance ?? balance.available_balance)
    if (!Number.isFinite(available) || available < 30) throw new Error('BALANCE_BELOW_STANDARD_TRIAL_BUDGET')
    await save(path.join(evidenceDir, 'balance-before.json'), { ...balance, checkedAt: new Date().toISOString() })
    const input = await readFile(path.join(publicDir, 'reference-input.png'))
    const form = new FormData(); form.append('file', new Blob([input], { type: 'image/png' }), 'zhangqian-mural-reference.png')
    const upload = await api('POST', '/files', form, true)
    if (!upload.file_token) throw new Error('UPLOAD_MISSING_FILE_TOKEN')
    const request = { input: upload.file_token, ...base }
    const requestHash = sha(JSON.stringify(request))
    await save(path.join(evidenceDir, 'request.json'), { ...base, input: 'Uploaded reference-input.png; token intentionally omitted', inputSha256: sha(input), requestHash }, true)
    await save(intentFile, { requestHash, startedAt: new Date().toISOString(), policy: 'Exactly one create; unknown outcome must not be retried' }, true)
    const data = await api('POST', '/generation/image-to-model', request)
    if (!data.task_id) throw new Error('CALL_UNKNOWN_MISSING_TASK_ID_DO_NOT_REPEAT')
    record = { taskId: data.task_id, status: 'submitted', submittedAt: new Date().toISOString(), requestHash, inputSha256: sha(input), sourceSha256: sha(await readFile(path.join(root, source.localImage))), nativeReferenceSha256: sha(await readFile(path.join(publicDir, 'reference-native.png'))) }
    await save(recordFile, record)
  } else if (command === 'poll') {
    if (!record?.taskId) throw new Error('VERIFIED_TASK_ID_REQUIRED')
    if (!record.sha256) {
      const data = await api('GET', '/tasks/' + encodeURIComponent(record.taskId))
      if (data.task_id && data.task_id !== record.taskId) throw new Error('TASK_ID_MISMATCH')
      record = { ...record, status: data.status, progress: data.progress, creditsConsumed: data.credits_consumed ?? null, checkedAt: new Date().toISOString() }
      await save(recordFile, record)
      if (data.status === 'success') {
        const url = data.output?.model_url ?? data.output?.pbr_model ?? data.output?.model
        if (!url?.startsWith('https://')) throw new Error('MODEL_URL_MISSING')
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
        if (!response.ok) throw new Error('GLB_DOWNLOAD_FAILED_' + response.status)
        const bytes = Buffer.from(await response.arrayBuffer())
        const geometry = stats(bytes)
        const file = path.join(publicDir, 'zhangqian-raw.glb')
        try { await writeFile(file, bytes, { flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST' || sha(await readFile(file)) !== sha(bytes)) throw e }
        record = { ...record, status: 'downloaded', path: '/mural-assets/zhangqian-mural-trial/zhangqian-raw.glb', bytes: bytes.length, sha256: sha(bytes), stats: geometry }
        await save(recordFile, record)
        const previewUrl = data.output?.rendered_image_url
        if (previewUrl?.startsWith('https://')) {
          const preview = await fetch(previewUrl, { signal: AbortSignal.timeout(60000) })
          if (preview.ok) {
            const b = Buffer.from(await preview.arrayBuffer())
            await writeFile(path.join(publicDir, 'provider-preview.png'), b)
            record.preview = { path: '/mural-assets/zhangqian-mural-trial/provider-preview.png', sha256: sha(b), bytes: b.length }
          }
        }
        await save(recordFile, record)
        const balanceAfter = await api('GET', '/account/balance')
        await save(path.join(evidenceDir, 'balance-after.json'), { ...balanceAfter, checkedAt: new Date().toISOString() })
      }
    }
  } else if (command !== 'status') throw new Error('EXPECTED_submit_--run_OR_poll_OR_status')
  if (record) await publish(record)
  console.log(JSON.stringify(record ?? { status: 'not_submitted' }, null, 2))
} catch (error) {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[url]'))
  process.exitCode = 1
}
