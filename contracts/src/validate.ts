import type { Diagnostic, DiagnosticCode } from './diagnostics.ts'
import { SUPPORTED_SCHEMA_VERSION, errorDiagnostic, warningDiagnostic } from './diagnostics.ts'
import { instancePathToField, schemaErrors } from './schemas.ts'
import { isBlocked, isInsideWalkable, sizeTolerance } from './geometry.ts'
import { readGlbBounds } from './glb.ts'
import type {
  Claim,
  SceneFile,
  SceneObject,
  SourcesFile,
  StoryFile,
  Vec2,
  Vec3,
} from './types.ts'

export const SCENE_FILE = 'scene.json'
export const STORY_FILE = 'story.json'
export const SOURCES_FILE = 'sources.json'

export interface PackageReader {
  readText(relPath: string): Promise<string | null>
  exists(relPath: string): Promise<boolean>
  readBinary(relPath: string): Promise<ArrayBuffer | null>
  listFiles?(): Promise<string[]>
}

export interface CollectionResult {
  diagnostics: Diagnostic[]
  story: StoryFile | null
  sources: SourcesFile | null
}

export interface PackageResult extends CollectionResult {
  scene: SceneFile | null
}

export interface PackageOptions {
  /** 读取并复核 GLB 包围盒。仅在能读二进制的环境（node 脚本）开启。 */
  checkGlbBounds?: boolean
}

export async function validateCollection(reader: PackageReader): Promise<CollectionResult> {
  const diagnostics: Diagnostic[] = []
  const story = await loadStory(reader, diagnostics, STORY_FILE, 'REFERENCE_MISSING')
  const sources = await loadSources(reader, diagnostics, SOURCES_FILE, 'REFERENCE_MISSING')
  await runCollectionChecks(story, sources, reader, diagnostics)
  return { diagnostics, story, sources }
}

export async function validateScenePackage(
  reader: PackageReader,
  options: PackageOptions = {},
): Promise<PackageResult> {
  const diagnostics: Diagnostic[] = []
  const scene = await loadScene(reader, diagnostics, SCENE_FILE, 'PACKAGE_FETCH_FAILED')
  const story = await loadStory(reader, diagnostics, STORY_FILE, 'REFERENCE_MISSING')
  const sources = await loadSources(reader, diagnostics, SOURCES_FILE, 'REFERENCE_MISSING')
  await runCollectionChecks(story, sources, reader, diagnostics)
  if (scene && story && sources) {
    await runSceneChecks(scene, story, sources, reader, diagnostics, options)
  }
  return { diagnostics, scene, story, sources }
}

async function readJsonFile(
  reader: PackageReader,
  relPath: string,
  diagnostics: Diagnostic[],
  missingCode: DiagnosticCode,
  label: string,
): Promise<unknown | null> {
  const text = await reader.readText(relPath)
  if (text === null) {
    diagnostics.push(
      errorDiagnostic(missingCode, relPath, '', `${label}（${relPath}）不存在或无法读取`),
    )
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    diagnostics.push(
      errorDiagnostic(missingCode, relPath, '', `${label}（${relPath}）不是合法 JSON：${reason}`),
    )
    return null
  }
}

function versionGate(raw: unknown, file: string, diagnostics: Diagnostic[]): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const version = (raw as Record<string, unknown>).schemaVersion
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    diagnostics.push(
      errorDiagnostic(
        'SCHEMA_UNSUPPORTED',
        file,
        'schemaVersion',
        `协议版本 ${String(version)} 不受支持，当前查看器只支持 ${SUPPORTED_SCHEMA_VERSION}`,
      ),
    )
    return false
  }
  return true
}

function pushSchemaErrors(
  file: string,
  raw: unknown,
  key: 'story' | 'sources' | 'scene',
  diagnostics: Diagnostic[],
): boolean {
  const errors = schemaErrors(key, raw)
  for (const item of errors) {
    const params = item.params as {
      missingProperty?: string
      additionalProperty?: string
    }
    const offender = params.missingProperty ?? params.additionalProperty
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        file,
        instancePathToField(item.instancePath, offender),
        `结构校验未通过：${item.message ?? '未知错误'}`,
      ),
    )
  }
  return errors.length === 0
}

