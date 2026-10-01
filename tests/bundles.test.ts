import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { storeBundle } from '../processing/src/bundles.ts'
import { importCollection } from '../processing/src/intake.ts'
import { processingPython } from '../processing/src/python-runtime.ts'

const tempDirs: string[] = []
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), 'history3d-bundle-')); tempDirs.push(dir); return dir }
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('ZIP transport', () => {
  it('stores a fixed digest and feeds the same collection importer', async () => {
    const dataDir = await temp()
    const zipPath = path.join(dataDir, 'input.zip')
    const fixture = path.resolve('contracts/fixtures/handoff/collection')
    const code = 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for p in root.rglob("*"):\n  if p.is_file(): z.write(p,p.relative_to(root))'
    const made = spawnSync(processingPython(), ['-c', code, fixture, zipPath])
    expect(made.status).toBe(0)
    const bundle = await storeBundle(zipPath, dataDir)
    expect(bundle.files.some((item) => item.path === 'assets/pack-bundle.glb')).toBe(true)
    expect((await storeBundle(zipPath, dataDir)).bundleId).toBe(bundle.bundleId)
    const imported = await importCollection(path.join(dataDir, 'bundles', bundle.bundleId, 'files'), dataDir, 'http-fixture-key')
    expect(imported.status).toBe('needs_input')
    await writeFile(path.join(dataDir, 'bundles', bundle.bundleId, 'files', 'unlisted.txt'), 'surprise')
    await expect(storeBundle(zipPath, dataDir)).rejects.toThrow('BUNDLE_STORED_CORRUPT')
    const fakeExtractor = path.join(dataDir, 'slow-extractor.py')
    await writeFile(fakeExtractor, 'import time\ntime.sleep(2)\n')
    await expect(storeBundle(zipPath, path.join(dataDir, 'timeout-case'), { extractorPath: fakeExtractor, timeoutMs: 100 })).rejects.toThrow('BUNDLE_TIMEOUT')
    const extraExtractor = path.join(dataDir, 'extra-extractor.py')
    await writeFile(extraExtractor, 'import pathlib,sys\npathlib.Path(sys.argv[2],"extra.txt").touch()\nprint(\'{"files":[],"uncompressedBytes":0}\')\n')
    await expect(storeBundle(zipPath, path.join(dataDir, 'extra-case'), { extractorPath: extraExtractor })).rejects.toThrow('extractor file list incomplete')
  })
})
