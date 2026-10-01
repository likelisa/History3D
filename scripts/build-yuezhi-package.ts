import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGlbBounds } from '../contracts/src/glb.ts'
import type { CollectionAsset, CollectionPlan, FileDigest, HandoffManifest } from '../contracts/src/handoff-types.ts'
import type { Claim, SceneFile, SceneObject, StoryFile, SourcesFile, Vec3 } from '../contracts/src/types.ts'
import { boundary, sources, STORY_ID, REVISION } from '../viewer/src/yuezhi/content.ts'
import { bookScenes } from '../viewer/src/yuezhi/book-content.ts'
import { perspectives, scenePerspectives, captivityPerspectives } from '../viewer/src/yuezhi/perspectives.ts'
import { assertAssetDigest, buildYuezhiPackage, normalizeYuezhiGlb, sha256 } from '../processing/src/yuezhi-package.ts'
import type { AssetSourceEvidence, YuezhiScenePlan } from '../processing/src/yuezhi-package.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
type FigureRecord = { id: string; file: string; sha256: string; bytes: number; source: string; taskId?: string; rawSha256?: string; creditsConsumed?: number; conversion?: { blenderVersion?: string }; historicalStatus?: string }
type XiongnuRecord = FigureRecord & { requestDigest: string; model: string; promptSha256: string; sourceIds: string[]; generationRecord: NonNullable<AssetSourceEvidence['generationRecord']> & { rawBytes: number } }
type Refinement = { upstreamFile: string; upstreamSha256: string; upstreamBytes: number; [key: string]: unknown }
type EnvironmentRecord = { sha256: string; bytes: number; blenderVersion: string; file?: string; refinement?: Refinement }
type SetRecord = { id: string; file: string; sha256: string; bytes: number; tool: string; status: string; refinement?: Refinement }
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const optionalJson = async <T>(file: string): Promise<T | null> => json<T>(file).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })

