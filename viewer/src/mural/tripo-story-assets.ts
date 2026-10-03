export type StoryTripoAsset = {
  id: 'zhangqian' | 'ganfu' | 'qiong-bamboo'
  path: string
  bytes: number
  sha256: string
  rawSha256: string
  taskId: string
  heightMeters: number
  frontAxis: '+Z'
}

/** Accept calibrated files only when they still point to the real provider task. */
export function verifiedStoryTripoAssets(normalized: unknown, generated: unknown): StoryTripoAsset[] {
  const derived = normalized as { experimentId?: string; assets?: StoryTripoAsset[] }
  const raw = generated as { experimentId?: string; assets?: { id: string; status: string; sha256: string; taskId: string }[] }
  if (derived?.experimentId !== 'tripo-story-r9' || raw?.experimentId !== 'tripo-story-r9' ||
      !Array.isArray(derived.assets) || !Array.isArray(raw.assets)) throw new Error('Tripo故事资产来源清单无效')
  const heights = { zhangqian: 1.75, ganfu: 1.69, 'qiong-bamboo': 1.55 } as const
  if (derived.assets.length !== 3 || new Set(derived.assets.map(asset => asset.id)).size !== 3) throw new Error('Tripo故事资产清单不完整')
  for (const asset of derived.assets) {
    const source = raw.assets.find(record => record.id === asset.id)
    if (!Object.hasOwn(heights, asset.id) || asset.path !== `/mural-assets/tripo-story-r9/${asset.id}.glb` ||
        asset.heightMeters !== heights[asset.id] || asset.frontAxis !== '+Z' ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        source?.status !== 'downloaded' || source.sha256 !== asset.rawSha256 || source.taskId !== asset.taskId) {
      throw new Error('Tripo故事资产与真实生成记录不匹配：' + asset.id)
    }
  }
  return derived.assets
}
