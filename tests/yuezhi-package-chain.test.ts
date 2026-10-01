import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createYuezhiDelivery } from '../scripts/build-yuezhi-package.ts'
import { assertAssetDigest, auditYuezhiPackage, buildYuezhiPackage, sha256 } from '../processing/src/yuezhi-package.ts'
import type { YuezhiSourceEvidence } from '../processing/src/yuezhi-package.ts'
import type { FileDigest, HandoffManifest } from '../contracts/src/handoff-types.ts'
import type { SceneFile } from '../contracts/src/types.ts'

const readJson = async <T>(root: string, file: string): Promise<T> => JSON.parse(await readFile(path.join(root, file), 'utf8')) as T
const putJson = (root: string, file: string, data: unknown) => writeFile(path.join(root, file), JSON.stringify(data, null, 2) + '\n')

describe('张骞采集 → 整合的真实资产链路', () => {
  let scratch: string
  let delivery: string
  let output: string
  beforeAll(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), 'history3d-yuezhi-chain-'))
    delivery = path.join(scratch, 'collection')
    output = path.join(scratch, 'package')
    await createYuezhiDelivery(path.resolve('.'), delivery)
    await buildYuezhiPackage(delivery, output, path.resolve('.'))
  }, 30000)
  afterAll(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }) })
  const duplicate = async (name: string, source = output) => {
    const target = path.join(scratch, name)
    await cp(source, target, { recursive: true })
    return target
  }
  async function resealArtifact(root: string, file: string): Promise<void> {
    const bytes = await readFile(path.join(root, file))
    const digest = { path: file, sha256: sha256(bytes), bytes: bytes.length }
    const release = await readJson<{ files: FileDigest[] }>(root, 'release.json')
    release.files = release.files.map(item => item.path === file ? digest : item)
    await putJson(root, 'release.json', release)
    const releaseBytes = await readFile(path.join(root, 'release.json'))
    const build = await readJson<{ files: FileDigest[] }>(root, 'build-manifest.json')
    build.files = build.files.map(item => item.path === file ? digest : item.path === 'release.json' ? { path: 'release.json', sha256: sha256(releaseBytes), bytes: releaseBytes.length } : item)
    await putJson(root, 'build-manifest.json', build)
  }
  async function resealCollection(root: string): Promise<void> {
    const handoff = await readJson<HandoffManifest>(root, 'handoff.json')
    handoff.files = await Promise.all(handoff.files.map(async item => { const bytes = await readFile(path.join(root, item.path)); return { path: item.path, sha256: sha256(bytes), bytes: bytes.length } }))
    await putJson(root, 'handoff.json', handoff)
  }
  async function resealSourceModule(root: string, file: string): Promise<void> {
    const evidence = await readJson<YuezhiSourceEvidence>(root, 'source-evidence.json')
    const bytes = await readFile(path.join(root, file))
    evidence.sourceModules = evidence.sourceModules.map(item => item.path === file ? { path: file, sha256: sha256(bytes), bytes: bytes.length } : item)
    await putJson(root, 'source-evidence.json', evidence)
  }
  it('旧三项和本轮新匈奴共四项 Tripo 任务均进入正式场景并保留输入到输出hash，未伪造接受', async () => {
    const audit = await auditYuezhiPackage(output, delivery)
    expect(audit.ok, audit.errors.join('; ')).toBe(true)
    expect(audit.assetCount).toBe(8)
    expect(audit.tripoTaskIds.sort()).toEqual(['e87b6ae6-78a2-4630-b616-91db00681bdf', 'd5830027-1d35-4835-9be1-f8035f9f82eb', '02cabe4c-1356-4e5b-b0a3-88c10da4669b', 'b614d405-a227-4642-9fa0-0495e08a5b27'].sort())
    expect(audit.publicationReady).toBe(false)
    expect(audit.pendingReviews.length).toBeGreaterThan(0)
    const scene = await readJson<SceneFile>(output, 'scene.json')
    expect(scene.objects.find(item => item.id === 'obj-mural-horse')?.render).toEqual({ type: 'asset', assetId: 'asset-mural-horse' })
    expect(scene.assets.find(item => item.id === 'asset-mural-horse')?.dimensionsM[1]).toBeCloseTo(1.6, 6)
    expect(scene.objects.find(item => item.id === 'obj-xiongnu')?.render).toEqual({ type: 'asset', assetId: 'asset-xiongnu' })
    expect(scene.assets.find(item => item.id === 'asset-xiongnu')?.dimensionsM[1]).toBeCloseTo(1.72, 5)
  })
  it('新人物的实际请求、raw、校准版hash与跨史料外观来源均保留', async () => {
    const evidence = await readJson<YuezhiSourceEvidence>(delivery, 'source-evidence.json')
    const npc = evidence.assets.find(item => item.assetId === 'asset-xiongnu')!
    const retained = await readJson<unknown>(delivery, 'evidence/xiongnu-generation.json')
    expect(npc.generationRecord).toEqual(retained)
    expect(npc.creditsConsumed).toBe(30)
    expect(npc.requestDigest).toBe('84ef41faf7b75efe9a02f9536b5df4f3eb407d870f09aa1b335d1b03a8a40089')
    expect(sha256(JSON.stringify(npc.generationRecord!.request))).toBe(npc.requestDigest)
    expect(sha256(String(npc.generationRecord!.request.prompt))).toBe(npc.promptSha256)
    const raw = await readFile(path.join(delivery, npc.rawPath!))
    expect(sha256(raw)).toBe('39eb65f9443ae5e0242aedd2bde06c265c4394c3656f7419fce0bd94b74811e1')
    expect(raw.length).toBe(12067204)
    expect(sha256(await readFile(path.join(delivery, npc.path)))).toBe(npc.sha256)
    expect(npc.sourceConversion).toMatchObject({ blenderVersion: '4.5.14 LTS', frontAxis: 'glTF +Z; visually checked', poseCorrection: { method: 'Blender local arm deformation preserving UVs; static pose, not skeletal animation' } })
    expect(npc.appearanceSourceIds).toEqual(['xiongnu-belt-met', 'xiongnu-cap-yaloman', 'xiongnu-robe-noinula', 'xiongnu-boots-noinula'])
    const story = await readJson<{ claims: Array<{ id: string; evidenceType: string; sourceIds: string[] }> }>(output, 'story.json')
    expect(story.claims.find(item => item.id === 'xiongnu-appearance')).toMatchObject({ evidenceType: 'inferred', sourceIds: npc.appearanceSourceIds })
  })
  it('各页角色集合随现场变化，敌方只在独立羁留前情出现', async () => {
    const data = await readJson<{ scenes: Array<{ sceneId: string; available: string[]; views: Record<string, unknown> }>; contexts: Array<{ id: string; available: string[]; views: Record<string, unknown> }> }>(output, 'perspectives.json')
    expect(Object.fromEntries(data.scenes.map(scene => [scene.sceneId, scene.available]))).toEqual({ arrival: ['envoy', 'passersby', 'overview'], meeting: ['envoy', 'host', 'overview'], waiting: ['envoy', 'passersby', 'overview'], market: ['envoy', 'trader', 'passersby', 'overview'] })
    expect(data.scenes.every(scene => !('opponent' in scene.views))).toBe(true)
    expect(data.contexts).toHaveLength(1)
    expect(data.contexts[0]).toMatchObject({ id: 'captivity', available: ['envoy', 'opponent', 'overview'] })
  })
  it('交接机器没有.private/runtime缓存也能从正式raw快照原位重建，输出模型逐项一致', async () => {
    const offlineRoot = path.join(scratch, 'handoff-without-runtime')
    const offlineDelivery = path.join(offlineRoot, 'collector/deliveries/zhang-qian-yuezhi')
    // Copy only reproducible project inputs; never copy, rename or delete the real runtime cache.
    for (const directory of ['viewer/public/yuezhi', 'viewer/src/yuezhi', 'docs/historical', 'records/yuezhi-book', 'scripts'])
      await cp(path.resolve(directory), path.join(offlineRoot, directory), { recursive: true })
    await cp(delivery, offlineDelivery, { recursive: true })
    await expect(stat(path.join(offlineRoot, '.processing-data'))).rejects.toMatchObject({ code: 'ENOENT' })
    const rawBefore = sha256(await readFile(path.join(offlineDelivery, 'assets/raw/asset-xiongnu.glb')))
    await createYuezhiDelivery(offlineRoot, offlineDelivery)
    const offlineOutput = path.join(offlineRoot, 'packages/zhang-qian-yuezhi')
    await buildYuezhiPackage(offlineDelivery, offlineOutput, offlineRoot)
    expect(sha256(await readFile(path.join(offlineDelivery, 'assets/raw/asset-xiongnu.glb')))).toBe(rawBefore)
    const audit = await auditYuezhiPackage(offlineOutput, offlineDelivery)
    expect(audit.ok, audit.errors.join('; ')).toBe(true)
    const scene = await readJson<SceneFile>(output, 'scene.json')
    for (const asset of scene.assets)
      expect(sha256(await readFile(path.join(offlineOutput, asset.path)))).toBe(sha256(await readFile(path.join(output, asset.path))))
    expect(await readJson<unknown>(offlineOutput, 'book.json')).toEqual(await readJson<unknown>(output, 'book.json'))
  })
  it('在复制前拒绝不匹配的源manifest，而非仅对输出自算hash', async () => {
    const bytes = await readFile(path.join(delivery, 'assets/input/asset-envoy.glb'))
    expect(() => assertAssetDigest(bytes, { sha256: '0'.repeat(64), bytes: bytes.length }, 'envoy')).toThrow('SOURCE_ASSET_HASH_MISMATCH')
  })
  it('输入资产一字节被篡改时，processing拒绝编译', async () => {
    const input = await duplicate('tampered-input', delivery)
    const filename = path.join(input, 'assets/input/asset-envoy.glb')
    const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1
    await writeFile(filename, bytes)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-package'), path.resolve('.'))).rejects.toThrow('file digest mismatch')
  })
  it('即使重算handoff和输入hash，也须与伙伴保留的生成记录一致', async () => {
    const input = await duplicate('tampered-record', delivery)
    const filename = path.join(input, 'assets/input/asset-envoy.glb')
    const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1
    await writeFile(filename, bytes)
    const manifest = await readJson<{ assets: Array<{ assetId: string; sha256: string }> }>(input, 'assets/asset-manifest.json')
    manifest.assets.find(item => item.assetId === 'asset-envoy')!.sha256 = sha256(bytes)
    await putJson(input, 'assets/asset-manifest.json', manifest)
    const evidence = await readJson<{ assets: Array<{ assetId: string; sha256: string }> }>(input, 'source-evidence.json')
    evidence.assets.find(item => item.assetId === 'asset-envoy')!.sha256 = sha256(bytes)
    await putJson(input, 'source-evidence.json', evidence)
    await resealCollection(input)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-record'), path.resolve('.'))).rejects.toThrow('SOURCE_RECORD_MISMATCH: asset-envoy')
  })
  it('成品模型错hash时直接指出模型文件', async () => {
    const candidate = await duplicate('bad-output')
    const filename = path.join(candidate, 'assets/asset-mural-horse.glb')
    const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1
    await writeFile(filename, bytes)
    expect((await auditYuezhiPackage(candidate)).errors).toContain('ARTIFACT_HASH_MISMATCH: assets/asset-mural-horse.glb')
  })
  it('新NPC不能删掉raw证据字段后绕过真实raw校验', async () => {
    const input = await duplicate('missing-npc-raw', delivery)
    const evidence = await readJson<YuezhiSourceEvidence>(input, 'source-evidence.json')
    delete evidence.assets.find(item => item.assetId === 'asset-xiongnu')!.rawPath
    await putJson(input, 'source-evidence.json', evidence); await resealCollection(input)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-missing-raw'), path.resolve('.'))).rejects.toThrow('XIONGNU_RAW_EVIDENCE_MISSING')
  })
  it('raw一字节被篡改即使重算handoff仍会被原始rawSHA拒绝', async () => {
    const input = await duplicate('tampered-npc-raw', delivery)
    const filename = path.join(input, 'assets/raw/asset-xiongnu.glb')
    const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1
    await writeFile(filename, bytes); await resealCollection(input)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-raw'), path.resolve('.'))).rejects.toThrow('SOURCE_ASSET_HASH_MISMATCH: assets/raw/asset-xiongnu.glb')
  })
  it('改manifest和evidence中的实际请求也不能绕过独立保存generation记录', async () => {
    const input = await duplicate('fake-request', delivery)
    const evidence = await readJson<YuezhiSourceEvidence>(input, 'source-evidence.json')
    const npc = evidence.assets.find(item => item.assetId === 'asset-xiongnu')!
    npc.generationRecord!.request.face_limit = 1000
    npc.requestDigest = sha256(JSON.stringify(npc.generationRecord!.request))
    npc.generationRecord!.requestDigest = npc.requestDigest
    await putJson(input, 'source-evidence.json', evidence)
    const manifest = await readJson<Record<string, unknown>>(input, 'evidence/xiongnu-manifest.json')
    manifest.requestDigest = npc.requestDigest; manifest.generationRecord = npc.generationRecord
    await putJson(input, 'evidence/xiongnu-manifest.json', manifest)
    await resealSourceModule(input, 'evidence/xiongnu-manifest.json'); await resealCollection(input)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-request'), path.resolve('.'))).rejects.toThrow('XIONGNU_RETAINED_GENERATION_MISMATCH')
  })
  it('精修脚本换内容即使重封装也不能掩盖manifest里实际加工scriptSHA', async () => {
    const input = await duplicate('tampered-refinement', delivery)
    await writeFile(path.join(input, 'evidence/refine-environment.py'), '# unrelated script\n')
    await resealSourceModule(input, 'evidence/refine-environment.py'); await resealCollection(input)
    await expect(buildYuezhiPackage(input, path.join(scratch, 'rejected-refinement'), path.resolve('.'))).rejects.toThrow('SOURCE_REFINEMENT_SCRIPT_MISMATCH: asset-environment')
  })
  it('重新封装的provenance不能篡改本轮真实请求与转换出处', async () => {
    const candidate = await duplicate('bad-npc-provenance')
    const provenance = await readJson<{ assets: Array<{ assetId: string; requestDigest: string }> }>(candidate, 'asset-provenance.json')
    provenance.assets.find(item => item.assetId === 'asset-xiongnu')!.requestDigest = '0'.repeat(64)
    await putJson(candidate, 'asset-provenance.json', provenance); await resealArtifact(candidate, 'asset-provenance.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('ASSET_PROVENANCE_MISMATCH: asset-xiongnu')
  })
  it('重封装也不能掩盖book/story不同版', async () => {
    const candidate = await duplicate('mixed-revision')
    const book = await readJson<{ contentRevision: number }>(candidate, 'book.json'); book.contentRevision += 1
    await putJson(candidate, 'book.json', book); await resealArtifact(candidate, 'book.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('REVISION_MISMATCH: book.json')
  })
  it('旁路马弹窗不能替代正式scene实例', async () => {
    const candidate = await duplicate('missing-horse')
    const scene = await readJson<SceneFile>(candidate, 'scene.json')
    scene.objects = scene.objects.filter(item => item.id !== 'obj-mural-horse')
    await putJson(candidate, 'scene.json', scene); await resealArtifact(candidate, 'scene.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('MURAL_HORSE_NOT_IN_SCENE')
  })
  it('新匈奴NPC不能只存模型而没有scene正式实例', async () => {
    const candidate = await duplicate('missing-xiongnu')
    const scene = await readJson<SceneFile>(candidate, 'scene.json')
    scene.objects = scene.objects.filter(item => item.id !== 'obj-xiongnu')
    await putJson(candidate, 'scene.json', scene); await resealArtifact(candidate, 'scene.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('XIONGNU_NOT_IN_SCENE')
  })
  it('移除羁留前情context不能伪装为视角已齐全', async () => {
    const candidate = await duplicate('missing-captivity')
    const data = await readJson<{ contexts: unknown[] }>(candidate, 'perspectives.json'); data.contexts = []
    await putJson(candidate, 'perspectives.json', data); await resealArtifact(candidate, 'perspectives.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('CAPTIVITY_CONTEXT_MISSING')
  })
  it('给月氏接见硬加敌方视角会被动态现场校验拒绝', async () => {
    const candidate = await duplicate('enemy-in-meeting')
    const data = await readJson<{ scenes: Array<{ sceneId: string; available: string[]; views: Record<string, unknown> }> }>(candidate, 'perspectives.json')
    const meeting = data.scenes.find(scene => scene.sceneId === 'meeting')!
    meeting.available.push('opponent'); meeting.views.opponent = meeting.views.overview
    await putJson(candidate, 'perspectives.json', data); await resealArtifact(candidate, 'perspectives.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('PERSPECTIVE_AVAILABILITY_MISMATCH: meeting')
  })
  it('视角数据与同一句史料引用必须一致，不能无声失去史料链接', async () => {
    const candidate = await duplicate('bad-perspective')
    const data = await readJson<{ scenes: Array<{ views: { envoy: { lines: Array<{ sourceIds: string[] }> } } }> }>(candidate, 'perspectives.json')
    data.scenes[0].views.envoy.lines[0].sourceIds = []
    await putJson(candidate, 'perspectives.json', data); await resealArtifact(candidate, 'perspectives.json')
    expect((await auditYuezhiPackage(candidate)).errors).toContain('PERSPECTIVE_SOURCE_MISMATCH: arrival/envoy/arrival-1')
  })
  it('成品缺少build-manifest时不能声称已核对', async () => {
    const candidate = path.join(scratch, 'empty-package'); await mkdir(candidate)
    const audit = await auditYuezhiPackage(candidate)
    expect(audit.ok).toBe(false)
    expect(audit.errors[0]).toContain('build-manifest.json')
  })
})
