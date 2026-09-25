import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface BrowserFrameMeta { viewerBuild: string; timeSeconds: number; viewport: [number, number]; dpr: number; userAgent: string }
export interface BrowserFrame { viewId: string; imageSha256: string; path: string; releaseSnapshotHash: string; imagePixels: [number, number]; capturedAt: string; meta: BrowserFrameMeta }
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
const putJson = async (file: string, value: unknown): Promise<void> => { const tmp = `${file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value, null, 2) + '\n'); await rename(tmp, file) }
const VIEW_IDS = new Set(['formal-viewer-main', 'beat-1', 'beat-2', 'beat-3', 'motion-before', 'motion-mid', 'motion-after'])

export async function captureBrowserFrame(storyId: string, releaseId: string, viewId: string, png: Buffer, meta: BrowserFrameMeta, dataDir: string): Promise<BrowserFrame> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId) || !VIEW_IDS.has(viewId)) throw new Error('FRAME_ID_INVALID')
  if (png.length < 100 || png.length > 5 * 1024 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('FRAME_PNG_INVALID')
  const pixels: [number, number] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  if (pixels.some((value) => value < 200 || value > 4096) || !meta.viewerBuild?.trim() || !Number.isFinite(meta.timeSeconds) || meta.timeSeconds < 0 || !Array.isArray(meta.viewport) || meta.viewport.length !== 2 || meta.viewport.some((value) => !Number.isFinite(value) || value < 200 || value > 4096) || !Number.isFinite(meta.dpr) || meta.dpr <= 0 || meta.dpr > 4) throw new Error('FRAME_METADATA_INVALID')
  if (Math.abs(pixels[0] - meta.viewport[0] * meta.dpr) > 4 || Math.abs(pixels[1] - meta.viewport[1] * meta.dpr) > 4) throw new Error('FRAME_VIEWPORT_MISMATCH')
  const releaseDir = path.join(dataDir, 'releases', storyId, releaseId)
  const releaseBytes = await readFile(path.join(releaseDir, 'release.json'))
  const release = JSON.parse(releaseBytes.toString('utf8')) as { storyId: string; releaseId: string }
  if (release.storyId !== storyId || release.releaseId !== releaseId) throw new Error('RELEASE_ID_MISMATCH')
  const experience = await json<{ durationSeconds: number; beats: Array<{ startSeconds: number; endSeconds: number }> }>(path.join(releaseDir, 'experience.json')).catch(() => null)
  if (experience && meta.timeSeconds > experience.durationSeconds) throw new Error('FRAME_TIME_INVALID')
  if (viewId.startsWith('beat-') && experience) {
    const beat = experience.beats[Number(viewId.slice(5)) - 1]
    if (!beat || meta.timeSeconds < beat.startSeconds || meta.timeSeconds >= beat.endSeconds) throw new Error('FRAME_BEAT_MISMATCH')
  }
  const root = path.join(dataDir, 'world-reviews', storyId, releaseId, 'browser-evidence')
  await mkdir(root, { recursive: true })
  const imageSha256 = hash(png)
  const imagePath = path.join(root, `${viewId}-${imageSha256.slice(0, 12)}.png`)
  await writeFile(imagePath, png, { flag: 'wx' }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (hash(await readFile(imagePath)) !== imageSha256) throw new Error('FRAME_HASH_MISMATCH')
  })
  const frame: BrowserFrame = { viewId, imageSha256, path: imagePath, releaseSnapshotHash: hash(releaseBytes), imagePixels: pixels, capturedAt: new Date().toISOString(), meta }
  const indexPath = path.join(root, 'frames.json')
  const prior = await json<{ frames: BrowserFrame[] }>(indexPath).catch(() => ({ frames: [] }))
  await putJson(indexPath, { frames: [...prior.frames.filter((item) => item.viewId !== viewId), frame] })
  return frame
}

export async function listBrowserFrames(storyId: string, releaseId: string, dataDir: string): Promise<BrowserFrame[]> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId)) throw new Error('FRAME_ID_INVALID')
  return (await json<{ frames: BrowserFrame[] }>(path.join(dataDir, 'world-reviews', storyId, releaseId, 'browser-evidence', 'frames.json')).catch(() => ({ frames: [] }))).frames
}
