import { describe, expect, it } from 'vitest'
import { assertBudget, estimatedPlanCredits, modelSystemPrompt, planningPolicy, parseModelPlan, validatePlan, validateRunInput } from '../agent/contracts'
import type { Plan, Source } from '../agent/contracts'

const sources: Source[] = [{ id: 'source-one', title: '提供的文物记录', url: '', excerpt: '该器物为铜制容器。口沿带有纹饰。', status: 'provided' }]
const input = {
  topic: '讲解器物身份和可见纹饰', imageDataUrl: 'data:image/png;base64,aGVsbG8=', sources: sources.map(({ status, ...source }) => source),
  model: { baseUrl: 'https://vision.example.invalid/v1', model: 'fixture', apiKey: 'fixture-model-key' }, tripo: { apiKey: 'fixture-tripo-key' }, budget: { maxAssets: 2, maxCredits: 110 },
}
const muralPlan: Plan = {
  title: '器物故事', summary: '提供记录与可见细节。',
  chapters: [{ id: 'chapter-one', title: '身份', cues: [{ id: 'cue-one', text: '该器物为铜制容器。', kind: 'documented', sourceIds: ['source-one'], evidence: [{ sourceId: 'source-one', quote: '铜制容器' }], sceneId: 'scene-one' }] }],
  assets: [{ id: 'artifact-one', label: '容器', kind: 'prop', heightM: .5, prompt: 'Textured display object.', sourceIds: ['source-one'] }],
  scenes: [{ id: 'scene-one', title: '整体观察', visualSeconds: 6, placements: [{ assetId: 'artifact-one', position: [0, 0, 0], heading: 0 }], camera: [1, 1, 3] }],
}
function artifactPlan(): Plan {
  const plan = structuredClone(muralPlan); plan.subjectType = 'artifact'; plan.primaryAssetId = 'artifact-one'; plan.assets[0].generationMode = 'image-to-model'
  return plan
}