async function loadScene(
  reader: PackageReader,
  diagnostics: Diagnostic[],
  relPath: string,
  missingCode: DiagnosticCode,
): Promise<SceneFile | null> {
  const raw = await readJsonFile(reader, relPath, diagnostics, missingCode, '场景入口文件')
  if (!raw || !versionGate(raw, relPath, diagnostics)) return null
  if (!pushSchemaErrors(relPath, raw, 'scene', diagnostics)) return null
  return raw as SceneFile
}

async function loadStory(
  reader: PackageReader,
  diagnostics: Diagnostic[],
  relPath: string,
  missingCode: DiagnosticCode,
): Promise<StoryFile | null> {
  const raw = await readJsonFile(reader, relPath, diagnostics, missingCode, '故事文件')
  if (!raw || !versionGate(raw, relPath, diagnostics)) return null
  if (!pushSchemaErrors(relPath, raw, 'story', diagnostics)) return null
  return raw as StoryFile
}

async function loadSources(
  reader: PackageReader,
  diagnostics: Diagnostic[],
  relPath: string,
  missingCode: DiagnosticCode,
): Promise<SourcesFile | null> {
  const raw = await readJsonFile(reader, relPath, diagnostics, missingCode, '来源清单')
  if (!raw || !versionGate(raw, relPath, diagnostics)) return null
  if (!pushSchemaErrors(relPath, raw, 'sources', diagnostics)) return null
  return raw as SourcesFile
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

async function runCollectionChecks(
  story: StoryFile | null,
  sources: SourcesFile | null,
  reader: PackageReader,
  diagnostics: Diagnostic[],
): Promise<void> {
  if (story && sources) {
    if (story.storyId !== sources.storyId) {
      diagnostics.push(
        errorDiagnostic(
          'REVISION_MISMATCH',
          SOURCES_FILE,
          'storyId',
          `storyId 不一致：${STORY_FILE} 为 ${story.storyId}，${SOURCES_FILE} 为 ${sources.storyId}`,
        ),
      )
    }
    if (story.contentRevision !== sources.contentRevision) {
      diagnostics.push(
        errorDiagnostic(
          'REVISION_MISMATCH',
          SOURCES_FILE,
          'contentRevision',
          `contentRevision 不一致：${STORY_FILE} 为 ${story.contentRevision}，${SOURCES_FILE} 为 ${sources.contentRevision}`,
        ),
      )
    }
  }

  if (!sources) return

  const sourceIds = new Set(sources.sources.map((item) => item.id))
  for (const id of duplicateIds(sources.sources.map((item) => item.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', SOURCES_FILE, `sources[id=${id}]`, `来源 ID 重复：${id}`),
    )
  }

  for (const [index, source] of sources.sources.entries()) {
    const field = `sources[${index}]`
    if (source.locator.localPath && !(await reader.exists(source.locator.localPath))) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SOURCES_FILE,
          `${field}.locator.localPath`,
          `来源 ${source.id} 引用的本地素材不存在：${source.locator.localPath}`,
        ),
      )
    }
  }

  if (!story) return

  if (story.storyId && sourceIds.size === 0 && story.status === 'reviewed') {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        SOURCES_FILE,
        'sources',
        'status 为 reviewed 但来源清单为空，无法支撑历史核验',
      ),
    )
  }

  if (story.status === 'reviewed' && (!story.historicalScope.period || !story.historicalScope.place)) {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        STORY_FILE,
        'historicalScope',
        'status 为 reviewed 时 historicalScope.period 与 place 都必须填写',
      ),
    )
  }

  for (const id of duplicateIds(story.claims.map((claim) => claim.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `claims[id=${id}]`, `判断 ID 重复：${id}`),
    )
  }
  for (const id of duplicateIds(story.objectBriefs.map((brief) => brief.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `objectBriefs[id=${id}]`, `对象 ID 重复：${id}`),
    )
  }
  for (const id of duplicateIds(story.hotspots.map((hotspot) => hotspot.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `hotspots[id=${id}]`, `故事点 ID 重复：${id}`),
    )
  }

  const briefIds = new Set(story.objectBriefs.map((brief) => brief.id))
  const claimById = new Map(story.claims.map((claim) => [claim.id, claim]))

  for (const [index, claim] of story.claims.entries()) {
    const field = `claims[${index}]`
    if (claim.valueStatus === 'known') {
      if (claim.value === null) {
        diagnostics.push(
          errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `${field}.value`, `判断 ${claim.id} 为 known 但没有值`),
        )
      }
      if (claim.property === 'dimensions' && claim.unit !== 'm') {
        diagnostics.push(
          errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `${field}.unit`, `判断 ${claim.id} 是尺寸判断，单位必须是 m`),
        )
      }
      if (claim.property === 'count' && claim.unit !== 'count') {
        diagnostics.push(
          errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `${field}.unit`, `判断 ${claim.id} 是数量判断，单位必须是 count`),
        )
      }
      if (claim.evidenceType === null) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            STORY_FILE,
            `${field}.evidenceType`,
            `判断 ${claim.id} 为 known 但没有证据类型`,
          ),
        )
      }
    } else {
      if (claim.value !== null) {
        diagnostics.push(
          errorDiagnostic('VALIDATION_FAILED', STORY_FILE, `${field}.value`, `判断 ${claim.id} 为 unknown 但带有值`),
        )
      }
      if (claim.evidenceType !== null) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            STORY_FILE,
            `${field}.evidenceType`,
            `判断 ${claim.id} 为 unknown 时证据类型必须为 null`,
          ),
        )
      }
    }

    if (
      (claim.evidenceType === 'documented' || claim.evidenceType === 'inferred') &&
      claim.sourceIds.length === 0
    ) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          STORY_FILE,
          `${field}.sourceIds`,
          `判断 ${claim.id} 的类型为 ${claim.evidenceType}，至少需要一条来源`,
        ),
      )
    }

    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        diagnostics.push(
          errorDiagnostic(
            'REFERENCE_MISSING',
            STORY_FILE,
            `${field}.sourceIds`,
            `判断 ${claim.id} 引用了不存在的来源：${sourceId}`,
          ),
        )
      }
    }

    if (claim.subjectId !== story.storyId && !briefIds.has(claim.subjectId)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          STORY_FILE,
          `${field}.subjectId`,
          `判断 ${claim.id} 的 subjectId 既不是 storyId 也不是已声明的对象：${claim.subjectId}`,
        ),
      )
    }
  }

  for (const [index, brief] of story.objectBriefs.entries()) {
    const field = `objectBriefs[${index}]`
    for (const claimId of brief.claimIds) {
      const claim = claimById.get(claimId)
      if (!claim) {
        diagnostics.push(
          errorDiagnostic(
            'REFERENCE_MISSING',
            STORY_FILE,
            `${field}.claimIds`,
            `对象 ${brief.id} 引用了不存在的判断：${claimId}`,
          ),
        )
        continue
      }
      if (claim.subjectId !== brief.id) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            STORY_FILE,
            `${field}.claimIds`,
            `判断 ${claimId} 的 subjectId 是 ${claim.subjectId}，不属于对象 ${brief.id}`,
          ),
        )
      }
    }
    for (const sourceId of brief.referenceSourceIds) {
      if (!sourceIds.has(sourceId)) {
        diagnostics.push(
          errorDiagnostic(
            'REFERENCE_MISSING',
            STORY_FILE,
            `${field}.referenceSourceIds`,
            `对象 ${brief.id} 引用了不存在的来源：${sourceId}`,
          ),
        )
      }
    }
  }

  for (const [index, hotspot] of story.hotspots.entries()) {
    for (const claimId of hotspot.claimIds) {
      if (!claimById.has(claimId)) {
        diagnostics.push(
          errorDiagnostic(
            'REFERENCE_MISSING',
            STORY_FILE,
            `hotspots[${index}].claimIds`,
            `故事点 ${hotspot.id} 引用了不存在的判断：${claimId}`,
          ),
        )
      }
    }
  }

  if (!(await reader.exists(story.routeOverview.imagePath))) {
    diagnostics.push(
      errorDiagnostic(
        'REFERENCE_MISSING',
        STORY_FILE,
        'routeOverview.imagePath',
        `路线示意图不存在：${story.routeOverview.imagePath}`,
      ),
    )
  }
}

