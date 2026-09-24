import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileDigest } from '../../contracts/src/handoff-types.ts'

const MAX_ZIP_BYTES = 256 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_GLB_BYTES = 128 * 1024 * 1024
export interface BundleReceipt { bundleId: string; sha256: string; bytes: number; files: FileDigest[]; uncompressedBytes: number }
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T

export async function storeBundle(zipPath: string, dataDir: string): Promise<BundleReceipt> {
  const info = await stat(zipPath)
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ZIP_BYTES) throw new Error('BUNDLE_SIZE_INVALID')
  const stage = path.join(dataDir, 'bundle-stage', randomUUID())
  await mkdir(path.join(stage, 'files'), { recursive: true })
  try {
    await copyFile(zipPath, path.join(stage, 'bundle.zip'))
    const stagedZip = path.join(stage, 'bundle.zip')
    const stagedInfo = await stat(stagedZip)
    if (stagedInfo.size <= 0 || stagedInfo.size > MAX_ZIP_BYTES) throw new Error('BUNDLE_SIZE_INVALID')
    const sha256 = await fileHash(stagedZip)
    const bundleId = `bundle-${sha256.slice(0, 20)}`
    const finalDir = path.join(dataDir, 'bundles', bundleId)
    try {
      const prior = await readJson<BundleReceipt>(path.join(finalDir, 'bundle.json'))
      if (prior.sha256 !== sha256) throw new Error('BUNDLE_ID_CONFLICT')
      return prior
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const unpacked = await unpack(path.join(stage, 'bundle.zip'), path.join(stage, 'files'))
    if (!Number.isSafeInteger(unpacked.uncompressedBytes) || unpacked.uncompressedBytes > MAX_UNCOMPRESSED_BYTES || unpacked.files.length > 500) throw new Error('BUNDLE_TOO_LARGE')
    let actualBytes = 0
    for (const file of unpacked.files) {
      if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('BUNDLE_INVALID: unsafe extractor path')
      const inspected = await lstat(path.join(stage, 'files', file.path))
      if (!inspected.isFile() || inspected.size !== file.bytes || (file.path.toLowerCase().endsWith('.glb') && inspected.size > MAX_GLB_BYTES)) throw new Error('BUNDLE_INVALID: extracted file size mismatch')
      if (await fileHash(path.join(stage, 'files', file.path)) !== file.sha256) throw new Error('BUNDLE_INVALID: extracted file digest mismatch')
      actualBytes += inspected.size
      if (actualBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('BUNDLE_TOO_LARGE')
    }
    if (actualBytes !== unpacked.uncompressedBytes) throw new Error('BUNDLE_INVALID: uncompressed total mismatch')
    const receipt: BundleReceipt = { bundleId, sha256, bytes: stagedInfo.size, files: unpacked.files, uncompressedBytes: unpacked.uncompressedBytes }
    await writeFile(path.join(stage, 'bundle.json'), JSON.stringify(receipt, null, 2) + '\n')
    await mkdir(path.dirname(finalDir), { recursive: true })
    try { await rename(stage, finalDir) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      const prior = await readJson<BundleReceipt>(path.join(finalDir, 'bundle.json'))
      if (prior.sha256 !== sha256) throw new Error('BUNDLE_ID_CONFLICT')
      return prior
    }
    return receipt
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function fileHash(file: string): Promise<string> {
  const hasher = createHash('sha256')
  for await (const chunk of createReadStream(file)) hasher.update(chunk)
  return hasher.digest('hex')
}

async function unpack(zipPath: string, outputDir: string): Promise<{ files: FileDigest[]; uncompressedBytes: number }> {
  const script = path.resolve('processing/tools/unpack_bundle.py')
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PROCESSING_PYTHON ?? '/usr/bin/python3', [script, zipPath, outputDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    if (!child.stdout || !child.stderr) { reject(new Error('BUNDLE_INVALID: extractor streams unavailable')); return }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk.slice(0, Math.max(0, 2_000_000 - stdout.length)) })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk.slice(0, Math.max(0, 2_000 - stderr.length)) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) { reject(new Error(`BUNDLE_INVALID: ${stderr.trim() || `extractor exit ${code}`}`)); return }
      try {
        const parsed = JSON.parse(stdout) as { files?: unknown; uncompressedBytes?: unknown }
        if (!Array.isArray(parsed.files) || typeof parsed.uncompressedBytes !== 'number' || !Number.isSafeInteger(parsed.uncompressedBytes) || parsed.uncompressedBytes < 0 || parsed.files.some((file) => !file || typeof file.path !== 'string' || !Number.isSafeInteger(file.bytes) || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error('invalid extractor shape')
        resolve(parsed as { files: FileDigest[]; uncompressedBytes: number })
      }
      catch { reject(new Error('BUNDLE_INVALID: extractor result invalid')) }
    })
  })
}
