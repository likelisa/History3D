export type Vec3 = [number, number, number]
export type Entity = {
  id: string
  name: string
  render_kind: string
  evidence: string
  source_ids: string[]
  dimensions_m: Vec3
  dimensions_basis: string
}
export type Placement = {
  entity_id: string
  position_m: Vec3
  rotation_rad: Vec3
  asset: string | null
  candidate_asset: string | null
}
export type SceneData = {
  schema_version: number
  story_id: string
  units: string
  up_axis: string
  origin: string
  spawn: { position_m: Vec3; look_at_m: Vec3 }
  placements: Placement[]
  story_points: { id: string; entity_id: string; text: string }[]
}
export type Package = {
  entities: Entity[]
  scene: SceneData
  sources: { id: string; title: string; excerpt: string }[]
  base: string
}
export type AssetState = {
  status: 'loading' | 'ready' | 'fallback'
  message: string
}
export type AssetStates = Record<string, AssetState>
export const cases = [
  {
    id: 'complete',
    number: '01',
    name: '渡口 · 正常交接',
    tag: '程序几何',
    description: '从资料、对象清单到可点击场景，走一遍完整的样例交接。',
    expected: '5 个对象可见，来源可追溯；尺寸为演示设定。',
    checks: [
      '切换到人尺度视角，看清桥与参照人',
      '点击木桥，找到尺寸和来源说明',
      '导出场景 JSON，确认包含 5 个摆放对象',
    ],
  },
  {
    id: 'missing-source',
    number: '02',
    name: '资料缺了一条',
    tag: '故障注入',
    description: '木桥被标为史料记载，但引用的来源不存在。',
    expected: '采集器显示待补资料，木桥的来源检查提示异常。',
    checks: [
      '采集器显示“待补资料”',
      '点击木桥，看到缺失的来源 ID',
      '检查处理层仍标注演示尺寸，未伪造史实',
    ],
  },
  {
    id: 'missing-model',
    number: '03',
    name: '模型加载失败',
    tag: '故障注入',
    description: '场景引用一个不存在的 GLB，检查现场是否还能继续看。',
    expected: '木桥显示橙色占位，其他物件正常；可重试并查看错误。',
    checks: [
      '木桥显示橙色占位，其他 4 个对象正常',
      '点击木桥，确认模型失败提示',
      '点击重新加载，失败仍有明确反馈',
    ],
  },
  {
    id: 'tripo',
    number: '04',
    name: '真实 Tripo 候选',
    tag: '已有资产',
    description:
      '查看已生成的模型，旋转检查轮廓、背面与贴图。不会新建生成任务。',
    expected: '有本机模型时显示真实候选；没有文件时可选择本地 GLB。',
    checks: [
      '看到真实 GLB 并旋转检查背面',
      '查看“仅显示归一化”的尺寸说明',
      '确认模型仍是候选，未自动标为历史复原',
    ],
  },
] as const
export type CaseId = (typeof cases)[number]['id']
export async function loadPackage(
  id: CaseId,
  signal: AbortSignal,
): Promise<Package> {
  const base = `/cases/${id}/`
  const docs = await Promise.all(
    ['entities', 'scene', 'sources'].map(async (name) => {
      const response = await fetch(`${base}${name}.json`, { signal })
      if (!response.ok)
        throw new Error(`${name}.json 加载失败（${response.status}）`)
      return response.json()
    }),
  )
  if (
    !Array.isArray(docs[0].entities) ||
    !Array.isArray(docs[1].placements) ||
    !Array.isArray(docs[2].sources)
  )
    throw new Error('案例包格式不正确')
  return {
    entities: docs[0].entities,
    scene: docs[1],
    sources: docs[2].sources,
    base,
  }
}
export function sourceGaps(pack: Package) {
  return pack.entities.flatMap((e) =>
    e.source_ids
      .filter((id) => !pack.sources.some((s) => s.id === id))
      .map((id) => ({ entity: e.id, source: id })),
  )
}