/** Imported downloads become an independently validated A-layer collection, never a copied B package. */
export async function createYuezhiDelivery(repoRoot: string, delivery: string): Promise<void> {
  const writeJson = async (name: string, value: unknown) => {
    await mkdir(path.dirname(path.join(delivery, name)), { recursive: true })
    await writeFile(path.join(delivery, name), JSON.stringify(value, null, 2) + '\n')
  }
  const figures = await json<{ assets: FigureRecord[]; accountEvidence?: unknown }>(path.join(repoRoot, 'viewer/public/yuezhi/figures/manifest.json'))
  const xiongnu = await json<XiongnuRecord>(path.join(repoRoot, 'viewer/public/yuezhi/figures/xiongnu-manifest.json'))
  // The exported collection is the durable input when the private runtime cache is absent.
  // Read it before updating delivery, which may be this same snapshot directory.
  const xiongnuRaw = await readFile(path.join(repoRoot, '.processing-data/xiongnu-tripo/xiongnu-raw.glb')).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return readFile(path.join(repoRoot, 'collector/deliveries', STORY_ID, 'assets/raw/asset-xiongnu.glb'))
  })
  assertAssetDigest(xiongnuRaw, { sha256: xiongnu.rawSha256!, bytes: xiongnu.generationRecord.rawBytes }, 'xiongnu raw')
  const figureRecords = [...figures.assets, xiongnu]
  const research = await readFile(path.join(repoRoot, 'docs/historical/xiongnu-character-reconstruction.md'), 'utf8')
  const appearanceSources: SourcesFile['sources'] = ['xiongnu-belt-met', 'xiongnu-cap-yaloman', 'xiongnu-robe-noinula', 'xiongnu-boots-noinula'].map((id, index) => {
    const line = research.split(/\r?\n/).find(text => text.startsWith(`| X0${index + 1}：`))
    const match = line?.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/)
    if (!line || !match) throw new Error('XIONGNU_RESEARCH_SOURCE_MISSING: ' + id)
    const columns = line.split('|').map(value => value.trim())
    return { id, title: match[1], type: index === 0 ? 'museum' : 'paper', locator: { url: match[2], localPath: null }, citation: match[1], location: columns[2], excerpt: columns[3], rights: '本轮仅引用研究与馆藏链接，未下载或复用第三方图像；形貌服装为跨材料/跨期推定。', accessedAt: '2026-10-01' }
  })
  const originalEnvironment = await json<EnvironmentRecord>(path.join(repoRoot, 'viewer/public/yuezhi/environment-manifest.json'))
  const refinedEnvironment = await optionalJson<EnvironmentRecord>(path.join(repoRoot, 'viewer/public/yuezhi/environment-refined-manifest.json'))
  const environment = refinedEnvironment ?? originalEnvironment
  const originalSets = await json<{ assets: SetRecord[] }>(path.join(repoRoot, 'viewer/public/yuezhi/sets/manifest.json'))
  const refinedSets = await optionalJson<{ assets: SetRecord[] }>(path.join(repoRoot, 'viewer/public/yuezhi/sets/refined-manifest.json'))
  const sets = refinedSets ?? originalSets
  if (refinedEnvironment) {
    const parent = refinedEnvironment.refinement
    if (!parent || parent.upstreamFile !== 'environment.glb' || parent.upstreamSha256 !== originalEnvironment.sha256 || parent.upstreamBytes !== originalEnvironment.bytes) throw new Error('ENVIRONMENT_REFINEMENT_LINEAGE_MISMATCH')
    assertAssetDigest(await readFile(path.join(repoRoot, 'viewer/public/yuezhi/environment.glb')), originalEnvironment, 'environment upstream')
  }
  if (refinedSets) for (const set of refinedSets.assets) {
    const parent = originalSets.assets.find(item => item.id === set.id)
    if (!parent || set.refinement?.upstreamSha256 !== parent.sha256 || set.refinement.upstreamBytes !== parent.bytes || set.refinement.upstreamFile !== parent.file) throw new Error('SET_REFINEMENT_LINEAGE_MISMATCH: ' + set.id)
    assertAssetDigest(await readFile(path.join(repoRoot, 'viewer/public/yuezhi/sets', parent.file)), parent, 'set upstream ' + set.id)
  }
  const horse = await json<{ provider: string; taskId: string; status: string; creditsConsumed: number; outputSha256: string; bytes: number; output: string; rights: string; historicalStatus: string }>(path.join(repoRoot, 'records/yuezhi-book/mural-horse-generation.json'))
  if (horse.status !== 'success' || horse.output !== 'viewer/public/yuezhi/murals/mural-horse.glb') throw new Error('HORSE_GENERATION_RECORD_INVALID')
  const specs: Array<{ id: string; assetId: string; source: string; label: string; position: Vec3; rotation: number; targetHeightM: number | null }> = [
    { id: 'environment', assetId: 'asset-environment', source: environment.file ?? 'environment.glb', label: '河谷与牧地环境示意', position: [0, 0, 0], rotation: 0, targetHeightM: null },
    { id: 'envoy', assetId: 'asset-envoy', source: 'figures/envoy.glb', label: '张骞角色示意', position: [-3, 0, 4], rotation: Math.PI - 0.6, targetHeightM: null },
    { id: 'companion', assetId: 'asset-envoy', source: 'figures/envoy.glb', label: '同行者角色示意', position: [-4.6, 0, 5], rotation: Math.PI - 0.6, targetHeightM: null },
    { id: 'representative', assetId: 'asset-representative', source: 'figures/yuezhi.glb', label: '月氏一侧角色示意（身份未指定）', position: [4.8, 0, -3.5], rotation: -0.6, targetHeightM: null },
    { id: 'local', assetId: 'asset-representative', source: 'figures/yuezhi.glb', label: '生活人物示意', position: [-7, 0, -7], rotation: 0.9, targetHeightM: null },
    { id: 'staff', assetId: 'asset-staff', source: 'figures/han-staff.glb', label: '汉节持有记载／杆状外形示意', position: [-2.65, 0, 4], rotation: 0, targetHeightM: null },
    { id: 'mural-horse', assetId: 'asset-mural-horse', source: 'murals/mural-horse.glb', label: '壁画启发的马匹示意', position: [-5.7, 0, 4.4], rotation: 0.7, targetHeightM: 1.6 },
    { id: 'xiongnu', assetId: 'asset-xiongnu', source: 'figures/xiongnu.glb', label: '匈奴人物 · 交叉史料推定（仅羁留前情）', position: [1.6, 0, -.5], rotation: -1.1, targetHeightM: null },
    ...['meeting', 'market'].map(id => ({ id, assetId: 'asset-' + id, source: 'sets/' + (sets.assets.find(item => item.id === id)?.file ?? id + '.glb'), label: (id === 'meeting' ? '接见' : '市场') + '布景示意', position: [0, 0, 0] as Vec3, rotation: 0, targetHeightM: null })),
  ]
  const claims: Claim[] = sources.map(source => ({ id: 'claim-' + source.id, subjectId: STORY_ID, property: 'narrative', statement: source.note, value: source.excerpt, unit: null, valueStatus: 'known', evidenceType: 'documented', sourceIds: [source.id], note: '古籍数字文本摘录；现代对白为据史料改编，仍待史料负责人最终审核。' }))
  const assets: SceneFile['assets'] = []
  const collectionAssets: CollectionAsset[] = []
  const evidence: AssetSourceEvidence[] = []
  const objects: SceneObject[] = []
  const transforms: YuezhiScenePlan['assetTransforms'] = []
  for (const spec of specs) {
    const sourceBytes = await readFile(path.join(repoRoot, 'viewer/public/yuezhi', spec.source))
    const original = figureRecords.find(item => 'figures/' + item.file === spec.source)
    const set = sets.assets.find(item => 'sets/' + item.file === spec.source)
    const recorded = original ?? set ?? (spec.id === 'environment' ? environment : spec.id === 'mural-horse' ? { sha256: horse.outputSha256, bytes: horse.bytes } : null)
    if (!recorded) throw new Error('SOURCE_MANIFEST_MISSING: ' + spec.source)
    assertAssetDigest(sourceBytes, recorded, spec.source)
    const normalized = normalizeYuezhiGlb(sourceBytes, spec.targetHeightM)
    const dimensions = normalized.dimensions
    const position = spec.id === 'environment' ? normalized.offset : spec.position
    if (!assets.some(asset => asset.id === spec.assetId)) {
      const isHorse = spec.id === 'mural-horse'
      const taskId = original?.taskId ?? (isHorse ? horse.taskId : null)
      const provider = original?.source ?? (isHorse ? horse.provider : 'Blender authored illustrative geometry')
      const rights = taskId ? 'Tripo账户条款下生成的示意资产；公开使用许可待确认' : spec.id === 'environment' ? '原创Blender地形与Poly Haven CC0材质/植被，实际来源见source-evidence.json' : '项目原创Blender示意资产；形制与布局不指认历史现场'
      const assetPath = 'assets/' + spec.assetId + '.glb'
      const inputPath = 'assets/input/' + spec.assetId + '.glb'
      await mkdir(path.dirname(path.join(delivery, inputPath)), { recursive: true })
      await writeFile(path.join(delivery, inputPath), sourceBytes)
      assets.push({ id: spec.assetId, path: assetPath, dimensionsM: dimensions, format: 'glb', rights })
      transforms.push({ assetId: spec.assetId, targetHeightM: spec.targetHeightM })
      const inputBounds = readGlbBounds(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer)!
      collectionAssets.push({ assetId: spec.assetId, assetRevision: 1, path: inputPath, sha256: recorded.sha256, label: spec.label, briefId: 'brief-' + spec.id, sourceIds: spec.id === 'xiongnu' ? xiongnu.sourceIds : [], claimIds: [spec.id + '-dimensions', spec.id + '-appearance'], rights, role: taskId ? 'received-generated-illustrative-asset' : 'received-Blender-illustrative-asset', intendedUse: spec.id === 'xiongnu' ? '只在captivity羁留前情context采用，月氏接见/大夏市场均隐藏' : '与同版故事整合到可打开的3D场景；主绘本仍保持原壁画与对白', knownIssues: ['外形和尺寸为制作设定，未通过最终史料/视觉/公开权利审核', ...(isHorse ? ['输入马匹尚为归一化生成尺寸，B层按示意高度1.6米作统一缩放'] : [])], generation: taskId ? { provider, taskId, promptPath: spec.id === 'xiongnu' ? 'evidence/xiongnu-manifest.json' : isHorse ? 'evidence/mural-horse-generation.json' : 'evidence/generation-script.py' } : null, inputUnits: isHorse ? null : 'm', upAxis: 'Y', forwardAxis: original?.conversion ? '+Z' : null, pivot: null, dimensionsM: isHorse ? null : inputBounds.dimensions, scaleStatus: isHorse ? 'unknown' : 'known' })
      evidence.push({ assetId: spec.assetId, path: inputPath, sourcePath: 'viewer/public/yuezhi/' + spec.source, sourceRecordPath: original ? 'evidence/figure-manifest.json' : set ? 'evidence/set-manifest.json' : isHorse ? 'evidence/mural-horse-generation.json' : 'evidence/environment-manifest.json', sha256: recorded.sha256, bytes: recorded.bytes, provider, taskId, creditsConsumed: original?.creditsConsumed ?? (isHorse ? horse.creditsConsumed : 0), rawSha256: original?.rawSha256 ?? null, generationEvidence: taskId ? 'saved_task_metadata_and_delivered_hash' : 'procedural_manifest_and_delivered_hash', sourceConversion: original?.conversion ?? set?.refinement ?? (spec.id === 'environment' ? environment.refinement : null) ?? null, tool: original?.conversion?.blenderVersion ?? set?.tool ?? (spec.id === 'environment' ? environment.blenderVersion : null), rights, historicalStatus: original?.historicalStatus ?? set?.status ?? (isHorse ? horse.historicalStatus : 'illustrative environment, not historical reconstruction') })
      if (spec.id === 'xiongnu') {
        const rawPath = 'assets/raw/asset-xiongnu.glb'; await mkdir(path.dirname(path.join(delivery, rawPath)), { recursive: true }); await writeFile(path.join(delivery, rawPath), xiongnuRaw)
        Object.assign(evidence[evidence.length - 1], { sourceRecordPath: 'evidence/xiongnu-manifest.json', rawPath, rawBytes: xiongnuRaw.length, requestDigest: xiongnu.requestDigest, model: xiongnu.model, promptSha256: xiongnu.promptSha256, generationRecord: xiongnu.generationRecord, appearanceSourceIds: xiongnu.sourceIds })
      }
    }
    const isSet = spec.source.startsWith('sets/')
    const values: Array<[Claim['property'], Claim['value'], Claim['unit']]> = [['dimensions', dimensions, 'm'], ['appearance', spec.id === 'mural-horse' ? '初唐壁画启发的艺术转译，不是西汉马具复原' : '中性制作示意，非历史复原', null]]
    if (!isSet) values.push(['layout', '米制位置 ' + position.join(', ') + '；具体站位为示意', null], ['count', 1, 'count'])
    for (const [property, value, unit] of values) claims.push({ id: spec.id + '-' + property, subjectId: 'brief-' + spec.id, property, statement: spec.label + '：' + property + '为场景制作设定', value, unit, valueStatus: 'known', evidenceType: 'illustrative', sourceIds: [], note: '外形、尺寸、人物数量和具体站位未经史料确认；角色是暂用资产。' })
    if (spec.id === 'xiongnu') Object.assign(claims.find(claim => claim.id === 'xiongnu-appearance')!, { evidenceType: 'inferred', sourceIds: xiongnu.sourceIds, statement: '匈奴匿名人物外观依据同期腰牌、相近时期帽与袍裤靴材料交叉推定', value: '贴头软帽、交叠袍、裤与低筒毡靴、简化腰牌；姓名面容颜色和看守身份为创作补全', note: '服装近时期考古材料不能等同于前2世纪羁留现场的确定实服；详见 references/historical/xiongnu-character-reconstruction.md。只在独立captivity前情采用。' })
    if (!isSet) objects.push({ id: 'obj-' + spec.id, briefId: 'brief-' + spec.id, label: spec.label, render: { type: 'asset', assetId: spec.assetId }, position, rotation: [0, spec.rotation, 0], scale: [1, 1, 1], dimensionsM: dimensions, evidence: { dimensions: [spec.id + '-dimensions'], appearance: [spec.id + '-appearance'], placement: [spec.id + '-layout'], quantity: [spec.id + '-count'] } })
  }
  // The collection contract supports three world hotspots; all four book pages remain in book.json.
  const hotspots = [bookScenes[0]!, bookScenes[1]!, bookScenes[3]!].map(section => ({ id: section.id, title: section.title, body: section.note, claimIds: [...new Set([...section.lines.flatMap(line => line.sourceIds), ...(section.noteSourceIds ?? [])])].map(id => 'claim-' + id) }))
  const story: StoryFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, title: '张骞使月氏：抵达了，目标却不同', status: 'draft', historicalScope: { period: '西汉武帝时，张骞首次出使月氏期间', place: '大月氏及大夏，具体会面地点不详', scopeNote: boundary }, experienceQuestion: '为什么共同的旧敌，没有促成汉廷期待的联合约定？', claims, objectBriefs: specs.map(brief => ({ id: 'brief-' + brief.id, label: brief.label, purpose: brief.label, claimIds: claims.filter(claim => claim.subjectId === 'brief-' + brief.id).map(claim => claim.id), referenceSourceIds: [] })), hotspots, routeOverview: { kind: 'schematic', imagePath: 'references/sequence.svg' } }
  const sourceFile: SourcesFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, sources: sources.map(source => ({ id: source.id, title: source.title, type: 'book', locator: { url: source.url, localPath: null }, citation: source.location + '，维基文库数字文本', location: source.location, excerpt: source.excerpt, rights: '古籍数字转录页面标示CC BY-SA；保留出处，正式发布仍待权利与底本复核', accessedAt: '2026-10-01' })) }
  sourceFile.sources.push(...appearanceSources)
  story.objectBriefs.find(brief => brief.id === 'brief-xiongnu')!.referenceSourceIds = xiongnu.sourceIds
  const scene: SceneFile = { schemaVersion: '0.1.0', storyId: STORY_ID, contentRevision: REVISION, sceneRevision: REVISION, storyPath: 'story.json', sourcesPath: 'sources.json', units: 'm', upAxis: 'Y', handedness: 'right', ground: { type: 'plane', y: 0 }, assets, objects, hotspotBindings: hotspots.map(hotspot => ({ hotspotId: hotspot.id, anchor: { type: 'world', position: [-3, 1.7, 4] } })), cameras: { firstPerson: { spawnFeet: [-8, 0, 10], eyeHeightM: 1.7, yawRad: -0.65, pitchRad: 0, moveSpeedMps: 2.8, radiusM: 0.3 }, overview: { position: [2, 12, 20], target: [0, 0, 0], up: [0, 1, 0] } }, walkableBounds: { min: [-11, -10], max: [12, 12] }, blockers: objects.filter(object => !['obj-environment', 'obj-staff'].includes(object.id)).map(object => ({ id: object.id + '-body', min: [object.position[0] - 0.35, object.position[2] - 0.35], max: [object.position[0] + 0.35, object.position[2] + 0.35] })) }
  const plan: CollectionPlan = { requiredBriefIds: collectionAssets.map(asset => asset.briefId), optionalBriefIds: ['brief-companion', 'brief-local'], focusBriefId: 'brief-envoy', relations: [], beats: bookScenes.map(section => ({ id: section.id, description: section.title, briefIds: collectionAssets.map(asset => asset.briefId) })), constraints: [{ id: 'preserve-book', severity: 'must', statement: '保留原壁画、四页对白和阅读进度；3D组合场景只在弹窗打开', sourceIds: [], illustrative: true }, { id: 'historical-boundary', severity: 'must', statement: boundary, sourceIds: sources.map(source => source.id), illustrative: true }], unknowns: ['伙伴原有两个人物的请求、账户收据与raw文件不在交接包，旧三项资产只能核对保存的任务元数据和GLB；本轮新匈奴人物另保存真实请求、成功记录和raw文件', '旧任务请求提示不能由当前生成脚本反推为已验证发送内容；新匈奴人物实际请求须核对独立generation记录', '史料、视觉与公开发布权利尚未最终审核'] }
  await writeJson('story.json', story); await writeJson('sources.json', sourceFile); await writeJson('plan.json', plan)
  await writeJson('scene-plan.json', { storyId: STORY_ID, contentRevision: REVISION, scene, assetTransforms: transforms })
  await writeJson('assets/asset-manifest.json', { assets: collectionAssets })
  await writeJson('book.json', { formatVersion: '1.0.0', contentRevision: REVISION, storyId: STORY_ID, scenes: bookScenes, dialogueStatus: 'modern adaptation grounded in cited historical passages; not verbatim recorded speech', historicalBoundary: boundary })
  await writeJson('narrative.json', { contentRevision: REVISION, storyId: STORY_ID, scenes: bookScenes, boundary })
  await writeJson('perspectives.json', { formatVersion: '1.0.0', storyId: STORY_ID, contentRevision: REVISION, scope: '3d-scene-modal-only', perspectives, scenes: scenePerspectives, contexts: [captivityPerspectives] })
  await mkdir(path.join(delivery, 'references'), { recursive: true })
  await writeFile(path.join(delivery, 'references/sequence.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 180"><rect width="900" height="180" fill="#ece4d4"/><text x="40" y="55" font-size="24" fill="#463e30">大宛 → 康居 → 大月氏 → 大夏</text><text x="40" y="108" font-size="18" fill="#645a48">史书记述的先后顺序；非地理地图，不表示实际方位与距离。</text></svg>')
  await writeFile(path.join(delivery, 'plan.md'), '# 张骞使月氏采集交付\n\n采用伙伴保留的故事、史料与已下载Tripo/Blender成品，保留壁画、四页骨架、既有对白与结局；按用户要求在原对白区追加选择提问。旧三项Tripo成品与本轮新匈奴人物共四项任务，按源manifest逐字节核对后进入B层组合场景；不得重复调用付费生成。新匈奴人物仅用于独立羁留前情，并保留实际请求、成功记录、raw文件与服装研究来源。此包是本地草稿交付，不代表史料、权利或用户视觉审核已通过。旧人物generation-script仅是当前配方证据，不是独立验证的provider请求。\n')
  const copies = [
    ['viewer/public/yuezhi/figures/xiongnu-manifest.json', 'evidence/xiongnu-manifest.json'], ['records/yuezhi-book/xiongnu-generation.json', 'evidence/xiongnu-generation.json'], ['scripts/generate-xiongnu-tripo.mjs', 'evidence/generate-xiongnu.mjs'], ['scripts/normalize-xiongnu-tripo.py', 'evidence/normalize-xiongnu.py'], ['docs/historical/xiongnu-character-reconstruction.md', 'references/historical/xiongnu-character-reconstruction.md'],
    ['viewer/public/yuezhi/figures/manifest.json', 'evidence/figure-manifest.json'], ['viewer/public/yuezhi/' + (refinedEnvironment ? 'environment-refined-manifest.json' : 'environment-manifest.json'), 'evidence/environment-manifest.json'], ['viewer/public/yuezhi/sets/' + (refinedSets ? 'refined-manifest.json' : 'manifest.json'), 'evidence/set-manifest.json'], ['records/yuezhi-book/mural-horse-generation.json', 'evidence/mural-horse-generation.json'],
    ['viewer/src/yuezhi/content.ts', 'evidence/content.ts'], ['viewer/src/yuezhi/book-content.ts', 'evidence/book-content.ts'], ['viewer/src/yuezhi/perspectives.ts', 'evidence/perspectives.ts'], ['scripts/generate-yuezhi-tripo.py', 'evidence/generation-script.py'], ['scripts/normalize-yuezhi-tripo.py', 'evidence/normalize-figures.py'], ['scripts/build-yuezhi-environment.py', 'evidence/build-environment.py'], ['scripts/build-yuezhi-story-sets.py', 'evidence/build-sets.py'],
  ]
  if (refinedEnvironment || refinedSets) copies.push(['scripts/refine-yuezhi-environment.py', 'evidence/refine-environment.py'], ['viewer/public/yuezhi/environment-manifest.json', 'evidence/upstream-environment-manifest.json'], ['viewer/public/yuezhi/sets/manifest.json', 'evidence/upstream-set-manifest.json'])
  const sourceModules: FileDigest[] = []
  for (const [source, target] of copies) {
    await mkdir(path.dirname(path.join(delivery, target)), { recursive: true })
    await copyFile(path.join(repoRoot, source), path.join(delivery, target))
    const bytes = await readFile(path.join(delivery, target))
    sourceModules.push({ path: target, sha256: sha256(bytes), bytes: bytes.length })
  }
  await writeJson('source-evidence.json', { storyId: STORY_ID, contentRevision: REVISION, assets: evidence, sourceModules, environment, accountEvidence: figures.accountEvidence ?? null, limitations: plan.unknowns })
  const listed = ['story.json', 'sources.json', 'plan.json', 'plan.md', 'scene-plan.json', 'assets/asset-manifest.json', 'book.json', 'narrative.json', 'perspectives.json', 'source-evidence.json', 'references/sequence.svg', ...collectionAssets.map(asset => asset.path), ...evidence.filter(asset => asset.rawPath).map(asset => asset.rawPath!), ...copies.map(([, target]) => target)]
  const files: FileDigest[] = await Promise.all(listed.sort().map(async file => { const bytes = await readFile(path.join(delivery, file)); return { path: file, sha256: sha256(bytes), bytes: bytes.length } }))
  const snapshotHash = sha256(JSON.stringify(files))
  const handoff: HandoffManifest = { handoffVersion: '1.0.0', kind: 'collection', submissionId: 'collection-' + STORY_ID + '-' + snapshotHash.slice(0, 16), storyId: STORY_ID, sourceContentRevision: REVISION, createdAt: '2026-10-01T00:00:00.000Z', producer: 'teammate-download-import; scripts/build-yuezhi-package.ts', files }
  await writeJson('handoff.json', handoff)
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const delivery = path.join(root, 'collector/deliveries', STORY_ID)
  const output = path.join(root, 'packages', STORY_ID)
  await createYuezhiDelivery(root, delivery)
  const receipt = await buildYuezhiPackage(delivery, output, root)
  console.log('Prepared ' + STORY_ID + ' from ' + receipt.submissionId + ': ' + receipt.assets + ' assets, ' + receipt.objects + ' objects; candidate needs_review.')
}
