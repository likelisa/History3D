import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileDigest } from '../../contracts/src/handoff-types.ts'

const MAX_ZIP_BYTES = 256 * 1024 * 1024
export interface BundleReceipt { bundleId: string; sha256: string; bytes: number; files: FileDigest[]; uncompressedBytes: number }
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T

export async function storeBundle(zipPath: string, dataDir: string): Promise<BundleReceipt> {
  const info = await stat(zipPath)
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ZIP_BYTES) throw new Error('BUNDLE_SIZE_INVALID')
  const zipBytes = await readFile(zipPath)
  const sha256 = createHash('sha256').update(zipBytes).digest('hex')
  const bundleId = `bundle-${sha256.slice(0, 20)}`
  const finalDir = path.join(dataDir, 'bundles', bundleId)
  try {
    const prior = await readJson<BundleReceipt>(path.join(finalDir, 'bundle.json'))
    if (prior.sha256 !== sha256) throw new Error('BUNDLE_ID_CONFLICT')
    return prior
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const stage = `${finalDir}.${randomUUID()}.tmp`
  await mkdir(path.join(stage, 'files'), { recursive: true })
  try {
    await copyFile(zipPath, path.join(stage, 'bundle.zip'))
    const unpacked = await unpack(path.join(stage, 'bundle.zip'), path.join(stage, 'files'))
    const receipt: BundleReceipt = { bundleId, sha256, bytes: info.size, files: unpacked.files, uncompressedBytes: unpacked.uncompressedBytes }
    await writeFile(path.join(stage, 'bundle.json'), JSON.stringify(receipt, null, 2) + '\n')
    await mkdir(path.dirname(finalDir), { recursive: true })
    try { await rename(stage, finalDir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      await rm(stage, { recursive: true, force: true })
    }
    return receipt
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
}

async function unpack(zipPath: string, outputDir: string): Promise<{ files: FileDigest[]; uncompressedBytes: number }> {
  const script = path.resolve('processing/tools/unpack_bundle.py')
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', [script, zipPath, outputDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk.slice(0, 2_000_000) })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk.slice(0, 2_000) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) { reject(new Error(`BUNDLE_INVALID: ${stderr.trim() || `extractor exit ${code}`}`)); return }
      try { resolve(JSON.parse(stdout) as { files: FileDigest[]; uncompressedBytes: number }) }
      catch { reject(new Error('BUNDLE_INVALID: extractor result invalid')) }
    })
  })
}
