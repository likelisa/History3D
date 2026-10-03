import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createMuralAgentServer, inspectGlb } from '../agent/server'
import { ContractError, validatePlan, validateRunInput } from '../agent/contracts'
import type { Plan } from '../agent/contracts'
import type { NarrationManifest, NarrationRunner } from '../agent/narration'
import { PUBLIC_REFERENCE_SHA, PUBLIC_SOURCE_COMMIT } from '../agent/narration'

const credentials = { model: { baseUrl: 'https://model.example.invalid/v1', model: 'fixture-vision', apiKey: 'fixture-model-key-987654' }, tripo: { apiKey: 'fixture-tripo-key-123456' } }
const source = { id: 'source-one', title: '提供的片段', url: '', excerpt: '使者携带竹杖出使。' }
const input = { ...credentials, topic: '解释使者的目的与行动', imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9RcAAAAASUVORK5CYII=', sources: [source], budget: { maxAssets: 1, maxCredits: 50 } }
const plan: Plan = {
  title: '使者故事', summary: '使者的行动与目的。',
  chapters: [{ id: 'chapter-one', title: '出使', cues: [{ id: 'cue-one', text: '使者携带竹杖出使。', kind: 'documented', sourceIds: ['source-one'], evidence: [{ sourceId: 'source-one', quote: '携带竹杖' }], sceneId: 'scene-one', imageRelation: 'context-only' }] }],
  assets: [{ id: 'prop-one', label: '竹杖', kind: 'prop', heightM: 1.4, prompt: 'Self-contained upright textured PBR bamboo walking staff, front +Z.', sourceIds: ['source-one'] }],
  scenes: [{ id: 'scene-one', title: '出使', visualSeconds: 6, placements: [{ assetId: 'prop-one', position: [0, 0, 0], heading: 0 }], camera: [3, 2, 6] }],
}
const artifactPlan: Plan = { ...structuredClone(plan), subjectType: 'artifact', primaryAssetId: 'prop-one' }
artifactPlan.assets[0].generationMode = 'image-to-model'
artifactPlan.chapters[0].cues[0].focus = 'identity'
artifactPlan.chapters[0].cues[0].imageRelation = 'depicted'
artifactPlan.chapters[0].cues[0].imageAnchor = { x: .5, y: .5, label: '竹杖细节' }
const artifactInput = { ...input, subjectType: 'artifact', subjectMetadata: { name: '竹杖', material: '用户提供：竹', dimensions: '尚无实测尺寸' }, budget: { maxAssets: 1, maxCredits: 60 } }
const fixturePromise = readFile(new URL('../viewer/public/mural-assets/tripo-story-r9/qiong-bamboo.glb', import.meta.url))
const apps: Awaited<ReturnType<typeof createMuralAgentServer>>[] = []
type FixtureOptions = { plan?: Plan; modelContent?: string; submitUnknown?: boolean; submitHttpFailure?: boolean; pollFail?: boolean; balance?: number; glb?: Buffer; uploadFailure?: 'transport' | 'http' | 'invalid-token' | 'invalid-json' }
function upstream(options: FixtureOptions = {}) {
  const calls: { url: string; method: string; body?: unknown; headers?: HeadersInit }[] = []
  const fetchImpl: typeof fetch = async (request, init) => {
    const url = String(request), method = init?.method ?? 'GET'; calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body, headers: init?.headers })
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/chat/completions')) return json({ choices: [{ finish_reason: 'stop', message: { content: options.modelContent ?? JSON.stringify(options.plan ?? plan) } }] })
    if (url.endsWith('/account/balance')) return json({ code: 0, data: { balance: options.balance ?? 500 } })
    if (url.endsWith('/files')) {
      if (options.uploadFailure === 'transport') throw new Error('private upload response ' + credentials.tripo.apiKey)
      if (options.uploadFailure === 'http') return new Response('private upload response ' + credentials.tripo.apiKey, { status: 503 })
      if (options.uploadFailure === 'invalid-json') return new Response('not json')
      return json({ code: 0, data: { file_token: options.uploadFailure === 'invalid-token' ? 'https://private.invalid/token' : 'file_fixture-private-upload-token' } })
    }
    if (/\/generation\/(?:text|image)-to-model$/.test(url)) { if (options.submitUnknown) throw new Error('Do not leak ' + credentials.tripo.apiKey); if (options.submitHttpFailure) return new Response('upstream private response ' + credentials.tripo.apiKey, { status: 500 }); return json({ code: 0, data: { task_id: 'fixture-task-one' } }) }
    if (url.includes('/tasks/')) { if (options.pollFail) throw new Error('private upstream text ' + credentials.tripo.apiKey); return json({ code: 0, data: { status: 'success', credits_consumed: 50, output: { model_url: 'https://asset.example.invalid/asset.glb?signature=fixture-signed-token' } } }) }
    if (url.startsWith('https://asset.example.invalid/')) { expect(init?.headers).toBeUndefined(); return new Response(options.glb ?? await fixturePromise) }
    throw new Error('Unexpected fixture route')
  }
  return { fetchImpl, calls, submits: () => calls.filter(call => /\/generation\/(?:text|image)-to-model$/.test(call.url)).length, textSubmits: () => calls.filter(call => call.url.endsWith('/generation/text-to-model')).length, uploads: () => calls.filter(call => call.url.endsWith('/files')).length }
}
async function start(fetchImpl: typeof fetch, existingDir?: string, narrationRunner?: NarrationRunner, policyPath?: string) {
  const directory = existingDir ?? await mkdtemp(path.join(tmpdir(), 'mural-agent-offline-'))
  const webDir = path.join(directory, 'web'); await mkdir(webDir, { recursive: true })
  for (const [name, content] of Object.entries({ 'index.html': '<!doctype html><title>Fixture</title>', 'app.js': '', 'style.css': '', 'viewer.html': '<!doctype html><script type="module" src="./viewer.js"></script>', 'viewer.js': 'export const fixture = true', 'viewer.css': '', 'genericviewer.importmap': '{}' })) await writeFile(path.join(webDir, name), content)
  const app = await createMuralAgentServer({ dataDir: path.join(directory, 'data'), webDir, fetchImpl, narrationRunner, policyPath, pollIntervalMs: 1, maxPolls: 3, requestTimeoutMs: 1000 }); await app.listen(0); apps.push(app)
  // Windows may assign an ephemeral port forbidden by Fetch (for example 6667).
  // Rebind the unused listener rather than changing Fetch's network protection.
  const blockedPorts = new Set([2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080])
  let address = app.server.address()
  for (let attempt = 0; address && typeof address !== 'string' && blockedPorts.has(address.port) && attempt < 10; attempt++) {
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()))
    await app.listen(0); address = app.server.address()
  }
  if (!address || typeof address === 'string' || blockedPorts.has(address.port)) throw new Error('No local fixture listener')
  const base = `http://127.0.0.1:${address.port}`
  const post = (pathname: string, value: unknown, origin = base) => fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value) })
  const get = async (pathname: string) => (await fetch(base + pathname)).json()
  return { app, directory, base, post, get }
}
type Local = Awaited<ReturnType<typeof start>>
async function waitStatus(local: Local, id: string, statuses: string[]) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) { const run = await local.get(`/api/runs/${id}`); if (statuses.includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('Fixture status timed out')
}
async function idleRun(local: Local, id: string) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) { const run = await local.get(`/api/runs/${id}`); if (!run.active) return run; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('Fixture run did not become idle')
}
async function candidateRequest(local: Local, run: any, extra: Record<string, unknown> = {}) {
  const value = { planSha256: run.planSha256, assetId: 'prop-one', prompt: 'More carefully separated self-contained bamboo with detailed PBR.', reason: '第一版细节不足，比较新候选。', operationId: randomUUID(), ...extra }
  const response = await local.post(`/api/runs/${run.id}/asset-candidates`, value)
  expect(response.status).toBe(202)
  return { value, response: await response.json() }
}
async function planned(local: Local, value: unknown = input) {
  const response = await local.post('/api/runs', value); expect(response.status).toBe(202)
  const run = await response.json(); return waitStatus(local, run.id, ['story_review', 'failed', 'unknown'])
}
async function generated(local: Local, value: unknown = input) {
  const run = await planned(local, value); expect(run.status).toBe('story_review')
  const response = await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 }); expect(response.status).toBe(202)
  return waitStatus(local, run.id, ['preview_ready', 'failed', 'recoverable', 'unknown'])
}
async function diskText(folder: string): Promise<string> {
  let result = ''
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name)
    if (item.isDirectory()) result += await diskText(file)
    else if (/\.(?:json|jsonl|js|html|css|importmap)$/.test(file)) {
      try { result += await readFile(file, 'utf8') }
      catch (error) {
        // save() atomically renames this temporary file to state.json between enumeration and reading.
        // Keep reading the durable snapshot and all other files; unrelated errors must still fail the leak audit.
        if (item.name !== 'state.next.json' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return result
}
function mutateGlb(bytes: Buffer, mutate: (document: any) => void) {
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString('utf8', 20, 20 + length).trim()); mutate(doc)
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const rest = bytes.subarray(20 + length), result = Buffer.alloc(20 + json.length + rest.length)
  bytes.copy(result, 0, 0, 20); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(json.length, 12); json.copy(result, 20); rest.copy(result, 20 + json.length); return result
}
function fixtureWave(seconds = 2) {
  const rate = 32000, samples = rate * seconds, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let sample = 0; sample < samples; sample++) bytes.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 220 * sample / rate)), 44 + sample * 2)
  return bytes
}
const fixtureNarration: NarrationRunner = async ({ runDir, plan }) => {
  await mkdir(path.join(runDir, 'narration'), { recursive: true })
  const tracks: NarrationManifest['tracks'] = []
  for (const cue of plan.chapters.flatMap(chapter => chapter.cues)) {
    const bytes = fixtureWave(), file = `narration/${cue.id}.wav`, digest = createHash('sha256').update(bytes).digest('hex')
    await writeFile(path.join(runDir, file), bytes)
    tracks.push({ id: cue.id, text: cue.text, file, sha256: digest, bytes: bytes.length, seconds: 2, subtitleAudioSha256: digest, subtitlePoints: [{ seconds: 2, textEnd: Array.from(cue.text).length }] })
  }
  const manifest: NarrationManifest = { formatVersion: '1.0.0', voiceId: 'history3d-public-uncle-fu-r13', referenceSha256: PUBLIC_REFERENCE_SHA, sourceCommit: PUBLIC_SOURCE_COMMIT, complete: true, humanAudioReviewed: false, tracks }
  await writeFile(path.join(runDir, 'narration/manifest.json'), JSON.stringify(manifest))
  return manifest
}
afterEach(async () => { for (const app of apps.splice(0)) await app.close() })

