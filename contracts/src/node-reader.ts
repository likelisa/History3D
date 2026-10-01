import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { PackageReader } from './validate.ts'

/** 资源路径必须以场景包根目录为基准，且不得越出包目录。 */
export function isInsideRoot(rootDir: string, relPath: string): boolean {
  const resolved = path.resolve(rootDir, relPath)
  const relative = path.relative(rootDir, resolved)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function createNodeReader(rootDir: string): PackageReader {
  const resolve = async (relPath: string): Promise<string | null> => {
    if (!isInsideRoot(rootDir, relPath)) return null
    try {
      const [realRoot, realTarget] = await Promise.all([
        realpath(rootDir), realpath(path.resolve(rootDir, relPath)),
      ])
      return isInsideRoot(realRoot, path.relative(realRoot, realTarget)) ? realTarget : null
    } catch {
      return null
    }
  }

  return {
    async listFiles() {
      const files: string[] = []
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(path.join(rootDir, dir), { withFileTypes: true })) {
          const rel = path.posix.join(dir, entry.name)
          if (entry.isDirectory()) await walk(rel)
          else if (entry.isFile()) files.push(rel)
          else throw new Error(`non-regular package entry: ${rel}`)
        }
      }
      await walk('')
      return files
    },
    async readText(relPath) {
      const target = await resolve(relPath)
      if (!target) return null
      try {
        return await readFile(target, 'utf8')
      } catch {
        return null
      }
    },
    async exists(relPath) {
      const target = await resolve(relPath)
      if (!target) return false
      try {
        const info = await stat(target)
        return info.isFile()
      } catch {
        return false
      }
    },
    async readBinary(relPath) {
      const target = await resolve(relPath)
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
