import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireAssetLock } from '../processing/src/asset-patch.ts'

const roots: string[] = []
async function lockPath() { const root = await mkdtemp(path.join(os.tmpdir(), 'history3d-asset-lock-')); roots.push(root); return path.join(root, 'asset.lock') }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('cross-platform asset lock ownership', () => {
  it('reports a valid live owner as contention and keeps that owner intact', async () => {
    const lock = await lockPath()
    await mkdir(lock)
    const owner = JSON.stringify({ pid: process.pid, startedAt: Date.now() })
    await writeFile(path.join(lock, 'owner.json'), owner)
    await expect(acquireAssetLock(lock)).rejects.toThrow('ASSET_LOCKED')
    expect(await readFile(path.join(lock, 'owner.json'), 'utf8')).toBe(owner)
  })
  it('recovers a verified dead owner and records the new acquisition token', async () => {
    const lock = await lockPath()
    await mkdir(lock)
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 60_000 }))
    const token = await acquireAssetLock(lock)
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'))
    expect(owner.token).toBe(token)
    expect(owner.pid).toBe(process.pid)
  })
  it('preserves unknown ownership instead of recovering from the directory age', async () => {
    const lock = await lockPath()
    await mkdir(lock)
    const unknown = JSON.stringify({ pid: 'not-a-pid', startedAt: Date.now() - 180_000 })
    await writeFile(path.join(lock, 'owner.json'), unknown)
    await expect(acquireAssetLock(lock)).rejects.toThrow()
    expect(await readFile(path.join(lock, 'owner.json'), 'utf8')).toBe(unknown)
  })
  it('preserves a non-directory collision and does not interpret it as an asset lock', async () => {
    const lock = await lockPath()
    await writeFile(lock, 'unrelated file')
    await expect(acquireAssetLock(lock)).rejects.toThrow()
    expect(await readFile(lock, 'utf8')).toBe('unrelated file')
  })
})
