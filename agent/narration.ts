import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile, mkdir, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { ContractError } from './contracts'
import type { Plan } from './contracts'

export const PUBLIC_VOICE_ID = 'history3d-public-uncle-fu-r13' as const
export const PUBLIC_REFERENCE_SHA = 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37'
export const PUBLIC_SOURCE_COMMIT = 'd7c2210da8c013e81a94bfc7b811a477c99fd506'
export type NarrationTrack = { id: string; text: string; file: string; sha256: string; bytes: number; seconds: number; subtitleAudioSha256: string; subtitlePoints: { seconds: number; textEnd: number }[] }
export type NarrationManifest = { formatVersion: '1.0.0'; voiceId: typeof PUBLIC_VOICE_ID; referenceSha256: string; sourceCommit: string; complete: true; humanAudioReviewed: false; tracks: NarrationTrack[] }
export type NarrationContext = { runId: string; runDir: string; plan: Plan }
export type NarrationRunner = (context: NarrationContext) => Promise<NarrationManifest>
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function fail(): never { throw new ContractError('VOICE_FAILED') }
const hashPattern = /^[a-f0-9]{64}$/

export function inspectNarrationWav(bytes: Buffer): { seconds: number; samples: number; rate: number } {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) + 8 !== bytes.length || bytes.toString('ascii', 8, 12) !== 'WAVE') fail()
  let cursor = 12, rate = 0, alignment = 0, payload: Buffer | undefined, formatSeen = false
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', cursor, cursor + 4), size = bytes.readUInt32LE(cursor + 4), start = cursor + 8
    if (start + size > bytes.length) fail()
    if (kind === 'fmt ') {
      if (formatSeen || size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt16LE(start + 14) !== 16) fail()
      formatSeen = true; rate = bytes.readUInt32LE(start + 4); alignment = bytes.readUInt16LE(start + 12)
      if (rate < 16000 || rate > 96000 || alignment !== 2 || bytes.readUInt32LE(start + 8) !== rate * alignment) fail()
    } else if (kind === 'data') { if (payload) fail(); payload = bytes.subarray(start, start + size) }
    cursor = start + size + size % 2
  }
  if (cursor !== bytes.length || !formatSeen || !payload || payload.length % alignment) fail()
  const samples = payload.length / alignment, seconds = samples / rate
  if (seconds < .3 || seconds > 180) fail()
  let peak = 0, sum = 0, quietSamples = 0, windowSum = 0, windowSamples = 0
  const windowSize = Math.max(1, Math.floor(rate * .02))
  for (let i = 0; i < payload.length; i += 2) {
    const value = payload.readInt16LE(i); peak = Math.max(peak, Math.abs(value)); sum += value * value
    windowSum += value * value; windowSamples++
    if (windowSamples === windowSize || i + 2 === payload.length) {
      quietSamples = Math.sqrt(windowSum / windowSamples) < 327.68 ? quietSamples + windowSamples : 0
      if (quietSamples / rate > 1.5) fail()
      windowSum = 0; windowSamples = 0
    }
  }
  if (peak < 100 || Math.sqrt(sum / samples) < 16) fail()
  return { seconds, samples, rate }
}

