import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlbBounds } from '../../../contracts/src/glb.ts'
import { sizeTolerance } from '../../../contracts/src/geometry.ts'
import { DEFAULT_BLENDER_PATH } from './registry.ts'
import type { AssetTaskRecord } from './tasks.ts'

const digest = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, file) }

export async function executeBlenderRefine(taskId: string, dataDir: string, repoRoot: string, blenderPath = process.env.BLENDER_BIN ?? DEFAULT_BLENDER_PATH): Promise<AssetTaskRecord> {
  if (!/^task-[a-f0-9]{20}$/.test(taskId)) throw new Error('ASSET_TASK_ID_INVALID')
  const taskDir = path.join(dataDir, 'asset-tasks', taskId)
  const taskFile = path.join(taskDir, 'task.json')
  const task = await json<AssetTaskRecord>(taskFile)
  if (task.status === 'candidate_ready') {
    if (!task.result || digest(await readFile(path.join(taskDir, task.result.outputPath))) !== task.result.outputSha256) throw new Error('ASSET_TASK_ARTIFACT_MISMATCH')
    return task
  }
  if (task.strategyId !== 'blender-refine' || !['queued', 'running', 'failed'].includes(task.status) || task.attemptCount >= task.policy.maxAttemptsPerAsset) throw new Error('ASSET_TASK_NOT_EXECUTABLE')
  const releaseDir = path.join(dataDir, 'releases', task.storyId, task.releaseId)
  const lineage = await json<{ assets: Array<{ assetId: string; sha256: string; path: string }> }>(path.join(releaseDir, 'asset-lineage.json'))
  const asset = lineage.assets.find((item) => item.assetId === task.assetId)
  if (!asset || asset.sha256 !== task.request.expectedBaseSha256) throw new Error('ASSET_REVISION_CONFLICT')
  const inputPath = path.join(releaseDir, asset.path)
  const input = await readFile(inputPath)
  if (digest(input) !== asset.sha256) throw new Error('ASSET_INPUT_HASH_MISMATCH')
  const before = readGlbBounds(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer)
  if (!before) throw new Error('ASSET_INVALID')
  task.status = 'running'
  task.attemptCount += 1
  task.reason = 'Blender material-only refinement in progress'
  await putJson(taskFile, task)
  const temporary = path.join(taskDir, `candidate-${randomUUID()}.glb`)
  try {
    const tool = await runBlender(blenderPath, path.join(repoRoot, 'processing/tools/refine_material.py'), inputPath, temporary, String(task.request.parameters.color), task.policy.maxWallTimeSeconds)
    const output = await readFile(temporary)
    const after = readGlbBounds(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer)
    if (!after || after.dimensions.some((value, axis) => Math.abs(value - before.dimensions[axis]) > sizeTolerance(before.dimensions[axis])) || Math.abs(after.min[1] - before.min[1]) > 0.05) throw new Error('REFINE_GEOMETRY_CHANGED')
    const outputSha256 = digest(output)
    if (outputSha256 === asset.sha256) throw new Error('REFINE_NO_CHANGE')
    const relative = `candidate/${task.assetId}-${outputSha256.slice(0, 12)}.glb`
    await mkdir(path.join(taskDir, 'candidate'), { recursive: true })
    await rename(temporary, path.join(taskDir, relative))
    task.status = 'candidate_ready'
    task.reason = 'Candidate GLB saved; asset review and formal viewer comparison still required'
    task.artifactRefs = [relative]
    task.result = { inputSha256: asset.sha256, outputSha256, outputPath: relative, beforeDimensionsM: before.dimensions, afterDimensionsM: after.dimensions, tool: tool.tool, toolVersion: tool.version, materialsEdited: tool.materialsEdited, costUsd: 0, adopted: false, reviewStatus: 'pending' }
    await putJson(taskFile, task)
    return task
  } catch (error) {
    task.status = 'failed'
    task.reason = error instanceof Error ? error.message : String(error)
    await putJson(taskFile, task)
    throw error
  } finally { await rm(temporary, { force: true }) }
}

async function runBlender(blenderPath: string, script: string, input: string, output: string, color: string, timeoutSeconds: number): Promise<{ tool: string; version: string; materialsEdited: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(blenderPath, ['-b', '-t', '2', '--python', script, '--', input, output, color], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => { child.kill('SIGTERM') }, timeoutSeconds * 1000)
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk.slice(0, Math.max(0, 20_000 - stdout.length)) })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk.slice(0, Math.max(0, 2_000 - stderr.length)) })
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) { reject(new Error(`BLENDER_REFINE_FAILED: ${stderr.trim() || `exit ${code}`}`)); return }
      const line = stdout.split('\n').find((item) => item.startsWith('{"tool"'))
      try {
        const parsed = JSON.parse(line ?? '') as { tool: string; version: string; materialsEdited: number }
        if (parsed.tool !== 'Blender' || !parsed.version || !Number.isSafeInteger(parsed.materialsEdited) || parsed.materialsEdited < 1) throw new Error('invalid tool output')
        resolve(parsed)
      } catch { reject(new Error('BLENDER_REFINE_FAILED: tool output invalid')) }
    })
  })
}