describe('mural agent strict contracts and delivered GLB', () => {
  it('accepts quality iteration budgets beyond 400 while enforcing finite safe integer stop boundaries and broad camera framing', () => {
    expect(validateRunInput({ ...input, budget: { maxAssets: 1, maxCredits: 50000 } }).budget.maxCredits).toBe(50000)
    for (const maxCredits of [49, Infinity, Number.MAX_SAFE_INTEGER + 1, 500.5]) expect(() => validateRunInput({ ...input, budget: { maxAssets: 1, maxCredits } })).toThrow()
    const observed = structuredClone(artifactPlan); observed.scenes[0].cameraFraming = { region: 'lower', magnification: 1.8 }
    expect(validatePlan(observed, [{ ...source, status: 'provided' }], 'artifact').scenes[0].cameraFraming).toEqual({ region: 'lower', magnification: 1.8 })
    for (const cameraFraming of [{ region: 'engraving', magnification: 1.5 }, { region: 'upper', magnification: 2.6 }, { region: 'lower', magnification: .9 }, { region: 'whole', magnification: 1, point: [0, 1, 0] }]) {
      const rejected: any = structuredClone(observed); rejected.scenes[0].cameraFraming = cameraFraming
      expect(() => validatePlan(rejected, [{ ...source, status: 'provided' }], 'artifact')).toThrow()
    }
  })
  it('requires provided excerpts and rejects fabricated evidence and unknown scene references', () => {
    expect(() => validateRunInput({ ...input, sources: [{ ...source, excerpt: '' }] })).toThrow('PLAIN_TEXT_REQUIRED')
    const fabricated = structuredClone(plan); fabricated.chapters[0].cues[0].evidence[0].quote = '未提供的史实'
    expect(() => validatePlan(fabricated, [{ ...source, status: 'provided' }])).toThrow('EVIDENCE_QUOTE_NOT_IN_PROVIDED_EXCERPT')
    const invalid = structuredClone(plan); invalid.chapters[0].cues[0].sceneId = 'absent-scene'
    expect(() => validatePlan(invalid, [{ ...source, status: 'provided' }])).toThrow('SCENE_REFERENCE_UNKNOWN')
  })
  it('checks the real fixture, rejects missing UV/PBR, external URI and out-of-range accessors', async () => {
    const real = await fixturePromise; expect(inspectGlb(real).uvMappedPrimitives).toBeGreaterThan(0)
    for (const mutation of [
      (doc: any) => { delete doc.meshes[0].primitives[0].attributes.TEXCOORD_0 },
      (doc: any) => { delete doc.materials[doc.meshes[0].primitives[0].material].normalTexture },
      (doc: any) => { doc.images[0].uri = 'https://private.invalid/texture.png' },
      (doc: any) => { doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION].count = 1000000000 },
    ]) expect(() => inspectGlb(mutateGlb(real, mutation))).toThrow('INVALID_GLB')
  })
})