async function runSceneChecks(
  scene: SceneFile,
  story: StoryFile,
  sources: SourcesFile,
  reader: PackageReader,
  diagnostics: Diagnostic[],
  options: PackageOptions,
): Promise<void> {
  if (scene.storyId !== story.storyId || scene.storyId !== sources.storyId) {
    diagnostics.push(
      errorDiagnostic(
        'REVISION_MISMATCH',
        SCENE_FILE,
        'storyId',
        `storyId 不一致：scene=${scene.storyId}，story=${story.storyId}，sources=${sources.storyId}`,
      ),
    )
  }
  if (
    scene.contentRevision !== story.contentRevision ||
    scene.contentRevision !== sources.contentRevision
  ) {
    diagnostics.push(
      errorDiagnostic(
        'REVISION_MISMATCH',
        SCENE_FILE,
        'contentRevision',
        `contentRevision 不一致：scene=${scene.contentRevision}，story=${story.contentRevision}，sources=${sources.contentRevision}`,
      ),
    )
  }

  const assetIds = new Set(scene.assets.map((asset) => asset.id))
  for (const id of duplicateIds(scene.assets.map((asset) => asset.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, `assets[id=${id}]`, `资产 ID 重复：${id}`),
    )
  }
  for (const [index, asset] of scene.assets.entries()) {
    const field = `assets[${index}]`
    if (!(await reader.exists(asset.path))) {
      diagnostics.push(
        errorDiagnostic('REFERENCE_MISSING', SCENE_FILE, `${field}.path`, `资产文件不存在：${asset.path}`),
      )
      continue
    }
    if (!options.checkGlbBounds) continue
    const binary = await reader.readBinary(asset.path)
    if (!binary) {
      diagnostics.push(
        errorDiagnostic('REFERENCE_MISSING', SCENE_FILE, `${field}.path`, `资产文件无法读取：${asset.path}`),
      )
      continue
    }
    const bounds = readGlbBounds(binary)
    if (!bounds) {
      diagnostics.push(
        errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, `${field}.path`, `资产不是可解析的 GLB：${asset.path}`),
      )
      continue
    }
    const axes: Array<'宽' | '高' | '深'> = ['宽', '高', '深']
    for (let axis = 0; axis < 3; axis += 1) {
      const declared = asset.dimensionsM[axis]
      const actual = bounds.dimensions[axis]
      if (Math.abs(declared - actual) > sizeTolerance(declared)) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            SCENE_FILE,
            `${field}.dimensionsM[${axis}]`,
            `资产 ${asset.id} 的${axes[axis]}声明为 ${declared} 米，GLB 实测为 ${actual.toFixed(3)} 米，超出容差 ${sizeTolerance(declared).toFixed(3)} 米`,
          ),
        )
      }
    }
  }

  const claimById = new Map(story.claims.map((claim) => [claim.id, claim]))
  const briefIds = new Set(story.objectBriefs.map((brief) => brief.id))
  const assetById = new Map(scene.assets.map((asset) => [asset.id, asset]))
  const objectIds = new Set(scene.objects.map((object) => object.id))

  for (const id of duplicateIds(scene.objects.map((object) => object.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, `objects[id=${id}]`, `对象实例 ID 重复：${id}`),
    )
  }

  for (const [index, object] of scene.objects.entries()) {
    const field = `objects[${index}]`
    if (!briefIds.has(object.briefId)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SCENE_FILE,
          `${field}.briefId`,
          `对象实例 ${object.id} 引用了不存在的 objectBrief：${object.briefId}`,
        ),
      )
    }
    if (object.render.type === 'asset' && !assetIds.has(object.render.assetId)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SCENE_FILE,
          `${field}.render.assetId`,
          `对象实例 ${object.id} 引用了不存在的资产：${object.render.assetId}`,
        ),
      )
    }
    if (object.render.type === 'asset') {
      const asset = assetById.get(object.render.assetId)
      if (asset && !vec3Match(object.dimensionsM, asset.dimensionsM)) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            SCENE_FILE,
            `${field}.dimensionsM`,
            `对象实例 ${object.id} 的尺寸与资产 ${asset.id} 的声明尺寸不一致`,
          ),
        )
      }
    }

    const bindings: Array<{ key: keyof SceneObject['evidence']; property: Claim['property']; allowStory: boolean }> = [
      { key: 'dimensions', property: 'dimensions', allowStory: false },
      { key: 'appearance', property: 'appearance', allowStory: false },
      { key: 'placement', property: 'layout', allowStory: true },
      { key: 'quantity', property: 'count', allowStory: false },
    ]

    let hasKnownDimensions = false
    for (const binding of bindings) {
      for (const claimId of object.evidence[binding.key]) {
        const claim = claimById.get(claimId)
        if (!claim) {
          diagnostics.push(
            errorDiagnostic(
              'REFERENCE_MISSING',
              SCENE_FILE,
              `${field}.evidence.${binding.key}`,
              `对象实例 ${object.id} 引用了不存在的判断：${claimId}`,
            ),
          )
          continue
        }
        if (claim.property !== binding.property) {
          diagnostics.push(
            errorDiagnostic(
              'VALIDATION_FAILED',
              SCENE_FILE,
              `${field}.evidence.${binding.key}`,
              `判断 ${claimId} 的类型是 ${claim.property}，不能绑定到 ${binding.key}`,
            ),
          )
          continue
        }
        const subjectAllowed = binding.allowStory
          ? claim.subjectId === object.briefId || claim.subjectId === story.storyId
          : claim.subjectId === object.briefId
        if (!subjectAllowed) {
          diagnostics.push(
            errorDiagnostic(
              'VALIDATION_FAILED',
              SCENE_FILE,
              `${field}.evidence.${binding.key}`,
              `判断 ${claimId} 的 subjectId 是 ${claim.subjectId}，不能用于对象实例 ${object.id}`,
            ),
          )
        }
        if (binding.key === 'dimensions' && claim.valueStatus === 'known' && Array.isArray(claim.value)) {
          hasKnownDimensions = true
          if (!vec3Match(object.dimensionsM, claim.value as Vec3)) {
            diagnostics.push(
              errorDiagnostic(
                'VALIDATION_FAILED',
                SCENE_FILE,
                `${field}.dimensionsM`,
                `对象实例 ${object.id} 的尺寸与判断 ${claimId} 的值不一致`,
              ),
            )
          }
        }
      }
    }

    if (!hasKnownDimensions) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          SCENE_FILE,
          `${field}.evidence.dimensions`,
          `对象实例 ${object.id} 没有绑定任何已知或演示尺寸判断，实现尺寸无法追溯`,
        ),
      )
    }

    if (Math.abs(object.position[1] - scene.ground.y) > 0.01) {
      diagnostics.push(
        warningDiagnostic(
          'VALIDATION_FAILED',
          SCENE_FILE,
          `${field}.position`,
          `对象实例 ${object.id} 的底部原点不在接地高度（${scene.ground.y}）上，请确认这是有意为之`,
        ),
      )
    }
  }

  for (const brief of story.objectBriefs) {
    const instances = scene.objects.filter((object) => object.briefId === brief.id)
    const countClaims = brief.claimIds
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is Claim => Boolean(claim) && claim?.property === 'count')
    const knownCounts = countClaims
      .filter((claim) => claim.valueStatus === 'known' && typeof claim.value === 'number')
      .map((claim) => claim.value as number)
    if (knownCounts.length === 0) continue
    if (new Set(knownCounts).size > 1) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          STORY_FILE,
          `objectBriefs[id=${brief.id}].claimIds`,
          `对象 ${brief.id} 绑定了多个互相冲突的数量判断：${knownCounts.join(' / ')}`,
        ),
      )
      continue
    }
    if (instances.length !== knownCounts[0]) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          SCENE_FILE,
          `objects[briefId=${brief.id}]`,
          `对象 ${brief.id} 有 ${instances.length} 个实例，与数量判断 ${knownCounts[0]} 不一致`,
        ),
      )
    }
  }

  const bounds = scene.walkableBounds
  if (bounds.min[0] >= bounds.max[0] || bounds.min[1] >= bounds.max[1]) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, 'walkableBounds', 'walkableBounds 的 min 必须小于 max'),
    )
  }
  for (const id of duplicateIds(scene.blockers.map((blocker) => blocker.id))) {
    diagnostics.push(
      errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, `blockers[id=${id}]`, `阻挡区 ID 重复：${id}`),
    )
  }
  for (const [index, blocker] of scene.blockers.entries()) {
    if (blocker.min[0] >= blocker.max[0] || blocker.min[1] >= blocker.max[1]) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          SCENE_FILE,
          `blockers[${index}]`,
          `阻挡区 ${blocker.id} 的 min 必须小于 max`,
        ),
      )
    }
  }

  const spawn = scene.cameras.firstPerson
  const spawnXZ: Vec2 = [spawn.spawnFeet[0], spawn.spawnFeet[2]]
  if (!isInsideWalkable(spawnXZ, bounds, spawn.radiusM)) {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        SCENE_FILE,
        'cameras.firstPerson.spawnFeet',
        `出生点 ${JSON.stringify(spawnXZ)} 不在可行走范围内部（需按 radiusM=${spawn.radiusM} 内缩）`,
      ),
    )
  }
  if (isBlocked(spawnXZ[0], spawnXZ[1], scene.blockers, spawn.radiusM)) {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        SCENE_FILE,
        'cameras.firstPerson.spawnFeet',
        '出生点落在阻挡区内（已按 radiusM 扩展）',
      ),
    )
  }
  if (Math.abs(spawn.spawnFeet[1] - scene.ground.y) > 0.01) {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        SCENE_FILE,
        'cameras.firstPerson.spawnFeet',
        `出生点脚下高度 ${spawn.spawnFeet[1]} 与地面高度 ${scene.ground.y} 不一致`,
      ),
    )
  }

  const hotspotIds = new Set(story.hotspots.map((hotspot) => hotspot.id))
  const boundHotspots = new Set<string>()
  for (const [index, binding] of scene.hotspotBindings.entries()) {
    const field = `hotspotBindings[${index}]`
    if (!hotspotIds.has(binding.hotspotId)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SCENE_FILE,
          `${field}.hotspotId`,
          `故事点绑定引用了不存在的 hotspot：${binding.hotspotId}`,
        ),
      )
    }
    if (boundHotspots.has(binding.hotspotId)) {
      diagnostics.push(
        errorDiagnostic(
          'VALIDATION_FAILED',
          SCENE_FILE,
          `${field}.hotspotId`,
          `故事点 ${binding.hotspotId} 存在多条绑定`,
        ),
      )
    }
    boundHotspots.add(binding.hotspotId)
    if (binding.anchor.type === 'object' && !objectIds.has(binding.anchor.objectId)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SCENE_FILE,
          `${field}.anchor.objectId`,
          `故事点 ${binding.hotspotId} 锚定到不存在的对象实例：${binding.anchor.objectId}`,
        ),
      )
    }
  }
  for (const hotspot of story.hotspots) {
    if (!boundHotspots.has(hotspot.id)) {
      diagnostics.push(
        errorDiagnostic(
          'REFERENCE_MISSING',
          SCENE_FILE,
          'hotspotBindings',
          `故事点 ${hotspot.id} 没有对应的世界锚点绑定`,
        ),
      )
    }
  }

  const overview = scene.cameras.overview
  const viewVector: Vec3 = [
    overview.target[0] - overview.position[0],
    overview.target[1] - overview.position[1],
    overview.target[2] - overview.position[2],
  ]
  const viewLength = Math.hypot(...viewVector)
  if (viewLength < 1e-6) {
    diagnostics.push(
      errorDiagnostic(
        'VALIDATION_FAILED',
        SCENE_FILE,
        'cameras.overview',
        '俯视相机的 position 与 target 重合，无法确定视线方向',
      ),
    )
  } else {
    const upLength = Math.hypot(...overview.up)
    if (upLength < 1e-6) {
      diagnostics.push(
        errorDiagnostic('VALIDATION_FAILED', SCENE_FILE, 'cameras.overview.up', 'up 不能为零向量'),
      )
    } else {
      const dot =
        (viewVector[0] * overview.up[0] +
          viewVector[1] * overview.up[1] +
          viewVector[2] * overview.up[2]) /
        (viewLength * upLength)
      if (Math.abs(dot) > 0.999) {
        diagnostics.push(
          errorDiagnostic(
            'VALIDATION_FAILED',
            SCENE_FILE,
            'cameras.overview.up',
            'up 与视线方向平行，垂直下视时应使用 [0,0,-1]',
          ),
        )
      }
    }
  }
}

function vec3Match(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) <= sizeTolerance(a[0]) &&
    Math.abs(a[1] - b[1]) <= sizeTolerance(a[1]) &&
    Math.abs(a[2] - b[2]) <= sizeTolerance(a[2])
  )
}