describe('artifact subject contracts', () => {
  it('defaults omitted subject type to mural while validating metadata fields and exact limits', () => {
    expect(validateRunInput(input).subjectType).toBe('mural')
    const metadata = { name: '铜器', period: '年代待核', material: '铜', dimensions: '未实测', collection: '用户提供馆藏信息' }
    expect(validateRunInput({ ...input, subjectType: 'artifact', subjectMetadata: metadata }).subjectMetadata).toEqual(metadata)
    for (const subjectType of ['sculpture', null, ['mural']]) expect(() => validateRunInput({ ...input, subjectType })).toThrow('SUBJECT_TYPE_INVALID')
    expect(() => validateRunInput({ ...input, subjectMetadata: { description: '自由文本' } })).toThrow('UNKNOWN_FIELD')
    expect(() => validateRunInput({ ...input, subjectMetadata: { name: 'x'.repeat(201) } })).toThrow('PLAIN_TEXT_REQUIRED')
    expect(() => validateRunInput({ ...input, subjectMetadata: { name: '' } })).toThrow('PLAIN_TEXT_REQUIRED')
    expect(() => validateRunInput({ ...input, subjectMetadata: { material: 123 } })).toThrow('PLAIN_TEXT_REQUIRED')
  })
  it('accepts old mural plans and requires the artifact identity and exactly one primary image asset', () => {
    expect(parseModelPlan(JSON.stringify(muralPlan), sources).subjectType).toBe('mural')
    const valid = validatePlan(artifactPlan(), sources, 'artifact')
    expect(valid.primaryAssetId).toBe('artifact-one'); expect(valid.assets[0].generationMode).toBe('image-to-model')
    expect(() => validatePlan(muralPlan, sources, 'artifact')).toThrow('ARTIFACT_PLAN_TYPE_REQUIRED')
    const textOnly = artifactPlan(); textOnly.assets[0].generationMode = 'text-to-model'
    expect(() => validatePlan(textOnly, sources, 'artifact')).toThrow('ARTIFACT_PRIMARY_IMAGE_ASSET_REQUIRED')
    const wrongKind = artifactPlan(); wrongKind.assets[0].kind = 'human'
    expect(() => validatePlan(wrongKind, sources, 'artifact')).toThrow('ARTIFACT_PRIMARY_IMAGE_ASSET_REQUIRED')
    const missing = artifactPlan(); missing.primaryAssetId = 'missing'
    expect(() => validatePlan(missing, sources, 'artifact')).toThrow('ARTIFACT_PRIMARY_IMAGE_ASSET_REQUIRED')
    expect(() => validatePlan(artifactPlan(), sources)).toThrow('SUBJECT_TYPE_MISMATCH')
    const imageMural = structuredClone(muralPlan); imageMural.assets[0].generationMode = 'image-to-model'
    expect(() => validatePlan(imageMural, sources)).toThrow('MURAL_IMAGE_GENERATION_REJECTED')
    const two = artifactPlan(); two.assets.push({ ...two.assets[0], id: 'second' }); two.scenes[0].placements.push({ assetId: 'second', position: [1, 0, 0], heading: 0 })
    expect(() => validatePlan(two, sources, 'artifact')).toThrow('ONLY_PRIMARY_ASSET_USES_INPUT_IMAGE')
  })
  it('keeps photo detail anchors bounded, optional, and separate from older mural anchors', () => {
    const plan = artifactPlan(), cue = plan.chapters[0].cues[0]
    cue.imageRelation = 'depicted'; cue.imageAnchor = { x: .4, y: .3, label: '口沿' }; cue.focus = 'motif'
    expect(validatePlan(plan, sources, 'artifact').chapters[0].cues[0].imageAnchor).toEqual(cue.imageAnchor)
    cue.muralAnchor = { x: .1, y: .2 }
    expect(() => validatePlan(plan, sources, 'artifact')).toThrow('IMAGE_ANCHOR_CONFLICT')
    delete cue.muralAnchor; cue.imageAnchor.x = 1.1
    expect(() => validatePlan(plan, sources, 'artifact')).toThrow('NUMBER_OUT_OF_RANGE')
    cue.imageAnchor.x = .4; cue.imageRelation = 'context-only'
    expect(() => validatePlan(plan, sources, 'artifact')).toThrow('IMAGE_ANCHOR_REQUIRES_DEPICTED')
    delete cue.imageAnchor
    expect(validatePlan(plan, sources, 'artifact').chapters[0].cues[0].imageAnchor).toBeUndefined()
    ;(cue as any).focus = 'imagined-age'
    expect(() => validatePlan(plan, sources, 'artifact')).toThrow('CUE_FOCUS_INVALID')
    const old = structuredClone(muralPlan); old.chapters[0].cues[0].imageRelation = 'depicted'; old.chapters[0].cues[0].muralAnchor = { x: .2, y: .4 }
    expect(validatePlan(old, sources).chapters[0].cues[0].muralAnchor).toEqual({ x: .2, y: .4 })
  })
  it('never treats subject metadata or invented quotes as source evidence', () => {
    const plan = artifactPlan(); plan.chapters[0].cues[0].evidence[0].quote = '馆藏标签给出的年代'
    expect(() => validatePlan(plan, sources, 'artifact')).toThrow('EVIDENCE_QUOTE_NOT_IN_PROVIDED_EXCERPT')
    expect(modelSystemPrompt('artifact')).toContain('never a substitute for exact source excerpt quotes')
    expect(modelSystemPrompt('artifact')).toContain('Hidden sides, depth and damage are generated interpretations')
  })
  it('gives the artifact planner one complete example accepted by the actual artifact contract', () => {
    const prompt = modelSystemPrompt('artifact')
    const example = prompt.match(/Use this strict shape and no extra fields: (.*)\.\n/)
    expect(example).not.toBeNull()
    const parsed = parseModelPlan(example![1], [{ id: 'source-1', title: 'Example source', url: '', excerpt: 'EXACT PROVIDED QUOTE', status: 'provided' }], 'artifact')
    expect(parsed.subjectType).toBe('artifact'); expect(parsed.primaryAssetId).toBe(parsed.assets[0].id)
    expect(parsed.assets[0].generationMode).toBe('image-to-model')
    expect(prompt).not.toContain('"kind":"human"')
    expect(prompt.match(/Use this strict shape and no extra fields:/g)).toHaveLength(1)
  })
  it('sums 60 credits for the primary image model and 50 for each supporting text model', () => {
    const plan = artifactPlan()
    expect(estimatedPlanCredits(plan)).toBe(60)
    expect(() => assertBudget(plan, { maxAssets: 1, maxCredits: 50 })).toThrow('BUDGET_REJECTED')
    plan.assets.push({ ...plan.assets[0], id: 'support', generationMode: 'text-to-model' })
    expect(estimatedPlanCredits(plan)).toBe(110)
    expect(() => assertBudget(plan, { maxAssets: 2, maxCredits: 109 })).toThrow('BUDGET_REJECTED')
    expect(() => assertBudget(plan, { maxAssets: 2, maxCredits: 110 })).not.toThrow()
    expect(estimatedPlanCredits(muralPlan)).toBe(50)
  })
  it('rejects overlong spoken cues before approval and preserves only legacy inspection validation', () => {
    const plan = artifactPlan(); plan.chapters[0].cues[0].text = '文'.repeat(500)
    expect(() => parseModelPlan(JSON.stringify(plan), sources, 'artifact')).not.toThrow()
    plan.chapters[0].cues[0].text += '文'
    expect(() => parseModelPlan(JSON.stringify(plan), sources, 'artifact')).toThrow('CUE_TEXT_TOO_LONG')
    expect(validatePlan(plan, sources, 'artifact', { allowLegacyLongCues: true }).chapters[0].cues[0].text).toHaveLength(501)
    plan.chapters[0].cues[0].text = '文'.repeat(1601)
    expect(() => validatePlan(plan, sources, 'artifact', { allowLegacyLongCues: true })).toThrow('PLAIN_TEXT_REQUIRED')
    expect(modelSystemPrompt('artifact')).toContain('at most 500 characters')
  })
  it('filters frozen rule requirements by subject and preserves conditions without claiming verification', () => {
    const policy = { policyId: 'fixture-rules', schemaVersion: '1.0.0', rules: [
      { id: 'A01', stage: 'A', requirement: '共有：保留逐句证据。', appliesTo: ['mural', 'artifact'] },
      { id: 'A07', stage: 'A', requirement: '文物：未知尺寸不能填写。', appliesTo: ['artifact'] },
      { id: 'B04', stage: 'B', requirement: '仅在确有步态时校验脚底。', condition: 'only when a human walking scene exists', appliesTo: ['mural', 'artifact'] },
    ] }
    const mural = planningPolicy(policy, 'mural', 'a'.repeat(64)), artifact = planningPolicy(policy, 'artifact', 'a'.repeat(64))
    expect(mural.rules.map(rule => rule.id)).toEqual(['A01', 'B04'])
    expect(artifact.rules.map(rule => rule.id)).toEqual(['A01', 'A07', 'B04'])
    expect(mural.rules[1].condition).toBe(policy.rules[2].condition)
    const prompt = modelSystemPrompt('mural', mural)
    expect(prompt).toContain(policy.rules[0].requirement); expect(prompt).not.toContain(policy.rules[1].requirement)
    expect(prompt).toContain('requirements remain pending until independently checked')
    expect(prompt).toContain('does not authorize searches, paid calls, installation, training or tools')
    expect(() => modelSystemPrompt('mural', artifact)).toThrow('SUBJECT_TYPE_MISMATCH')
    const old = { ...policy, rules: [{ id: 'A01', stage: 'A', requirement: '旧规则未带appliesTo，仍纳入规划。' }] }
    expect(planningPolicy(old, 'mural', 'a'.repeat(64)).rules).toHaveLength(1)
    expect(planningPolicy(old, 'artifact', 'a'.repeat(64)).rules).toHaveLength(1)
    expect(() => planningPolicy({ ...policy, rules: [...policy.rules, policy.rules[0]] }, 'artifact', 'a'.repeat(64))).toThrow('DUPLICATE_ID')
    expect(() => planningPolicy(policy, 'artifact', 'wrong-hash')).toThrow('POLICY_HASH_INVALID')
  })
})
