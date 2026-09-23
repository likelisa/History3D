#!/usr/bin/env node
// 把仓库 packages/ 完整复制到查看器静态资源目录 viewer/public/packages/。
// 复制目录是生成物，不手工维护；资源改动后重启开发入口即可。
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = path.join(repoRoot, 'packages')
const destination = path.join(repoRoot, 'viewer', 'public', 'packages')

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
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true })
  const relativeSource = path.relative(repoRoot, source)
  const relativeDestination = path.relative(repoRoot, destination)
  process.stdout.write(`已复制 ${relativeSource}/ → ${relativeDestination}/\n`)
}

await main()
