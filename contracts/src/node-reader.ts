import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { PackageReader } from './validate.ts'

/** 资源路径必须以场景包根目录为基准，且不得越出包目录。 */
export function isInsideRoot(rootDir: string, relPath: string): boolean {
  const resolved = path.resolve(rootDir, relPath)
  const relative = path.relative(rootDir, resolved)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function createNodeReader(rootDir: string): PackageReader {
  const resolve = (relPath: string): string | null =>
    isInsideRoot(rootDir, relPath) ? path.resolve(rootDir, relPath) : null

  return {
    async readText(relPath) {
      const target = resolve(relPath)
      if (!target) return null
      try {
        return await readFile(target, 'utf8')
      } catch {
        return null
      }
    },
    async exists(relPath) {
      const target = resolve(relPath)
      if (!target) return false
      try {
        const info = await stat(target)
        return info.isFile()
      } catch {
        return false
      }
    },
    async readBinary(relPath) {
      const target = resolve(relPath)
      if (!target) return null
      try {
        const buffer = await readFile(target)
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer
      } catch {
        return null
      }
    },
  }
}