describe('mural agent offline HTTP state machine', () => {
  it('automatically delivers checked plans with detailed real-asset requests and stops invalid evidence before Tripo', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl, undefined, fixtureNarration)
    const response = await local.post('/api/runs', { ...artifactInput, autoGenerate: true }); expect(response.status).toBe(202)
    const created = await response.json(), run = await waitStatus(local, created.id, ['preview_ready'])
    expect(run.autoGenerate).toBe(true); expect(run.credentialsReady).toBe(true); expect(vendor.submits()).toBe(1)
    expect(run.events.some((event: any) => event.type === 'automatic_generation_requested')).toBe(true)
    expect(run.quality.visualReviewed).toBe(false)
    const body: any = vendor.calls.find(call => call.url.endsWith('/generation/image-to-model'))!.body
    expect(body.geometry_quality).toBe('detailed'); expect(body.texture_quality).toBe('detailed'); expect(body.pbr).toBe(true)
    const broken = structuredClone(artifactPlan); broken.chapters[0].cues[0].evidence[0].quote = '错误引文'
    const rejectedVendor = upstream({ plan: broken }), rejectedLocal = await start(rejectedVendor.fetchImpl), rejected = await planned(rejectedLocal, { ...artifactInput, autoGenerate: true })
    expect(rejected.status).toBe('failed'); expect(rejectedVendor.submits()).toBe(0)
  })
  it('recovers a read-only balance failure before any asset submission without replanning or duplicate generation', async () => {
    const vendor = upstream(); let balanceReads = 0
    const local = await start((request, init) => String(request).endsWith('/account/balance') && ++balanceReads === 1 ? Promise.reject(new Error('read timeout')) : vendor.fetchImpl(request, init))
    const run = await generated(local); expect(run.status).toBe('recoverable'); expect(vendor.submits()).toBe(0)
    expect(run.assets.every((asset: any) => !asset.submittedIntent && !asset.taskId)).toBe(true)
    expect((await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(202)
    const completed = await waitStatus(local, run.id, ['preview_ready']); expect(completed.status).toBe('preview_ready')
    expect(vendor.submits()).toBe(1); expect(vendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(1)
  })
  it('repairs a known rejected candidate once, preserves evidence and requires fresh story approval', async () => {
    const broken = structuredClone(artifactPlan); broken.chapters[0].cues[0].evidence[0].quote = '携竹杖'
    const vendor = upstream({ plan: artifactPlan }); let modelPosts = 0
    const fetchImpl: typeof fetch = (request, init) => {
      if (String(request).endsWith('/chat/completions') && ++modelPosts === 1) return Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(broken) } }] })))
      return vendor.fetchImpl(request, init)
    }
    const local = await start(fetchImpl), rejected = await planned(local, artifactInput)
    expect(rejected.status).toBe('failed'); expect(rejected.planRepair.eligible).toBe(true)
    expect(rejected.planRepair.diagnostics[0]).toMatchObject({ code: 'EVIDENCE_QUOTE_NOT_IN_PROVIDED_EXCERPT', cueId: 'cue-one', sourceId: 'source-one' })
    const hash = rejected.planRepair.candidateSha256
    const stale = await local.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: '0'.repeat(64), feedback: '纠正引文' }); expect(stale.status).toBe(400)
    const attempts = await Promise.all(Array.from({ length: 3 }, () => local.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: hash, feedback: '精确复制原文，旁白自然讲故事。' })))
    expect(attempts.filter(response => response.status === 202)).toHaveLength(1)
    const repaired = await waitStatus(local, rejected.id, ['story_review'])
    expect(repaired.planRepair).toMatchObject({ eligible: false, attempts: 1, maxAttempts: 1 }); expect(modelPosts).toBe(2)
    expect(vendor.submits()).toBe(0); expect(vendor.uploads()).toBe(0)
    const folder = path.join(local.directory, 'data/runs', rejected.id)
    expect(JSON.parse(await readFile(path.join(folder, 'model-candidate.json'), 'utf8')).content).toBe(JSON.stringify(broken))
    expect(JSON.parse(await readFile(path.join(folder, 'model-repair-candidate.json'), 'utf8')).content).toBe(JSON.stringify(artifactPlan))
    const request: any = vendor.calls.find(call => call.url.endsWith('/chat/completions'))!.body
    const correction = JSON.parse(request.messages[1].content[0].text).correction
    expect(correction.candidateSha256).toBe(hash); expect(correction.previousCandidate).toBe(JSON.stringify(broken)); expect(correction.feedback).toContain('自然讲故事')
    expect(await diskText(folder)).not.toContain(credentials.model.apiKey)
    const repeat = await local.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: hash, feedback: '' }); expect(repeat.status).toBe(400)
    const premature = await local.post(`/api/runs/${rejected.id}/generate`, { planSha256: hash }); expect(premature.status).toBe(400)
  })
  it('never repairs an unknown model submission or repeats a repair after restart', async () => {
    const vendor = upstream({ modelContent: JSON.stringify({ ...plan, title: '' }) })
    const local = await start(vendor.fetchImpl), failed = await planned(local)
    expect(failed.planRepair.eligible).toBe(true)
    const accepted = await local.post(`/api/runs/${failed.id}/repair-plan`, { candidateSha256: failed.planRepair.candidateSha256, feedback: '' }); expect(accepted.status).toBe(202)
    await waitStatus(local, failed.id, ['failed']); await local.app.close()
    const restored = await start(vendor.fetchImpl, local.directory), again = await restored.get(`/api/runs/${failed.id}`)
    expect(again.planRepair).toMatchObject({ eligible: false, attempts: 1 })
    expect((await restored.post(`/api/runs/${failed.id}/repair-plan`, { candidateSha256: failed.planRepair.candidateSha256, feedback: '' })).status).toBe(400)
    const unknown = await start(async () => { throw new Error('transport ambiguous') }), run = await planned(unknown)
    expect(run.status).toBe('unknown'); expect(run.planRepair.eligible).toBe(false)
    expect((await unknown.post(`/api/runs/${run.id}/repair-plan`, { candidateSha256: '0'.repeat(64), feedback: '' })).status).toBe(400)
  })
  it('locally restores a validated repair candidate after a torn snapshot without another model call', async () => {
    const broken = structuredClone(plan); broken.chapters[0].cues[0].evidence[0].quote = '不存在的引文'
    const vendor = upstream(); let posts = 0
    const local = await start((request, init) => String(request).endsWith('/chat/completions') && ++posts === 1
      ? Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(broken) } }] }))) : vendor.fetchImpl(request, init))
    const rejected = await planned(local)
    await local.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: rejected.planRepair.candidateSha256, feedback: '' })
    const reviewed = await waitStatus(local, rejected.id, ['story_review']); await local.app.close()
    const file = path.join(local.directory, 'data/runs', rejected.id, 'state.json'), snapshot = JSON.parse(await readFile(file, 'utf8'))
    snapshot.status = 'planning'; delete snapshot.plan; delete snapshot.planSha256; snapshot.assets = []; delete snapshot.modelRepairSubmission
    await writeFile(file, JSON.stringify(snapshot))
    const restored = await start(vendor.fetchImpl, local.directory), recovered = await restored.get(`/api/runs/${rejected.id}`)
    expect(recovered.status).toBe('story_review'); expect(recovered.planSha256).toBe(reviewed.planSha256)
    expect(recovered.planRepair.eligible).toBe(false); expect(vendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(1)
    expect(vendor.submits()).toBe(0)
  })
  it('does not repeat an unknown repair POST after restart or credential recovery', async () => {
    const broken = structuredClone(plan); broken.chapters[0].cues[0].evidence[0].quote = '错误引文'
    let posts = 0
    const fetchImpl: typeof fetch = async () => {
      if (++posts === 1) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(broken) } }] }))
      throw new Error('unknown repair response')
    }
    const local = await start(fetchImpl), rejected = await planned(local)
    await local.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: rejected.planRepair.candidateSha256, feedback: '' })
    const unknown = await waitStatus(local, rejected.id, ['unknown']); expect(unknown.planRepair.eligible).toBe(false); await local.app.close()
    const restored = await start(fetchImpl, local.directory)
    expect((await restored.get(`/api/runs/${rejected.id}`)).status).toBe('unknown')
    expect((await restored.post(`/api/runs/${rejected.id}/credentials`, credentials)).status).toBe(200)
    expect((await restored.post(`/api/runs/${rejected.id}/repair-plan`, { candidateSha256: rejected.planRepair.candidateSha256, feedback: '' })).status).toBe(400)
    expect(posts).toBe(2)
  })
  it('rejects changed candidate and mismatched receipt fingerprints on restart', async () => {
    for (const corrupt of ['candidate', 'receipt']) {
      const broken = structuredClone(plan); broken.chapters[0].cues[0].evidence[0].quote = '错误引文'
      const vendor = upstream({ plan: broken }), local = await start(vendor.fetchImpl), run = await planned(local); await local.app.close()
      const file = path.join(local.directory, 'data/runs', run.id, corrupt === 'candidate' ? 'model-candidate.json' : 'model-receipt.json')
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (corrupt === 'candidate') value.content = JSON.stringify(plan); else value.requestSha256 = '0'.repeat(64)
      await writeFile(file, JSON.stringify(value))
      const restored = await start(vendor.fetchImpl, local.directory)
      expect((await fetch(restored.base + `/api/runs/${run.id}`)).status).toBe(404)
      expect(vendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(1)
    }
  })
  it.each(['text', 'image'])('checks current official DeepSeek %s capability before sending a photo plan', async modality => {
    const vendor = upstream({ plan: artifactPlan }), value = { ...artifactInput, model: { ...credentials.model, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' } }
    let discoveries = 0
    const fetchImpl: typeof fetch = async (request, init) => {
      if (String(request).endsWith('/models')) {
        discoveries++
        return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash', input_modalities: ['text', ...(modality === 'image' ? ['image'] : [])] }] }), { headers: { 'Content-Type': 'application/json' } })
      }
      return vendor.fetchImpl(request, init)
    }
    const local = await start(fetchImpl), run = await planned(local, value)
    expect(discoveries).toBe(1); expect(vendor.submits()).toBe(0); expect(vendor.uploads()).toBe(0)
    const calls = vendor.calls.filter(call => call.url.endsWith('/chat/completions'))
    if (modality === 'text') {
      expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('MODEL_IMAGE_UNSUPPORTED'); expect(calls).toHaveLength(0)
    } else {
      expect(run.status).toBe('story_review'); expect(calls).toHaveLength(1)
      const request: any = calls[0].body
      expect(request.model).toBe('deepseek-flash'); expect(request.thinking).toEqual({ type: 'enabled' }); expect(request.reasoning_effort).toBe('high'); expect(request.max_tokens).toBe(12000)
      expect(request.messages[1].content[1].image_url.url).toBe(value.imageDataUrl)
      const folder = path.join(local.directory, 'data/runs', run.id)
      expect(JSON.parse(await readFile(path.join(folder, 'model-capabilities.json'), 'utf8')).verifiedFromOfficialModelsEndpoint).toBe(true)
      const candidate = JSON.parse(await readFile(path.join(folder, 'model-candidate.json'), 'utf8'))
      expect(candidate.trusted).toBe(false); expect(candidate.reviewRequired).toBe(true)
      expect(await diskText(folder)).not.toContain(credentials.model.apiKey)
    }
  })
  it('allows verified audio and embedded GLB texture blobs while restricting network, scripts and objects', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl, undefined, fixtureNarration), run = await generated(local)
    expect(run.status).toBe('preview_ready')
    for (const pathname of ['/', `/runs/${run.id}/viewer.html`, `/runs/${run.id}/narration/cue-one.wav`]) {
      const response = await fetch(local.base + pathname); expect(response.status).toBe(200)
      const directives = new Map(response.headers.get('Content-Security-Policy')!.split(';').map(value => {
        const [name, ...sources] = value.trim().split(/\s+/); return [name, sources]
      }))
      expect(directives.get('media-src')).toEqual(["'self'", 'blob:'])
      expect(directives.get('connect-src')).toEqual(["'self'", 'blob:'])
      expect(directives.get('img-src')).toEqual(["'self'", 'blob:', 'data:'])
      expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
      expect(directives.get('object-src')).toEqual(["'none'"])
      expect(directives.get('default-src')).toEqual(["'self'"])
      expect(response.headers.get('Content-Security-Policy')).not.toMatch(/\*|https?:|unsafe-eval/)
    }
  })
  it.each(['mural', 'artifact'])('sends the actual frozen %s policy requirements to the planner without treating them as passed', async subjectType => {
    const vendor = upstream({ plan: subjectType === 'artifact' ? artifactPlan : plan }), local = await start(vendor.fetchImpl)
    const run = await planned(local, subjectType === 'artifact' ? artifactInput : input)
    expect(run.status).toBe('story_review'); expect(vendor.submits()).toBe(0); expect(vendor.uploads()).toBe(0)
    const folder = path.join(local.directory, 'data/runs', run.id), frozenBytes = await readFile(path.join(folder, 'quality-policy.json')), frozen = JSON.parse(frozenBytes.toString('utf8'))
    const context = JSON.parse(await readFile(path.join(folder, 'planning-policy-context.json'), 'utf8'))
    const body: any = vendor.calls.find(call => call.url.endsWith('/chat/completions'))!.body
    const sent = JSON.parse(body.messages[0].content.split('Frozen planning policy JSON:\n')[1].split('\n')[0])
    expect(sent).toEqual(context); expect(sent.sha256).toBe(createHash('sha256').update(frozenBytes).digest('hex'))
    expect(sent.rules).toEqual(frozen.rules.filter((rule: any) => !rule.appliesTo || rule.appliesTo.includes(subjectType)).map((rule: any) => ({ id: rule.id, stage: rule.stage, requirement: rule.requirement, ...(rule.condition ? { condition: rule.condition } : {}) })))
    expect(sent.rules.some((rule: any) => rule.id === 'A08')).toBe(subjectType === 'artifact')
    expect(sent.rules.find((rule: any) => rule.id === 'B04').condition).toBeTruthy()
    expect(run.planningPolicy.status).toBe('provided-to-planner-not-verified')
    expect(run.planningPolicy.ruleIds).toEqual(sent.rules.map((rule: any) => rule.id))
    const intent = JSON.parse(await readFile(path.join(folder, 'model-intent.json'), 'utf8'))
    expect(intent.policySha256).toBe(sent.sha256); expect(intent.planningRuleIds).toEqual(run.planningPolicy.ruleIds)
    for (const secret of [credentials.model.apiKey, credentials.tripo.apiKey]) expect(await diskText(folder)).not.toContain(secret)
  })
  it('uses each run frozen policy after the configured file changes and restores it without replanning', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mural-agent-policy-')), policyFile = path.join(directory, 'configured-policy.json')
    const original = JSON.parse(await readFile(new URL('../agent/quality-policy-r13.json', import.meta.url), 'utf8'))
    original.policyId = 'fixture-frozen-policy'; original.rules[0].requirement = '本运行冻结规则：先给观众提供明确故事与证据。'
    const originalBytes = Buffer.from(JSON.stringify(original)); await writeFile(policyFile, originalBytes)
    const vendor = upstream(), local = await start(vendor.fetchImpl, directory, undefined, policyFile)
    const replacement = structuredClone(original); replacement.policyId = 'fixture-later-policy'; replacement.rules[0].requirement = '后续默认配置不能覆盖旧运行冻结副本。'
    await writeFile(policyFile, JSON.stringify(replacement))
    const run = await planned(local)
    expect(run.planningPolicy.policyId).toBe(original.policyId)
    const body: any = vendor.calls.find(call => call.url.endsWith('/chat/completions'))!.body
    expect(body.messages[0].content).toContain(original.rules[0].requirement); expect(body.messages[0].content).not.toContain(replacement.rules[0].requirement)
    await local.app.close()
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, directory, undefined, policyFile), recovered = await restored.get(`/api/runs/${run.id}`)
    expect(recovered.planningPolicy).toEqual(run.planningPolicy); expect(nextVendor.calls).toHaveLength(0)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    await restored.post(`/api/runs/${run.id}/generate`, { planSha256: recovered.planSha256 })
    expect((await waitStatus(restored, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready')
    expect(nextVendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(0)
    const report = await restored.get(`/runs/${run.id}/quality-report.json`), frozen = Buffer.from(await (await fetch(restored.base + `/runs/${run.id}/quality-policy.json`)).arrayBuffer())
    expect(frozen.equals(originalBytes)).toBe(true); expect(report.policy.policyId).toBe(original.policyId)
    expect(report.planningPolicy.status).toBe('provided-to-planner-not-verified'); expect(report.planningPolicy.policySha256).toBe(run.planningPolicy.sha256)
    expect(report.rules.every((rule: any) => rule.state === 'pending')).toBe(true); expect(report.releaseReady).toBe(false)
    expect((await restored.get('/api/policy')).policyId).toBe(replacement.policyId)
  })
  it('plans once and exports real raw bytes with every release rule pending', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('preview_ready'); expect(vendor.submits()).toBe(1)
    expect(vendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(1)
    const base = `/runs/${run.id}`, report = await local.get(base + '/quality-report.json'), manifest = await local.get(base + '/asset-manifest.json')
    expect(report.rules.length).toBe(38); expect(report.rules.every((rule: any) => rule.state === 'pending')).toBe(true)
    expect(report.releaseReady).toBe(false); expect(report.narration.complete).toBe(false); expect(report.animation.complete).toBe(false)
    const frozen = Buffer.from(await (await fetch(local.base + base + '/quality-policy.json')).arrayBuffer())
    expect(report.policy.sha256).toBe(createHash('sha256').update(frozen).digest('hex')); expect(report.runId).toBe(run.id)
    const bytes = Buffer.from(await (await fetch(local.base + base + '/assets/prop-one.glb')).arrayBuffer())
    expect(bytes.equals(await fixturePromise)).toBe(true); expect(manifest.assets[0].rawSha256).toBe(manifest.assets[0].sha256)
    const story = await local.get(base + '/story.json'); expect(story.sources[0].status).toBe('provided'); expect(story.narration.status).toBe('not_configured')
    const text = JSON.stringify(run) + await diskText(path.join(local.directory, 'data'))
    for (const secret of [credentials.model.apiKey, credentials.tripo.apiKey, 'fixture-signed-token']) expect(text).not.toContain(secret)
    expect((await fetch(local.base + base + '/vendor/three.module.js')).status).toBe(200)
    const approval = await local.post(`/api/runs/${run.id}/review`, { approved: true, notes: '人工看过此离线测试预览。' })
    expect((await approval.json()).status).toBe('visual_reviewed')
    const reviewed = await local.get(base + '/quality-report.json'); expect(reviewed.rules.every((rule: any) => rule.state === 'pending')).toBe(true); expect(reviewed.releaseReady).toBe(false)
  })
  it('rejects a stale approval hash and over-budget plan before any paid POST', async () => {
    const two = structuredClone(plan); two.assets.push({ ...two.assets[0], id: 'prop-two' }); two.scenes[0].placements.push({ ...two.scenes[0].placements[0], assetId: 'prop-two' })
    const vendor = upstream({ plan: two }), local = await start(vendor.fetchImpl), run = await planned(local)
    expect((await local.post(`/api/runs/${run.id}/generate`, { planSha256: 'stale' })).status).toBe(400)
    const denied = await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    expect((await denied.json()).error.code).toBe('BUDGET_REJECTED'); expect(vendor.submits()).toBe(0)
  })
  it('checks balance before submitting a new asset', async () => {
    const vendor = upstream({ balance: 49 }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('INSUFFICIENT_BALANCE'); expect(vendor.submits()).toBe(0)
  })
  it('makes concurrent and repeated generate requests idempotent', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), run = await planned(local)
    const responses = await Promise.all([1, 2, 3].map(() => local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })))
    expect(responses.every(response => response.status === 202)).toBe(true)
    expect((await waitStatus(local, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready')
    expect((await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(202); expect(vendor.submits()).toBe(1)
  })
  it('never resubmits an unknown paid POST after a restart or credential recovery', async () => {
    const vendor = upstream({ submitUnknown: true }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('unknown'); expect(vendor.submits()).toBe(1); await local.app.close()
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    expect(nextVendor.calls).toHaveLength(0)
    expect((await restored.post(`/api/runs/${run.id}/credentials`, credentials)).status).toBe(200)
    expect((await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(400)
    expect(nextVendor.calls).toHaveLength(0)
    expect(await diskText(path.join(local.directory, 'data'))).not.toContain(credentials.tripo.apiKey)
  })
  it('treats a paid POST HTTP failure without a task receipt as unknown', async () => {
    const vendor = upstream({ submitHttpFailure: true }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('unknown'); expect(run.assets[0].status).toBe('unknown'); expect(vendor.submits()).toBe(1)
    expect((await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(400)
    expect(vendor.submits()).toBe(1); expect(JSON.stringify(run) + await diskText(path.join(local.directory, 'data'))).not.toContain(credentials.tripo.apiKey)
  })
  it('restores known task receipts after a torn snapshot and polls without a new POST', async () => {
    const vendor = upstream({ pollFail: true }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('recoverable'); await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    snapshot.status = 'generating'; delete snapshot.assets[0].taskId; delete snapshot.assets[0].submittedIntent; snapshot.assets[0].status = 'pending'
    await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory), recovered = await restored.get(`/api/runs/${run.id}`)
    expect(recovered.status).toBe('recoverable'); expect(recovered.assets[0].taskId).toBe('fixture-task-one'); expect(nextVendor.calls).toHaveLength(0)
    expect((await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(400)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials); await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    expect((await waitStatus(restored, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready'); expect(nextVendor.submits()).toBe(0)
  })
  it('restores legacy mural snapshots that omit subject type and generation mode', async () => {
    const vendor = upstream({ pollFail: true }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('recoverable'); await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    delete snapshot.input.subjectType; delete snapshot.input.imageSha256; delete snapshot.plan.subjectType
    for (const asset of snapshot.plan.assets) delete asset.generationMode
    for (const asset of snapshot.assets) delete asset.generationMode
    snapshot.planSha256 = createHash('sha256').update(JSON.stringify(snapshot.plan)).digest('hex')
    await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory), legacy = await restored.get(`/api/runs/${run.id}`)
    expect(legacy.subjectType).toBe('mural'); expect(legacy.estimatedCredits).toBe(50); expect(legacy.assets[0].generationMode).toBe('text-to-model')
    expect(nextVendor.calls).toHaveLength(0)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    await restored.post(`/api/runs/${run.id}/generate`, { planSha256: legacy.planSha256 })
    expect((await waitStatus(restored, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready'); expect(nextVendor.submits()).toBe(0)
  })
  it('reconciles an intent written before a torn snapshot as unknown', async () => {
    const vendor = upstream({ submitUnknown: true }), local = await start(vendor.fetchImpl), run = await generated(local); await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    snapshot.status = 'generating'; snapshot.assets[0] = { id: 'prop-one', kind: 'prop', heightM: 1.4, status: 'pending' }; await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    expect((await restored.get(`/api/runs/${run.id}`)).status).toBe('unknown'); expect(nextVendor.calls).toHaveLength(0)
  })
  it('rejects model key echo before persisting or returning model output', async () => {
    const echoed = structuredClone(plan); echoed.summary = credentials.model.apiKey
    const vendor = upstream({ plan: echoed }), local = await start(vendor.fetchImpl), run = await planned(local)
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('SECRET_IN_OUTPUT'); expect(run.plan).toBeUndefined()
    expect(JSON.stringify(run) + await diskText(path.join(local.directory, 'data'))).not.toContain(credentials.model.apiKey); expect(vendor.submits()).toBe(0)
  })
  it('rejects a newly planned 501-character cue before any image upload or paid generation', async () => {
    const long = structuredClone(artifactPlan); long.chapters[0].cues[0].text = '文'.repeat(501)
    const vendor = upstream({ plan: long }), local = await start(vendor.fetchImpl), run = await planned(local, artifactInput)
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('CUE_TEXT_TOO_LONG'); expect(run.plan).toBeUndefined()
    expect(vendor.uploads()).toBe(0); expect(vendor.submits()).toBe(0)
  })
  it('keeps an older 501-character story visible as failed without changing its text or approval hash', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), run = await planned(local)
    await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    snapshot.plan.chapters[0].cues[0].text = '旧'.repeat(501)
    snapshot.planSha256 = createHash('sha256').update(JSON.stringify(snapshot.plan)).digest('hex')
    await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory), legacy = await restored.get(`/api/runs/${run.id}`)
    expect(legacy.status).toBe('failed'); expect(legacy.errors.at(-1).code).toBe('STORY_REVIEW_REQUIRED_CUE_TOO_LONG')
    expect(legacy.errors.at(-1).message).toContain('新建运行拆句'); expect(legacy.plan).toEqual(snapshot.plan); expect(legacy.planSha256).toBe(snapshot.planSha256)
    expect(legacy.plan.chapters[0].cues[0].text).toHaveLength(501)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    expect((await restored.post(`/api/runs/${run.id}/generate`, { planSha256: legacy.planSha256 })).status).toBe(400)
    expect(nextVendor.calls).toHaveLength(0)
    const saved = JSON.parse(await readFile(stateFile, 'utf8'))
    expect(saved.plan).toEqual(snapshot.plan); expect(saved.planSha256).toBe(snapshot.planSha256)
  })
  it('does not export a gray-box or incomplete package for invalid delivered GLB', async () => {
    const invalid = mutateGlb(await fixturePromise, doc => { delete doc.meshes[0].primitives[0].attributes.TEXCOORD_0 })
    const vendor = upstream({ glb: invalid }), local = await start(vendor.fetchImpl), run = await generated(local)
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('INVALID_GLB'); expect(run.packageUrl).toBeUndefined()
    expect((await fetch(local.base + `/runs/${run.id}/viewer.html`)).status).toBe(404)
  })
  it('enforces exact Origin, input image magic, body limit and public path confinement', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl)
    expect((await local.post('/api/runs', input, 'https://evil.example')).status).toBe(403)
    expect((await local.post('/api/runs', { ...input, imageDataUrl: 'data:image/png;base64,YWJjZA==' })).status).toBe(400)
    expect((await local.post('/api/runs', 'x'.repeat(12 * 1024 * 1024))).status).toBe(413)
    expect((await fetch(local.base + '/%2e%2e%2fagent/contracts.ts')).status).toBe(404)
    expect((await fetch(local.base + '/vendor/three/../package.json')).status).toBe(404)
    expect((await local.get('/api/health')).ok).toBe(true); expect((await local.get('/api/policy')).policySha256).toMatch(/^[a-f0-9]{64}$/)
    expect(vendor.calls).toHaveLength(0)
  })
  it('blocks junction escape from an otherwise whitelisted exported asset path', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), run = await generated(local)
    const packageDir = path.join(local.directory, 'data/runs', run.id, 'package'), outside = path.join(local.directory, 'outside')
    await mkdir(outside); await writeFile(path.join(outside, 'prop-one.glb'), 'private fixture data')
    await rename(path.join(packageDir, 'assets'), path.join(packageDir, 'assets-original'))
    await symlink(outside, path.join(packageDir, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await fetch(local.base + `/runs/${run.id}/assets/prop-one.glb`)).status).toBe(404)
  })
})

describe('artifact agent real image route with offline upstreams', () => {
  it('uploads the exact original image, uses image-to-model, exports its provenance without the upload token', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl)
    const ready = await planned(local, artifactInput)
    expect(ready.subjectType).toBe('artifact'); expect(ready.subjectMetadata).toEqual(artifactInput.subjectMetadata)
    expect(ready.primaryAssetId).toBe('prop-one'); expect(ready.estimatedCredits).toBe(60)
    expect(vendor.submits()).toBe(0); expect(vendor.uploads()).toBe(0)
    const planningBody: any = vendor.calls.find(call => call.url.endsWith('/chat/completions'))!.body
    expect(planningBody.messages[0].content).toContain('This run is ARTIFACT mode')
    expect(planningBody.messages[0].content).toContain('not a measured archaeological dimension')
    expect(JSON.parse(planningBody.messages[1].content[0].text).subjectMetadata).toEqual(artifactInput.subjectMetadata)
    await local.post(`/api/runs/${ready.id}/generate`, { planSha256: ready.planSha256 })
    const run = await waitStatus(local, ready.id, ['preview_ready', 'failed', 'unknown'])
    expect(run.status).toBe('preview_ready'); expect(vendor.submits()).toBe(1); expect(vendor.textSubmits()).toBe(0); expect(vendor.uploads()).toBe(1)
    const upload = vendor.calls.find(call => call.url.endsWith('/files'))!, form = upload.body as FormData
    expect(new Headers(upload.headers).get('Content-Type')).toBeNull()
    const file = form.get('file') as File, bytes = Buffer.from(await file.arrayBuffer())
    expect(file.name).toBe('image.png'); expect(file.type).toBe('image/png')
    expect(bytes.equals(Buffer.from(input.imageDataUrl.split(',')[1], 'base64'))).toBe(true)
    const request: any = vendor.calls.find(call => call.url.endsWith('/generation/image-to-model'))!.body
    expect(request.input).toBe('file_fixture-private-upload-token'); expect(request.model).toBe('v3.1-20260211')
    expect(request.prompt).toBeUndefined(); expect(request.enable_image_autofix).toBe(false)
    const digest = createHash('sha256').update(bytes).digest('hex'), base = `/runs/${run.id}`
    const story = await local.get(base + '/story.json'), scene = await local.get(base + '/scene.json'), manifest = await local.get(base + '/asset-manifest.json')
    expect(story.subjectType).toBe('artifact'); expect(story.primaryAssetId).toBe('prop-one'); expect(story.subjectMetadata).toEqual(artifactInput.subjectMetadata)
    expect(story.imageSha256).toBe(digest); expect(story.metadataStatus).toBe('provided-context-not-authenticated')
    expect(scene.primaryAssetId).toBe('prop-one'); expect(scene.assets[0].normalization.heightStatus).toBe('display-scale-not-measured')
    expect(manifest.assets[0].inputImageSha256).toBe(digest)
    expect(manifest.assets[0].fileTokenSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.assets[0].generationMode).toBe('image-to-model')
    expect(Buffer.from(await (await fetch(local.base + base + '/assets/prop-one.glb')).arrayBuffer()).equals(await fixturePromise)).toBe(true)
    const disk = await diskText(path.join(local.directory, 'data'))
    expect(disk + JSON.stringify(run)).not.toContain('file_fixture-private-upload-token')
    for (const secret of [credentials.model.apiKey, credentials.tripo.apiKey]) expect(disk).not.toContain(secret)
  })
  it('rejects a primary artifact generated only from text before any upload or generation', async () => {
    const generic = structuredClone(artifactPlan); generic.assets[0].generationMode = 'text-to-model'
    const vendor = upstream({ plan: generic }), local = await start(vendor.fetchImpl), run = await planned(local, artifactInput)
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('ARTIFACT_PRIMARY_IMAGE_ASSET_REQUIRED')
    expect(vendor.uploads()).toBe(0); expect(vendor.submits()).toBe(0)
  })
  it('rejects an artifact budget below 60 and balance below 60 before image upload', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl), run = await planned(local, { ...artifactInput, budget: { maxAssets: 1, maxCredits: 50 } })
    const denied = await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    expect((await denied.json()).error.code).toBe('BUDGET_REJECTED'); expect(vendor.uploads()).toBe(0); expect(vendor.submits()).toBe(0)
    const low = upstream({ plan: artifactPlan, balance: 59 }), next = await start(low.fetchImpl), failed = await generated(next, artifactInput)
    expect(failed.errors.at(-1).code).toBe('INSUFFICIENT_BALANCE'); expect(low.uploads()).toBe(0); expect(low.submits()).toBe(0)
  })
  it.each(['transport', 'http', 'invalid-token', 'invalid-json'] as const)('stops on %s image upload failure without a text substitute or auxiliary paid task', async uploadFailure => {
    const two = structuredClone(artifactPlan)
    two.assets.unshift({ ...two.assets[0], id: 'support-one', generationMode: 'text-to-model' })
    two.scenes[0].placements.push({ assetId: 'support-one', position: [2, 0, 0], heading: 0 })
    const vendor = upstream({ plan: two, uploadFailure }), local = await start(vendor.fetchImpl), run = await generated(local, { ...artifactInput, budget: { maxAssets: 2, maxCredits: 110 } })
    expect(run.status).toBe('failed'); expect(run.errors.at(-1).code).toBe('IMAGE_UPLOAD_FAILED')
    expect(vendor.uploads()).toBe(1); expect(vendor.submits()).toBe(0); expect(run.packageUrl).toBeUndefined()
    expect((await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(400)
    expect(await diskText(path.join(local.directory, 'data'))).not.toContain(credentials.tripo.apiKey)
  })
  it.each([{ submitUnknown: true }, { submitHttpFailure: true }])('never resubmits uncertain image generation after credential recovery or restart (%j)', async failure => {
    const vendor = upstream({ plan: artifactPlan, ...failure }), local = await start(vendor.fetchImpl), run = await generated(local, artifactInput)
    expect(run.status).toBe('unknown'); expect(vendor.uploads()).toBe(1); expect(vendor.submits()).toBe(1)
    await local.app.close()
    const nextVendor = upstream({ plan: artifactPlan }), restored = await start(nextVendor.fetchImpl, local.directory)
    expect((await restored.get(`/api/runs/${run.id}`)).subjectType).toBe('artifact')
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    expect((await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })).status).toBe(400)
    expect(nextVendor.calls).toHaveLength(0)
    expect(await diskText(path.join(local.directory, 'data'))).not.toContain('file_fixture-private-upload-token')
  })
  it('restores an image task receipt and input hashes after a torn snapshot without reuploading', async () => {
    const vendor = upstream({ plan: artifactPlan, pollFail: true }), local = await start(vendor.fetchImpl), run = await generated(local, artifactInput)
    expect(run.status).toBe('recoverable'); await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    snapshot.status = 'generating'; snapshot.assets[0] = { id: 'prop-one', kind: 'prop', heightM: 1.4, status: 'pending' }
    await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream({ plan: artifactPlan }), restored = await start(nextVendor.fetchImpl, local.directory), recovered = await restored.get(`/api/runs/${run.id}`)
    expect(recovered.status).toBe('recoverable'); expect(recovered.subjectMetadata).toEqual(artifactInput.subjectMetadata)
    expect(recovered.assets[0].generationMode).toBe('image-to-model'); expect(recovered.assets[0].inputImageSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(nextVendor.calls).toHaveLength(0)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    await restored.post(`/api/runs/${run.id}/generate`, { planSha256: recovered.planSha256 })
    expect((await waitStatus(restored, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready')
    expect(nextVendor.uploads()).toBe(0); expect(nextVendor.submits()).toBe(0)
  })
  it('detects changed original image bytes before upload and rejects metadata containing a credential', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl)
    const rejected = await local.post('/api/runs', { ...artifactInput, subjectMetadata: { name: credentials.model.apiKey } })
    expect((await rejected.json()).error.code).toBe('SECRET_IN_OUTPUT'); expect(vendor.calls).toHaveLength(0)
    const run = await planned(local, artifactInput)
    await writeFile(path.join(local.directory, 'data/runs', run.id, 'image.png'), Buffer.from(input.imageDataUrl.split(',')[1], 'base64').subarray(0, 30))
    await local.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    const failed = await waitStatus(local, run.id, ['failed', 'unknown'])
    expect(failed.errors.at(-1).code).toBe('INPUT_IMAGE_HASH_MISMATCH'); expect(vendor.uploads()).toBe(0); expect(vendor.submits()).toBe(0)
  })
})

describe('fixed public narration packaging and recovery with offline runners', () => {
  it('exports validated PCM audio and matching subtitles, leaving human audio review pending', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl, undefined, fixtureNarration), run = await generated(local, artifactInput)
    expect(run.status).toBe('preview_ready'); expect(run.narration.complete).toBe(true); expect(vendor.submits()).toBe(1)
    const base = `/runs/${run.id}`, story = await local.get(base + '/story.json'), report = await local.get(base + '/quality-report.json'), manifest = await local.get(base + '/narration/manifest.json')
    expect(story.narration).toEqual(manifest); expect(manifest.voiceId).toBe('history3d-public-uncle-fu-r13')
    expect(report.narration.status).toBe('generated-human-review-pending'); expect(report.narration.complete).toBe(true)
    expect(report.narration.humanAudioReviewed).toBe(false); expect(report.releaseReady).toBe(false)
    expect(report.rules.every((rule: any) => rule.state === 'pending')).toBe(true)
    const track = manifest.tracks[0], response = await fetch(local.base + base + '/' + track.file), bytes = Buffer.from(await response.arrayBuffer())
    expect(response.headers.get('content-type')).toBe('audio/wav'); expect(bytes.equals(fixtureWave())).toBe(true)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(track.subtitleAudioSha256)
    expect(track.subtitlePoints.at(-1).textEnd).toBe(artifactPlan.chapters[0].cues[0].text.length)
    expect((await fetch(local.base + base + '/narration/%2e%2e%2fstate.json')).status).toBe(404)
  })
  it.each(['VOICE_UNAVAILABLE', 'VOICE_FAILED'])('keeps ready Tripo assets and resumes only narration after %s', async code => {
    let attempts = 0
    const runner: NarrationRunner = async context => { attempts++; if (attempts === 1) throw new ContractError(code); return fixtureNarration(context) }
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl, undefined, runner), first = await generated(local, artifactInput)
    expect(first.status).toBe('recoverable'); expect(first.errors.at(-1).code).toBe(code)
    expect(first.assets.every((asset: any) => asset.status === 'ready')).toBe(true); expect(first.packageUrl).toBeUndefined()
    const initialCalls = vendor.calls.length
    expect((await local.post(`/api/runs/${first.id}/generate`, { planSha256: first.planSha256 })).status).toBe(202)
    const recovered = await waitStatus(local, first.id, ['preview_ready', 'failed'])
    expect(recovered.status).toBe('preview_ready'); expect(attempts).toBe(2); expect(vendor.calls).toHaveLength(initialCalls)
    expect(vendor.uploads()).toBe(1); expect(vendor.submits()).toBe(1)
  })
  it('restores a voice-only recoverable run after restart and generates no new Tripo task', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl, undefined, async () => { throw new ContractError('VOICE_UNAVAILABLE') }), run = await generated(local)
    expect(run.status).toBe('recoverable'); await local.app.close()
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory, fixtureNarration)
    expect(nextVendor.calls).toHaveLength(0)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    const complete = await waitStatus(restored, run.id, ['preview_ready', 'failed'])
    expect(complete.status).toBe('preview_ready'); expect(complete.narration.complete).toBe(true); expect(nextVendor.calls).toHaveLength(0)
  })
  it('rejects a corrupt or mismatched WAV instead of exporting an incomplete narration', async () => {
    const bad: NarrationRunner = async context => {
      const manifest = await fixtureNarration(context)
      await writeFile(path.join(context.runDir, manifest.tracks[0].file), 'not a WAVE file')
      return manifest
    }
    const vendor = upstream(), local = await start(vendor.fetchImpl, undefined, bad), run = await generated(local)
    expect(run.status).toBe('recoverable'); expect(run.errors.at(-1).code).toBe('VOICE_FAILED')
    expect(run.assets[0].status).toBe('ready'); expect(run.packageUrl).toBeUndefined()
    expect((await fetch(local.base + `/runs/${run.id}/viewer.html`)).status).toBe(404)
  })
  it('rejects subtitles bound to a different audio hash while preserving ready 3D assets', async () => {
    const bad: NarrationRunner = async context => {
      const manifest = await fixtureNarration(context); manifest.tracks[0].subtitleAudioSha256 = '0'.repeat(64)
      return manifest
    }
    const vendor = upstream(), local = await start(vendor.fetchImpl, undefined, bad), run = await generated(local)
    expect(run.status).toBe('recoverable'); expect(run.errors.at(-1).code).toBe('VOICE_FAILED')
    expect(run.assets[0].status).toBe('ready'); expect(vendor.submits()).toBe(1); expect(run.packageUrl).toBeUndefined()
  })
  it('uses the 38-rule r14 policy for new runs and binds its lesson document without claiming quality approval', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), current = await local.get('/api/policy')
    const bytes = await readFile(path.resolve('agent/quality-policy-r14.json')), policy = JSON.parse(bytes.toString('utf8'))
    const sourceDocument = await readFile(path.resolve('agent', policy.sourceDocument))
    expect(current.policyId).toBe('heritage-story-quality-r14'); expect(current.rules).toHaveLength(38)
    expect(current.policySha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(policy.sourceSha256).toBe(createHash('sha256').update(sourceDocument).digest('hex'))
    expect(policy.runtimeGenerationPolicy).toMatchObject({ automaticAfterValidatedPlan: true, perAssetCostConfirmation: false, qualityBeforeCreditSaving: true, unknownPostMustBeReconciled: true, humanQualityApprovalIsSeparate: true })
    const run = await planned(local)
    const frozen = await readFile(path.join(local.directory, 'data/runs', run.id, 'quality-policy.json'))
    expect(frozen.equals(bytes)).toBe(true); expect(run.planningPolicy.policyId).toBe(current.policyId)
    expect(run.planningPolicy.ruleIds).toEqual(policy.rules.filter((rule: any) => !rule.appliesTo || rule.appliesTo.includes('mural')).map((rule: any) => rule.id))
    expect(run.planningPolicy.status).toBe('provided-to-planner-not-verified'); expect(vendor.submits()).toBe(0)
  })
  it.each([
    { version: 'r10', file: 'agent/quality-policy.json', rules: 26 },
    { version: 'r13', file: 'agent/quality-policy-r13.json', rules: 33 },
  ])('preserves the original frozen $version policy when an older run resumes under the r14 server', async ({ file, rules }) => {
    const oldPolicy = path.resolve(file), vendor = upstream({ pollFail: true }), local = await start(vendor.fetchImpl, undefined, undefined, oldPolicy), run = await generated(local)
    expect(run.status).toBe('recoverable'); await local.app.close()
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    await restored.post(`/api/runs/${run.id}/generate`, { planSha256: run.planSha256 })
    expect((await waitStatus(restored, run.id, ['preview_ready', 'failed'])).status).toBe('preview_ready')
    const report = await restored.get(`/runs/${run.id}/quality-report.json`), frozen = Buffer.from(await (await fetch(restored.base + `/runs/${run.id}/quality-policy.json`)).arrayBuffer())
    expect(report.rules).toHaveLength(rules); expect(frozen.equals(await readFile(oldPolicy))).toBe(true)
    expect(report.policy.sha256).toBe(createHash('sha256').update(frozen).digest('hex'))
    const current = await restored.get('/api/policy')
    expect(current.rules).toHaveLength(38); expect(current.policyId).toBe('heritage-story-quality-r14')
    expect(report.policy.policyId).toBe(JSON.parse(frozen.toString('utf8')).policyId)
    expect(nextVendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(0)
  })
})

describe('auditable quality-first replacement assets', () => {
  it('keeps the old preview until explicit checked selection, offers an isolated candidate preview, and reuses identical narration', async () => {
    const vendor = upstream(); let narrationCalls = 0, replacementMode = false
    const replacement = mutateGlb(await fixturePromise, doc => { doc.materials[0].name = 'audited-replacement-geometry' })
    const fetchImpl: typeof fetch = (request, init) => replacementMode && String(request).startsWith('https://asset.example.invalid/') ? Promise.resolve(new Response(replacement)) : vendor.fetchImpl(request, init)
    const local = await start(fetchImpl, undefined, async args => { narrationCalls++; return fixtureNarration(args) })
    const original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 1000 } }), run = await idleRun(local, original.id)
    const originalRaw = await readFile(path.join(local.directory, 'data/runs', run.id, 'raw/prop-one.glb'))
    replacementMode = true
    const requested = await candidateRequest(local, run, { seed: 123, faceLimit: 100000 }), completed = await idleRun(local, run.id), candidate = completed.assetCandidates[0]
    expect(candidate).toMatchObject({ status: 'ready', seed: 123, faceLimit: 100000, active: false, promptApplied: true, errors: [] })
    expect(candidate.previewUrl).toContain(`/candidate-previews/${candidate.id}/viewer.html`)
    expect(completed.assets[0].sha256).toBe(run.assets[0].sha256); expect(completed.status).toBe('preview_ready')
    const previewManifest = await local.get(candidate.previewUrl.replace('viewer.html', 'asset-manifest.json'))
    expect(previewManifest.assets[0]).toMatchObject({ id: 'prop-one', selectedCandidateId: candidate.id, sha256: candidate.sha256 })
    const previewAudio = Buffer.from(await (await fetch(local.base + candidate.previewUrl.replace('viewer.html', 'narration/cue-one.wav'))).arrayBuffer())
    const originalAudio = await readFile(path.join(local.directory, 'data/runs', run.id, 'narration/cue-one.wav'))
    expect(previewAudio.equals(originalAudio)).toBe(true); expect(narrationCalls).toBe(1)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/select`, { candidateSha256: '0'.repeat(64) })).status).toBe(400)
    const picked = await local.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/select`, { candidateSha256: candidate.sha256 }); expect(picked.status).toBe(200)
    const selected = await picked.json(); expect(selected.assets[0]).toMatchObject({ id: 'prop-one', selectedCandidateId: candidate.id, sha256: candidate.sha256 }); expect(selected.quality.visualReviewed).toBe(false)
    const selectedBytes = Buffer.from(await (await fetch(local.base + `/runs/${run.id}/assets/prop-one.glb`)).arrayBuffer())
    expect(selectedBytes.equals(replacement)).toBe(true); expect((await readFile(path.join(local.directory, 'data/runs', run.id, 'raw/prop-one.glb'))).equals(originalRaw)).toBe(true)
    expect(narrationCalls).toBe(1); expect(selected.creditsReservedOrConsumed).toBe(100); expect(vendor.submits()).toBe(2)
    const paid = vendor.calls.filter(call => call.url.endsWith('/generation/text-to-model'))[1].body as any
    expect(paid).toMatchObject({ model_seed: 123, texture_seed: 123, face_limit: 100000, geometry_quality: 'detailed', texture_quality: 'detailed', pbr: true })
    expect(paid.prompt).toBe(requested.value.prompt)
    const disk = await diskText(local.directory); expect(disk).not.toContain(credentials.model.apiKey); expect(disk).not.toContain(credentials.tripo.apiKey)
    expect((await fetch(local.base + candidate.previewUrl.replace('viewer.html', 'state.json'))).status).toBe(404)
    await local.app.close()
    // The isolated package and selection receipt are durable, but the last state
    // snapshot can still point at the previous package after a process crash.
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), torn = JSON.parse(await readFile(stateFile, 'utf8'))
    torn.assets = torn.originalAssets; torn.packageDirectory = 'package'; await writeFile(stateFile, JSON.stringify(torn))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    const afterRestart = await restored.get(`/api/runs/${run.id}`); expect(afterRestart.assets[0].selectedCandidateId).toBe(candidate.id); expect(afterRestart.creditsReservedOrConsumed).toBe(100); expect(nextVendor.calls).toHaveLength(0)
    const restoredPackage = await restored.get(`/runs/${run.id}/asset-manifest.json`); expect(restoredPackage.assets[0].sha256).toBe(candidate.sha256)
    expect((await restored.post(`/api/runs/${run.id}/review`, { approved: true, notes: '人工核对后认可本候选。' })).status).toBe(200)
    await restored.app.close()
    const reviewedApp = await start(nextVendor.fetchImpl, local.directory), reviewed = await reviewedApp.get(`/api/runs/${run.id}`)
    expect(reviewed.status).toBe('visual_reviewed'); expect(reviewed.quality.visualReviewed).toBe(true); expect(nextVendor.calls).toHaveLength(0)
  })
  it('makes the same client operation idempotent under concurrent requests and rejects changed parameters', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    const value = { planSha256: run.planSha256, assetId: 'prop-one', prompt: 'Self-contained finer staff.', reason: '比较细节', operationId: randomUUID(), faceLimit: 100000 }
    const responses = await Promise.all([local.post(`/api/runs/${run.id}/asset-candidates`, value), local.post(`/api/runs/${run.id}/asset-candidates`, value)])
    expect(responses.map(response => response.status)).toEqual([202, 202])
    const complete = await idleRun(local, run.id); expect(complete.assetCandidates).toHaveLength(1); expect(vendor.submits()).toBe(2)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates`, value)).status).toBe(202); expect(vendor.submits()).toBe(2)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates`, { ...value, faceLimit: 60000 })).status).toBe(400)
  })
  it('retains an unknown candidate across restart/torn snapshot and never permits a replacement POST or resume', async () => {
    const vendor = upstream(); let replacementMode = false
    const fetchImpl: typeof fetch = (request, init) => replacementMode && /\/generation\/(?:text|image)-to-model$/.test(String(request)) ? Promise.reject(new Error('lost response with private ' + credentials.tripo.apiKey)) : vendor.fetchImpl(request, init)
    const local = await start(fetchImpl), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    replacementMode = true; const requested = await candidateRequest(local, run), stopped = await idleRun(local, run.id), candidate = stopped.assetCandidates[0]
    expect(stopped.status).toBe('preview_ready'); expect(candidate.status).toBe('unknown'); expect(candidate.errors.at(-1).code).toBe('UNKNOWN_SUBMISSION')
    expect((await fetch(local.base + run.packageUrl)).status).toBe(200)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates`, { ...requested.value, operationId: randomUUID() })).status).toBe(400)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/resume`, {})).status).toBe(400)
    await local.app.close()
    const stateFile = path.join(local.directory, 'data/runs', run.id, 'state.json'), snapshot = JSON.parse(await readFile(stateFile, 'utf8'))
    delete snapshot.assetCandidates; delete snapshot.originalAssets; await writeFile(stateFile, JSON.stringify(snapshot))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory), recovered = await restored.get(`/api/runs/${run.id}`)
    expect(recovered.assetCandidates[0]).toMatchObject({ id: candidate.id, status: 'unknown', active: false }); expect(nextVendor.calls).toHaveLength(0)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    expect((await restored.post(`/api/runs/${run.id}/asset-candidates`, { ...requested.value, operationId: randomUUID() })).status).toBe(400)
    expect(nextVendor.submits()).toBe(0)
  })
  it('resumes only polling a known candidate after transient failure, without replanning, another paid POST, or TTS', async () => {
    const vendor = upstream(); let replacementMode = false
    const fetchImpl: typeof fetch = (request, init) => replacementMode && String(request).includes('/tasks/') ? Promise.reject(new Error('temporary poll')) : vendor.fetchImpl(request, init)
    const local = await start(fetchImpl, undefined, fixtureNarration), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    replacementMode = true; await candidateRequest(local, run); const stopped = await idleRun(local, run.id), candidate = stopped.assetCandidates[0]
    expect(candidate).toMatchObject({ status: 'task_known', active: false }); expect(candidate.errors.at(-1).code).toBe('UPSTREAM_FAILED'); expect(vendor.submits()).toBe(2)
    await local.app.close()
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    await restored.post(`/api/runs/${run.id}/credentials`, credentials)
    expect((await restored.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/resume`, {})).status).toBe(202)
    const complete = await idleRun(restored, run.id); expect(complete.assetCandidates[0]).toMatchObject({ status: 'ready', active: false }); expect(complete.assetCandidates[0].previewUrl).toBeTruthy()
    expect(nextVendor.submits()).toBe(0); expect(nextVendor.calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(0)
    expect(complete.narration.tracks[0].sha256).toBe(run.narration.tracks[0].sha256)
  })
  it('honors adjustable cumulative stop boundaries, counts rejected/selected candidates once, and never purchases credits', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), original = await generated(local), run = await idleRun(local, original.id)
    await candidateRequest(local, run); let state = await idleRun(local, run.id)
    expect(state.assetCandidates[0].errors.at(-1).code).toBe('BUDGET_REJECTED'); expect(vendor.submits()).toBe(1)
    expect((await local.post(`/api/runs/${run.id}/budget`, { maxAssets: 1, maxCredits: 5000 })).status).toBe(200)
    expect((await local.post(`/api/runs/${run.id}/asset-candidates/${state.assetCandidates[0].id}/resume`, {})).status).toBe(202)
    state = await idleRun(local, run.id); expect(state.assetCandidates[0].status).toBe('ready'); expect(state.creditsReservedOrConsumed).toBe(100)
    expect((await local.post(`/api/runs/${run.id}/budget`, { maxAssets: 1, maxCredits: 99 })).status).toBe(400)
    expect((await local.post(`/api/runs/${run.id}/budget`, { maxAssets: 1, maxCredits: 100 })).status).toBe(200)
    await candidateRequest(local, state); const stopped = await idleRun(local, run.id)
    expect(stopped.assetCandidates[1].errors.at(-1).code).toBe('BUDGET_REJECTED'); expect(vendor.submits()).toBe(2)
    expect(vendor.calls.every(call => !/purchase|payment|recharge/.test(call.url))).toBe(true)
    const auditFiles = await readdir(path.join(local.directory, 'data/runs', run.id)); expect(auditFiles.filter(file => file.startsWith('budget-update-'))).toHaveLength(2)
  })
  it('keeps failed candidate bytes private, rejects invalid or tampered replacements, and retains the old public package', async () => {
    const vendor = upstream(); let replacementMode = false
    const bad = mutateGlb(await fixturePromise, doc => { delete doc.materials[0].normalTexture })
    const fetchImpl: typeof fetch = (request, init) => replacementMode && String(request).startsWith('https://asset.example.invalid/') ? Promise.resolve(new Response(bad)) : vendor.fetchImpl(request, init)
    const local = await start(fetchImpl), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    replacementMode = true; await candidateRequest(local, run); const stopped = await idleRun(local, run.id), candidate = stopped.assetCandidates[0]
    expect(candidate.status).toBe('failed'); expect(candidate.errors.at(-1).code).toBe('INVALID_GLB'); expect(candidate.previewUrl).toBeUndefined()
    expect((await local.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/select`, { candidateSha256: createHash('sha256').update(bad).digest('hex') })).status).toBe(400)
    const rejected = await readdir(path.join(local.directory, 'data/runs', run.id, 'raw/rejected')); expect(rejected).toHaveLength(1)
    expect((await fetch(local.base + `/runs/${run.id}/raw/rejected/${rejected[0]}`)).status).toBe(404)
    replacementMode = false; await candidateRequest(local, run); const ready = await idleRun(local, run.id), next = ready.assetCandidates[1]
    await writeFile(path.join(local.directory, 'data/runs', run.id, `raw/${next.id}.glb`), Buffer.from('tampered'))
    expect((await local.post(`/api/runs/${run.id}/asset-candidates/${next.id}/select`, { candidateSha256: next.sha256 })).status).toBe(400)
    expect((await local.get(`/runs/${run.id}/asset-manifest.json`)).assets[0].sha256).toBe(run.assets[0].sha256)
  })
  it('keeps image candidate prompts as display intent, freezes original-image provenance and uses new geometry/texture seeds', async () => {
    const vendor = upstream({ plan: artifactPlan }), local = await start(vendor.fetchImpl), original = await generated(local, { ...artifactInput, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    await candidateRequest(local, run, { seed: 456, faceLimit: 100000 }); const complete = await idleRun(local, run.id), candidate = complete.assetCandidates[0]
    expect(candidate).toMatchObject({ status: 'ready', promptApplied: false, generationMode: 'image-to-model', seed: 456 })
    const request: any = vendor.calls.filter(call => call.url.endsWith('/generation/image-to-model'))[1].body
    expect(request).toMatchObject({ input: 'file_fixture-private-upload-token', model_seed: 456, texture_seed: 456, face_limit: 100000, enable_image_autofix: false }); expect(request.prompt).toBeUndefined()
    expect(candidate.inputImageSha256).toBe(run.assets[0].inputImageSha256); expect(vendor.textSubmits()).toBe(0)
    const disk = await diskText(local.directory); expect(disk).not.toContain('file_fixture-private-upload-token'); expect(disk).toContain('fileTokenSha256')
  })
  it('rejects a changed candidate-intent fingerprint on restart without contacting the provider', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    await candidateRequest(local, run); const ready = await idleRun(local, run.id), candidate = ready.assetCandidates[0]; await local.app.close()
    const file = path.join(local.directory, 'data/runs', run.id, `asset-${candidate.id}-intent.json`), intent = JSON.parse(await readFile(file, 'utf8'))
    intent.definitionSha256 = '0'.repeat(64); await writeFile(file, JSON.stringify(intent))
    const nextVendor = upstream(), restored = await start(nextVendor.fetchImpl, local.directory)
    expect((await fetch(restored.base + `/api/runs/${run.id}`)).status).toBe(404); expect(nextVendor.calls).toHaveLength(0)
  })
  it('leaves the original package and asset choice usable when replacement assembly fails its narration validation', async () => {
    const vendor = upstream(), local = await start(vendor.fetchImpl, undefined, fixtureNarration), original = await generated(local, { ...input, budget: { maxAssets: 1, maxCredits: 5000 } }), run = await idleRun(local, original.id)
    await candidateRequest(local, run); const ready = await idleRun(local, run.id), candidate = ready.assetCandidates[0]
    await writeFile(path.join(local.directory, 'data/runs', run.id, 'narration/cue-one.wav'), Buffer.from('bad audio'))
    const response = await local.post(`/api/runs/${run.id}/asset-candidates/${candidate.id}/select`, { candidateSha256: candidate.sha256 })
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('VOICE_FAILED')
    const current = await local.get(`/api/runs/${run.id}`); expect(current.status).toBe('preview_ready'); expect(current.assets[0].selectedCandidateId).toBeUndefined()
    expect((await fetch(local.base + run.packageUrl)).status).toBe(200)
    const oldAudio = Buffer.from(await (await fetch(local.base + `/runs/${run.id}/narration/cue-one.wav`)).arrayBuffer()); expect(oldAudio.equals(fixtureWave())).toBe(true)
  })
})
