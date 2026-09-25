import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const cli = path.resolve('processing/src/cli.ts')
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', cwd: path.resolve('.') })

describe('processing CLI arguments', () => {
  it('rejects wrong arity before choosing a command', () => {
    const result = run('build-release', 'import-id')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })

  it('rejects nonnumeric review attempt before reading files', () => {
    const result = run('revalidate-review', 'import-aaaaaaaaaaaaaaaaaaaa', 'asset', 'wrong')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('positive integer')
  })
})
