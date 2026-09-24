import type { PackageReader } from '../../contracts/src/validate.ts'

function joinUrl(baseUrl: string, relPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${relPath.replace(/^\/+/, '')}`
}

/**
 * 浏览器侧读取器。
 * `exists()` 在请求被网络层阻断时返回 true：此时文件是否存在无法判定，
 * 应交给加载阶段报 `ASSET_LOAD_FAILED`，而不是误报引用失效。
 */
export function createFetchReader(baseUrl: string): PackageReader {
  return {
    async readText(relPath) {
      try {
        const response = await fetch(joinUrl(baseUrl, relPath))
        if (!response.ok) return null
        return await response.text()
      } catch {
        return null
      }
    },
    async exists(relPath) {
      try {
        const response = await fetch(joinUrl(baseUrl, relPath), { method: 'HEAD' })
        if (response.ok) return true
        if (response.status === 404) return false
        return true
      } catch {
        return true
      }
    },
    async readBinary() {
      return null
    },
  }
}

export function packageBaseUrl(storyId: string): string {
  return `/packages/${storyId}`
}

export function candidateBaseUrl(storyId: string, releaseId: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storyId) || !/^release-[a-f0-9]{20}$/.test(releaseId)) return null
  return `/candidates/${storyId}/${releaseId}`
}

export function packageUrl(baseUrl: string, relPath: string): string {
  return joinUrl(baseUrl, relPath)
}
