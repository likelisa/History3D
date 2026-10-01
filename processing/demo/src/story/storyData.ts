import type { Vec3 } from '../demo/cases'

export type StorySource = {
  id: string
  title: string
  url: string
  excerpt: string
}
export type StoryStep = {
  id: string
  title: string
  eyebrow: string
  text: string
  sourceIds: string[]
  position: Vec3
}
export type StoryPackage = {
  sources: StorySource[]
  steps: StoryStep[]
  storyId: string
}

export async function loadStory(signal: AbortSignal): Promise<StoryPackage> {
  const base = '/story/zhangqian-return/'
  const [entities, scene, sources] = await Promise.all(
    ['entities', 'scene', 'sources'].map(async (name) => {
      const response = await fetch(`${base}${name}.json`, { signal })
      if (!response.ok)
        throw new Error(`${name}.json 加载失败（${response.status}）`)
      return response.json()
    }),
  )
  if (
    entities.story_id !== scene.story_id ||
    scene.story_id !== sources.story_id ||
    !Array.isArray(scene.story_points)
  )
    throw new Error('故事交接文件不一致')
  const steps = scene.story_points.map(
    (point: {
      id: string
      entity_id: string
      text: string
      eyebrow: string
      source_ids: string[]
    }) => {
      const entity = entities.entities.find(
        (item: { id: string }) => item.id === point.entity_id,
      )
      const placement = scene.placements.find(
        (item: { entity_id: string }) => item.entity_id === point.entity_id,
      )
      if (!entity || !placement)
        throw new Error(`节点 ${point.entity_id} 缺少对象或坐标`)
      return {
        id: point.entity_id,
        title: entity.name,
        eyebrow: point.eyebrow,
        text: point.text,
        sourceIds: point.source_ids,
        position: placement.position_m as Vec3,
      }
    },
  )
  return { sources: sources.sources, steps, storyId: scene.story_id }
}
