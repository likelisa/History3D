import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspectNarrationWav, createPublicNarrationRunner } from '../agent/narration'
import type { Plan } from '../agent/contracts'

function audio(silentSeconds = 0) {
  const rate = 16000, samples = Math.round(rate * (1 + silentSeconds)), b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < rate; i++) b.writeInt16LE(Math.round(10000 * Math.sin(i * .1)), 44 + i * 2)
  return b
}
describe('public narration boundaries', () => {
  it('rejects the reproduced one-second voice followed by three seconds silence', () => {
    expect(inspectNarrationWav(audio()).seconds).toBe(1)
    expect(() => inspectNarrationWav(audio(3))).toThrow('VOICE_FAILED')
  })
  it('rejects a junction before creating input or spawning a worker outside the run', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'heritage-narration-boundary-')), run = path.join(base, 'run'), outside = path.join(base, 'outside')
    await mkdir(run); await mkdir(outside); await symlink(outside, path.join(run, 'narration'), process.platform === 'win32' ? 'junction' : 'dir')
    const runner = createPublicNarrationRunner({ pythonPath: path.join(base, 'never-spawn.exe') })
    await expect(runner({ runId: 'test', runDir: run, plan: { chapters: [] } as unknown as Plan })).rejects.toThrow('VOICE_FAILED')
    expect(await readdir(outside)).toEqual([])
    expect(await readdir(run)).toEqual(['narration'])
  })
})
