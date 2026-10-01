import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { FileDigest } from '../../contracts/src/handoff-types.ts'

export async function prepareReleasePreview(storyId: string, releaseId: string, dataDir: string, repoRoot: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId)) throw new Error('INVALID_RELEASE_ID')
  const source = path.join(dataDir, 'releases', storyId, releaseId)
  const manifest = JSON.parse(await readFile(path.join(source, 'release.json'), 'utf8')) as { storyId: string; releaseId: string; files: FileDigest[] }
  if (manifest.storyId !== storyId || manifest.releaseId !== releaseId) throw new Error('RELEASE_ID_MISMATCH')
  for (const file of manifest.files) {
    if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('UNSAFE_RELEASE_PATH')
    const bytes = await readFile(path.join(source, file.path))
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`RELEASE_HASH_MISMATCH: ${file.path}`)
  }
  const destination = path.join(repoRoot, 'viewer', 'public', 'candidates', storyId, releaseId)
  const temporary = `${destination}.${randomUUID()}.tmp`
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, temporary, { recursive: true })
  try { await rename(temporary, destination) } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return `/?story=${encodeURIComponent(storyId)}&candidate=${encodeURIComponent(releaseId)}`
}
