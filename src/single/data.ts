export type Vec3 = [number, number, number]
export type Source = {
  id: string
  title: string
  url: string
  excerpt: string
  evidence: string
}
export type Beat = {
  id: string
  title: string
  text: string
  evidence: string
  sourceIds: string[]
  position: Vec3
}
export type ScenePackage = {
  storyId: string
  beats: Beat[]
  sources: Source[]
  rockAsset: string | null
  props: SceneProp[]
  performance: { duration: number; times: number[] }
}
export type SceneProp = { id: string; kind: string; position: Vec3 }

export async function loadSouthDetour(
  signal: AbortSignal,
): Promise<ScenePackage> {
  const base = '/story/south-detour/'
  const [entities, scene, sources] = await Promise.all(
    ['entities', 'scene', 'sources'].map(async (name) => {
      const response = await fetch(`${base}${name}.json`, { signal })
      if (!response.ok)
        throw new Error(`${name}.json 加载失败（${response.status}）`)
      return response.json()
    }),
  )
  if (
    !scene.story_id ||
    scene.story_id !== entities.story_id ||
    scene.story_id !== sources.story_id ||
    !Array.isArray(scene.story_points) || !Array.isArray(scene.placements)
  )
    throw new Error('场景交接文件不一致')
  const beats = scene.story_points.map(
    (point: {
      id: string
      title: string
      text: string
      evidence: string
      source_ids: string[]
      position_m: Vec3
    }) => {
      if (
        !Array.isArray(point.source_ids) ||
        point.source_ids.some(
          (id) => !sources.sources.some((source: Source) => source.id === id),
        )
      )
        throw new Error(`故事点 ${point.id} 来源缺失`)
      return {
        id: point.id,
        title: point.title,
        text: point.text,
        evidence: point.evidence,
        sourceIds: point.source_ids,
        position: point.position_m,
      }
    },
  )
  return {
    storyId: scene.story_id,
    beats,
    sources: sources.sources,
    rockAsset:
      scene.placements.find(
        (item: { entity_id: string }) =>
          item.entity_id === 'foothill_boulder_01',
      )?.candidate_asset ?? null,
    props: scene.placements.flatMap((item: { entity_id: string; position_m: Vec3 }) => {
      const entity = entities.entities.find((candidate: { id: string }) => candidate.id === item.entity_id)
      const kind = entity?.render_kind?.replace('procedural_', '')
      return ['traveler', 'pursuer', 'animal', 'cargo', 'fire', 'stone'].includes(kind)
        ? [{ id: item.entity_id, kind, position: item.position_m }] : []
    }),
    performance: {
      duration: scene.performance?.duration_s ?? 28,
      times: scene.performance?.beats?.map((item: { at_s: number }) => item.at_s) ?? [0, 9, 19],
    },
  }
}
