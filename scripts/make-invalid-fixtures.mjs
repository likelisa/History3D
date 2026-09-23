#!/usr/bin/env node
// 从 contracts/fixtures/valid/minimal 派生定向失败样例。
// 样例文件会提交进仓库；只改派生逻辑时才需要重跑本脚本。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceDir = path.join(repoRoot, 'contracts', 'fixtures', 'valid', 'minimal')
const targetRoot = path.join(repoRoot, 'contracts', 'fixtures', 'invalid')

const VARIANTS = [
  {
    name: 'schema-unsupported',
    why: 'story.json 的 schemaVersion 不受支持',
    mutate(files) {
      files['story.json'].schemaVersion = '0.2.0'
    },
  },
  {
    name: 'unknown-field',
    why: 'story.json 出现未声明字段',
    mutate(files) {
      files['story.json'].draftNotes = '这一字段在 v0.1 中是未声明的。'
    },
  },
  {
    name: 'revision-mismatch',
    why: 'scene.json 的 contentRevision 与资料不一致',
    mutate(files) {
      files['scene.json'].contentRevision = 2
    },
  },
  {
    name: 'missing-reference',
    why: '故事点引用了不存在的判断 ID',
    mutate(files) {
      files['story.json'].hotspots[0].claimIds = ['claim-not-exists']
    },
  },
  {
    name: 'missing-asset',
    why: 'scene.json 声明的 GLB 文件不存在',
    dropAssets: true,
    mutate(files) {
      files['scene.json'].assets[0].path = 'assets/absent.glb'
    },
  },
]

async function main() {
  const originals = {}
  for (const file of ['story.json', 'sources.json', 'scene.json']) {
    originals[file] = JSON.parse(await readFile(path.join(sourceDir, file), 'utf8'))
  }

  for (const variant of VARIANTS) {
    const destination = path.join(targetRoot, variant.name)
    await mkdir(targetRoot, { recursive: true })
    await rm(destination, { recursive: true, force: true })
    await cp(sourceDir, destination, { recursive: true })

    const files = JSON.parse(JSON.stringify(originals))
    variant.mutate(files)
    for (const [file, data] of Object.entries(files)) {
      await writeFile(path.join(destination, file), `${JSON.stringify(data, null, 2)}\n`)
    }
    if (variant.dropAssets) {
      await rm(path.join(destination, 'assets'), { recursive: true, force: true })
    }
    process.stdout.write(`wrote contracts/fixtures/invalid/${variant.name}/ — ${variant.why}\n`)
  }
}

await main()