export async function validateNarrationManifest(value: unknown, plan: Plan, runDir: string): Promise<NarrationManifest> {
  const manifest = value as NarrationManifest
  if (!manifest || manifest.formatVersion !== '1.0.0' || manifest.voiceId !== PUBLIC_VOICE_ID || manifest.referenceSha256 !== PUBLIC_REFERENCE_SHA || manifest.sourceCommit !== PUBLIC_SOURCE_COMMIT || manifest.complete !== true || manifest.humanAudioReviewed !== false || !Array.isArray(manifest.tracks)) fail()
  const cues = plan.chapters.flatMap(chapter => chapter.cues), root = await realpath(runDir), narrationRoot = await realpath(path.join(root, 'narration'))
  if (path.dirname(narrationRoot) !== root || manifest.tracks.length !== cues.length) fail()
  const seen = new Set<string>()
  for (const [index, cue] of cues.entries()) {
    const track = manifest.tracks[index]
    if (!track || track.id !== cue.id || track.text !== cue.text || seen.has(track.id) || track.file !== `narration/${cue.id}.wav` || !hashPattern.test(track.sha256) || track.subtitleAudioSha256 !== track.sha256 || !Number.isSafeInteger(track.bytes) || track.bytes < 44 || track.bytes > 40 * 1024 * 1024 || !Number.isFinite(track.seconds)) fail()
    seen.add(track.id)
    const filename = await realpath(path.join(root, track.file))
    if (path.dirname(filename) !== narrationRoot) fail()
    const bytes = await readFile(filename)
    if (bytes.length !== track.bytes || digest(bytes) !== track.sha256 || Math.abs(inspectNarrationWav(bytes).seconds - track.seconds) > .001) fail()
    if (!Array.isArray(track.subtitlePoints) || !track.subtitlePoints.length) fail()
    let time = -1, end = 0
    const length = Array.from(cue.text).length
    for (const point of track.subtitlePoints) {
      if (!point || !Number.isFinite(point.seconds) || point.seconds < 0 || point.seconds < time || point.seconds > track.seconds || !Number.isSafeInteger(point.textEnd) || point.textEnd <= end || point.textEnd > length) fail()
      time = point.seconds; end = point.textEnd
    }
    if (end !== length) fail()
  }
  // Return only the allowed fields; no absolute paths, provider response or arbitrary caller metadata.
  return { formatVersion: '1.0.0', voiceId: PUBLIC_VOICE_ID, referenceSha256: PUBLIC_REFERENCE_SHA, sourceCommit: PUBLIC_SOURCE_COMMIT, complete: true, humanAudioReviewed: false,
    tracks: manifest.tracks.map(track => ({ id: track.id, text: track.text, file: track.file, sha256: track.sha256, bytes: track.bytes, seconds: track.seconds, subtitleAudioSha256: track.subtitleAudioSha256, subtitlePoints: track.subtitlePoints.map(point => ({ seconds: point.seconds, textEnd: point.textEnd })) })) }
}

export function createPublicNarrationRunner(options: { environmentRoot?: string; pythonPath?: string; scriptPath?: string } = {}): NarrationRunner {
  const repo = fileURLToPath(new URL('..', import.meta.url))
  const environment = options.environmentRoot ?? process.env.HISTORY3D_PUBLIC_VOICE_ROOT ?? 'E:/History3D-PublicVoice-r13/GPT-SoVITS-v2pro-20250604-nvidia50'
  const python = options.pythonPath ?? path.join(environment, 'runtime/python.exe')
  const script = options.scriptPath ?? path.join(repo, 'scripts/generate-public-agent-narration.py')
  return async ({ runDir, plan }) => {
    try {
      const root = await realpath(runDir), folder = path.join(root, 'narration')
      try { await mkdir(folder) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if ((await lstat(folder)).isSymbolicLink() || await realpath(folder) !== folder) fail()
      const input = path.join(root, 'narration-input.json'), expected = JSON.stringify(plan, null, 2) + '\n'
      try { if ((await lstat(input)).isSymbolicLink() || path.dirname(await realpath(input)) !== root) fail() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try { if (await readFile(input, 'utf8') !== expected) fail() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await writeFile(input, expected, { flag: 'wx', mode: 0o600 }) }
      await new Promise<void>((resolve, reject) => {
        const env: NodeJS.ProcessEnv = {}
        for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]
        const child = spawn(python, ['-u', script, '--plan', input, '--output', folder, '--environment', environment], { shell: false, windowsHide: true, stdio: 'ignore', env })
        const timer = setTimeout(() => { child.kill(); reject(new ContractError('VOICE_FAILED')) }, 30 * 60 * 1000)
        child.on('error', () => { clearTimeout(timer); reject(new ContractError('VOICE_UNAVAILABLE')) })
        child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new ContractError(code === 3 ? 'VOICE_UNAVAILABLE' : 'VOICE_FAILED')) })
      })
      return await validateNarrationManifest(JSON.parse(await readFile(path.join(runDir, 'narration/manifest.json'), 'utf8')), plan, runDir)
    } catch (error) { if (error instanceof ContractError) throw error; throw new ContractError('VOICE_FAILED') }
  }
}
