import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetStrategy, StrategyPolicy } from '../../../contracts/src/handoff-types.ts'

export async function loadStrategyPolicy(repoRoot: string): Promise<StrategyPolicy> {
  const policy = JSON.parse(await readFile(path.join(repoRoot, 'processing/config/strategy-policy.json'), 'utf8')) as StrategyPolicy
  if (policy.policyVersion !== '1.0.0' || !Array.isArray(policy.allowedStrategyIds) || !Array.isArray(policy.preferredOrder) || !Array.isArray(policy.autoAdoptRules) || [policy.maxPaidAttempts, policy.maxCostUsd, policy.maxAttemptsPerAsset, policy.maxReviewCycles, policy.maxWallTimeSeconds, policy.candidateCount].some((value) => !Number.isFinite(value) || value < 0) || !policy.requireAssetReview || !policy.requireWorldReview) throw new Error('STRATEGY_POLICY_INVALID')
  return policy
}

export const DEFAULT_BLENDER_PATH = '/Applications/Blender.app/Contents/MacOS/Blender'
export async function blenderAvailable(blenderPath = process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH): Promise<boolean> {
  return stat(blenderPath).then((item) => item.isFile()).catch(() => false)
}

export function listStrategies(policy: StrategyPolicy, hasTripoKey: boolean, hasBlender = false): AssetStrategy[] {
  const entries: Array<{ id: string; kind: AssetStrategy['kind']; implemented: boolean; reason?: string; limitations?: string[] }> = [
    { id: 'procedural-import', kind: 'procedural', implemented: true, limitations: ['B-authored fixture GLBs only; no provider generation'] },
    { id: 'scene-recompose', kind: 'recompose', implemented: true, limitations: ['world-plan compilation; no automatic asset adoption'] },
    { id: 'blender-refine', kind: 'blender', implemented: hasBlender, reason: 'Blender executable unavailable', limitations: ['material_tint operation only', 'animated GLBs are rejected', 'candidate requires asset review and explicit adoption'] },
    { id: 'mesh-normalize', kind: 'blender', implemented: false, reason: 'mesh normalization adapter not integrated' },
    { id: 'generate-3d', kind: 'generate', implemented: false, reason: 'Tripo adapter not connected to the new task contract' },
    { id: 'prompt-variants', kind: 'prompt-compare', implemented: false, reason: 'candidate generation and comparison adapter not integrated' },
  ]
  return entries.map((entry) => {
    const allowed = policy.allowedStrategyIds.includes(entry.id)
    const paid = entry.id === 'generate-3d' || entry.id === 'prompt-variants'
    const budgeted = !paid || (policy.maxCostUsd > 0 && policy.maxPaidAttempts > 0)
    const available = allowed && budgeted && entry.implemented && (!paid || hasTripoKey)
    const reason = !allowed ? 'disabled by strategy policy' : !budgeted ? 'paid budget is zero' : paid && !hasTripoKey ? 'TRIPO_API_KEY missing' : entry.implemented ? null : entry.reason ?? 'adapter unavailable'
    return { id: entry.id, kind: entry.kind, available, reason, limitations: entry.limitations ?? [] }
  })
}
