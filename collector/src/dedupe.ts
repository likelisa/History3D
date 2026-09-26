import type { SearchHit, SourceCluster } from './types.ts'

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/$/, '')
    return url.toString()
  } catch { return value.trim().toLowerCase() }
}

function keyOf(hit: SearchHit): { key: string; reason: string } {
  if (hit.doi) return { key: `doi:${hit.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`, reason: '相同 DOI' }
  const url = canonicalUrl(hit.url)
  if (url) return { key: `url:${url}`, reason: '规范化 URL 相同' }
  return { key: `title:${hit.title.normalize('NFKC').toLowerCase()}|${hit.author ?? ''}|${hit.publishedAt ?? ''}`, reason: '标题、作者与日期相同' }
}

export function dedupeHits(hits: readonly SearchHit[]): SourceCluster[] {
  const clusters = new Map<string, SourceCluster>()
  for (const hit of hits) {
    const { key, reason } = keyOf(hit)
    const existing = clusters.get(key)
    if (existing) existing.mirrors.push(hit)
    else clusters.set(key, { key, primary: hit, mirrors: [], reason })
  }
  return [...clusters.values()]
}
