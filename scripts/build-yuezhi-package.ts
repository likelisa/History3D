import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGlbBounds } from '../contracts/src/glb.ts'
import type { Claim, SceneFile, SceneObject, StoryFile, SourcesFile, Vec3 } from '../contracts/src/types.ts'
import { boundary, chapters, clues, sources, STORY_ID, REVISION } from '../viewer/src/yuezhi/content.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.join(root, 'packages', STORY_ID)
await mkdir(path.join(output, 'assets'), { recursive: true })
await mkdir(path.join(output, 'references'), { recursive: true })
const writeJson = (name: string, value: unknown) => writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`)
const figureManifest = JSON.parse(await readFile(path.join(root, 'viewer/public/yuezhi/figures/manifest.json'), 'utf8')) as { assets: Array<{ id: string; source: string; taskId?: string; rawSha256?: string; creditsConsumed?: number; conversion?: unknown }>; accountEvidence?: unknown }
const claims: Claim[] = sources.map((source) => ({ id: `claim-${source.id}`, subjectId: STORY_ID, property: 'narrative', statement: source.note, value: source.excerpt, unit: null, valueStatus: 'known', evidenceType: 'documented', sourceIds: [source.id], note: '古籍数字文本摘录；现代讲述是限义释读，仍待史料负责人最终审核。' }))

function centeredGlb(bytes: Buffer) {
  const bounds = readGlbBounds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  if (!bounds) throw new Error('GLB_BOUNDS_UNAVAILABLE')
  const offset: Vec3 = [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2]
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
  const active = json.scenes[json.scene ?? 0]
  const nodeIndex = json.nodes.length
  json.nodes.push({ name: 'bottom-center-meter-origin', children: active.nodes, translation: offset.map((v) => -v) })
  active.nodes = [nodeIndex]
  const raw = Buffer.from(JSON.stringify(json))
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20)
  raw.copy(padded)
  const tail = bytes.subarray(20 + jsonLength)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  return { bytes: Buffer.concat([header, padded, tail]), bounds, offset }
}

const specs: Array<{ id: string; source: string; position: Vec3; label: string; rotation: number }> = [
  { id: 'environment', source: 'environment.glb', position: [0, 0, 0], label: '河谷与牧地环境示意', rotation: 0 },
  { id: 'envoy', source: 'figures/envoy.glb', position: [-3, 0, 4], label: '张骞角色示意', rotation: Math.PI - 0.6 },
  { id: 'companion', source: 'figures/envoy.glb', position: [-4.6, 0, 5], label: '同行者角色示意', rotation: Math.PI - 0.6 },
  { id: 'representative', source: 'figures/yuezhi.glb', position: [4.8, 0, -3.5], label: '月氏一侧角色示意（身份未指定）', rotation: -0.6 },
  { id: 'local', source: 'figures/yuezhi.glb', position: [-7, 0, -7], label: '生活人物示意', rotation: 0.9 },
  { id: 'staff', source: 'figures/han-staff.glb', position: [-2.65, 0, 4], label: '汉节持有记载／杆状外形示意', rotation: 0 },
]
const assets: SceneFile['assets'] = []
const objects: SceneObject[] = []
const provenance: unknown[] = []
for (const spec of specs) {
  const assetId = spec.source === 'figures/envoy.glb' ? 'asset-envoy' : spec.source === 'figures/yuezhi.glb' ? 'asset-representative' : `asset-${spec.id}`
  const sourceBytes = await readFile(path.join(root, 'viewer/public/yuezhi', spec.source))
  const centered = centeredGlb(sourceBytes)
  const assetPath = `assets/${assetId}.glb`
  if (!assets.some((asset) => asset.id === assetId)) {
    await writeFile(path.join(output, assetPath), centered.bytes)
    const original = figureManifest.assets.find((item) => `figures/${item.id}.glb` === spec.source)
    assets.push({ id: assetId, path: assetPath, dimensionsM: centered.bounds.dimensions, format: 'glb', rights: spec.id === 'environment' ? '项目原创Blender示意地形，实际材质来源见asset-provenance.json' : original?.taskId ? 'Tripo账户条款下生成的角色；服饰与面貌仅为制作示意，发布许可待核' : '项目原创Blender杆状道具示意；不是历史外形复原' })
    provenance.push({ assetId, path: assetPath, bytes: centered.bytes.length, sha256: createHash('sha256').update(centered.bytes).digest('hex'), inputSha256: createHash('sha256').update(sourceBytes).digest('hex'), rawSha256: original?.rawSha256 ?? null, provider: original?.source ?? 'Blender procedural environment', taskId: original?.taskId ?? null, creditsConsumed: original?.creditsConsumed ?? 0, sourceConversion: original?.conversion ?? null, conversion: { operation: 'translate bottom-center to origin; geometry preserved', offset: centered.offset }, status: 'illustrative', source: spec.source })
  }
  const dimensions = centered.bounds.dimensions
  const position = spec.id === 'environment' ? centered.offset : spec.position
  const evidence = { dimensions: [`${spec.id}-dimensions`], appearance: [`${spec.id}-appearance`], placement: [`${spec.id}-layout`], quantity: [`${spec.id}-count`] }
  for (const [property, value, unit] of [['dimensions', dimensions, 'm'], ['appearance', '中性制作示意，非历史复原', null], ['layout', `米制位置 ${position.join(', ')}；具体站位为示意`, null], ['count', 1, 'count']] as const) {
    claims.push({ id: `${spec.id}-${property}`, subjectId: `brief-${spec.id}`, property, statement: `${spec.label}：${property}为场景制作设定`, value: value as Claim['value'], unit, valueStatus: 'known', evidenceType: 'illustrative', sourceIds: [], note: '外形、尺寸、人物数量和具体站位未经史料确认；角色是暂用资产。' })
  }
  objects.push({ id: `obj-${spec.id}`, briefId: `brief-${spec.id}`, label: spec.label, render: { type: 'asset', assetId }, position, rotation: [0, spec.rotation, 0], scale: [1, 1, 1], dimensionsM: dimensions, evidence })
}
const hotspots = clues.map((clue) => ({ id: clue.id, title: clue.title, body: clue.text, claimIds: clue.sourceIds.map((id) => `claim-${id}`) }))
const story: StoryFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, title: '张骞使月氏：抵达了，目标却不同', status: 'draft', historicalScope: { period: '西汉武帝时，张骞首次出使月氏期间', place: '大月氏及大夏，具体会面地点不详', scopeNote: boundary }, experienceQuestion: '为什么共同的旧敌，没有促成汉廷期待的联合约定？', claims, objectBriefs: specs.map((spec) => ({ id: `brief-${spec.id}`, label: spec.label, purpose: spec.label, claimIds: claims.filter((claim) => claim.subjectId === `brief-${spec.id}`).map((claim) => claim.id), referenceSourceIds: [] })), hotspots, routeOverview: { kind: 'schematic', imagePath: 'references/sequence.svg' } }
const sourceFile: SourcesFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, sources: sources.map((source) => ({ id: source.id, title: source.title, type: 'book', locator: { url: source.url, localPath: null }, citation: source.location + '，维基文库数字文本', location: source.location, excerpt: source.excerpt, rights: '古籍数字转录页面标示CC BY-SA；保留出处，正式发布仍待权利与底本复核', accessedAt: '2026-10-01' })) }
const scene: SceneFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, sceneRevision: 1, storyPath: 'story.json', sourcesPath: 'sources.json', units: 'm', upAxis: 'Y', handedness: 'right', ground: { type: 'plane', y: 0 }, assets, objects, hotspotBindings: hotspots.map((hotspot) => ({ hotspotId: hotspot.id, anchor: { type: 'world', position: clues.find((clue) => clue.id === hotspot.id)?.position ?? [-3, 1.7, 4] } })), cameras: { firstPerson: { spawnFeet: [-8, 0, 10], eyeHeightM: 1.7, yawRad: -0.65, pitchRad: 0, moveSpeedMps: 2.8, radiusM: 0.3 }, overview: { position: [2, 12, 20], target: [0, 0, 0], up: [0, 1, 0] } }, walkableBounds: { min: [-11, -10], max: [12, 12] }, blockers: objects.filter((object) => !['obj-environment', 'obj-staff'].includes(object.id)).map((object) => ({ id: `${object.id}-body`, min: [object.position[0] - 0.35, object.position[2] - 0.35], max: [object.position[0] + 0.35, object.position[2] + 0.35] })) }
await writeJson('story.json', story); await writeJson('sources.json', sourceFile); await writeJson('scene.json', scene)
await writeJson('asset-provenance.json', { status: 'draft', realTripoAssetsReceived: figureManifest.assets.filter((item) => item.taskId).length >= 2, accountEvidence: figureManifest.accountEvidence ?? null, assets: provenance, environment: JSON.parse(await readFile(path.join(root, 'viewer/public/yuezhi/environment-manifest.json'), 'utf8')) })
await writeJson('narrative.json', { contentRevision: REVISION, storyId: STORY_ID, chapters, clues, boundary })
await copyFile(path.join(root, 'viewer/public/yuezhi/figures/manifest.json'), path.join(output, 'figure-manifest.json'))
await writeFile(path.join(output, 'references/sequence.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 180"><rect width="900" height="180" fill="#ece4d4"/><text x="40" y="55" font-size="24" fill="#463e30">大宛 → 康居 → 大月氏 → 大夏</text><text x="40" y="108" font-size="18" fill="#645a48">史书记述的先后顺序；非地理地图，不表示实际方位与距离。</text></svg>')
console.log(`Prepared ${STORY_ID}: ${assets.length} assets, ${objects.length} objects; historical status draft.`)
