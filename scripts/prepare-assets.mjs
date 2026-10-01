#!/usr/bin/env node
// 把仓库 packages/ 完整复制到查看器静态资源目录 viewer/public/packages/。
// 复制目录是生成物，不手工维护；资源改动后重启开发入口即可。
import { cp, mkdir, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = path.join(repoRoot, 'packages')
const destination = path.join(repoRoot, 'viewer', 'public', 'packages')
const generationRoot = path.join(repoRoot, '.processing-data', 'asset-sync')

function assertWorkspacePath(target) {
  const relative = path.relative(repoRoot, path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('资源路径越出仓库')
}

async function assertDirectory(target, label) {
  try {
    const info = await stat(target)
    if (!info.isDirectory()) throw new Error(`${label} 不是目录：${target}`)
  } catch (error) {
    process.stderr.write(`资源准备失败：${label} 不存在（${target}）\n`)
    throw error
  }
}

async function main() {
  await assertDirectory(source, 'packages/')
  await mkdir(path.dirname(destination), { recursive: true })
  // Preserve the previous generated copy, then publish an exact new snapshot.
  // No recursive deletion: local edits in an old generated copy stay recoverable.
  const token = randomUUID()
  const staged = path.join(generationRoot, `staged-${token}`)
  const previous = path.join(generationRoot, `previous-${token}`)
  for (const target of [destination, staged, previous]) assertWorkspacePath(target)
  await mkdir(generationRoot, { recursive: true })
  await cp(source, staged, { recursive: true })
  let backedUp = false
  try {
    await rename(destination, previous)
    backedUp = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await rename(staged, destination)
  } catch (error) {
    if (backedUp) await rename(previous, destination)
    throw error
  }
  const relativeSource = path.relative(repoRoot, source)
  const relativeDestination = path.relative(repoRoot, destination)
  process.stdout.write(`已复制 ${relativeSource}/ → ${relativeDestination}/\n`)
}

await main()
