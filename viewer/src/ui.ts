import type { Diagnostic } from '../../contracts/src/diagnostics.ts'
import { EVIDENCE_LABELS } from '../../contracts/src/types.ts'
import type { Claim, Hotspot, SourceEntry } from '../../contracts/src/types.ts'

export interface ElementOptions {
  className?: string
  text?: string
  title?: string
  hidden?: boolean
  onClick?: (event: MouseEvent) => void
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  if (options.title) node.title = options.title
  if (options.hidden) node.hidden = true
  if (options.onClick) node.addEventListener('click', options.onClick as EventListener)
  for (const child of children) node.append(child)
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function evidenceLabelOf(claim: Claim): string {
  if (claim.valueStatus === 'unknown' || !claim.evidenceType) return '暂无依据'
  return EVIDENCE_LABELS[claim.evidenceType] ?? claim.evidenceType
}

export function claimNode(claim: Claim, sources: Map<string, SourceEntry>): HTMLElement {
  const unknown = claim.valueStatus === 'unknown'
  const rows: Array<Node | string> = [
    el('div', { className: 'claim-head' }, [
      el('span', {
        className: `claim-badge claim-badge-${claim.evidenceType ?? 'unknown'}`,
        text: evidenceLabelOf(claim),
      }),
      el('span', { className: 'claim-property', text: propertyLabel(claim.property) }),
    ]),
    el('p', { className: 'claim-statement', text: claim.statement }),
  ]

  if (!unknown && claim.value !== null) {
    rows.push(
      el('p', {
        className: 'claim-value',
        text: `实现值：${formatValue(claim)}`,
      }),
    )
  }
  if (unknown) {
    rows.push(el('p', { className: 'claim-value claim-value-unknown', text: '实现值：暂无依据' }))
  }

  rows.push(el('p', { className: 'claim-note', text: `说明：${claim.note}` }))

  const sourceList = el('ul', { className: 'source-list' })
  if (claim.sourceIds.length === 0) {
    sourceList.append(
      el('li', {
        className: 'source-empty',
        text: claim.evidenceType === 'illustrative' ? '演示设定，无需来源' : '没有绑定来源',
      }),
    )
  } else {
    for (const sourceId of claim.sourceIds) {
      const source = sources.get(sourceId)
      sourceList.append(
        el('li', {
          className: 'source-item',
          text: source
            ? `${source.title} · ${source.location}`
            : `来源缺失：${sourceId}`,
        }),
      )
    }
  }
  rows.push(sourceList)

  return el('article', { className: 'claim' }, rows)
}

export function claimGroupNode(
  title: string,
  claims: Claim[],
  sources: Map<string, SourceEntry>,
): HTMLElement | null {
  if (claims.length === 0) return null
  return el('section', { className: 'claim-group' }, [
    el('h4', { text: title }),
    ...claims.map((claim) => claimNode(claim, sources)),
  ])
}

export function hotspotNode(hotspot: Hotspot, order: number, claims: Claim[], sources: Map<string, SourceEntry>): HTMLElement {
  return el('div', { className: 'hotspot-detail' }, [
    el('h3', { text: `${order}. ${hotspot.title}` }),
    el('p', { className: 'hotspot-body', text: hotspot.body }),
    ...claims.map((claim) => claimNode(claim, sources)),
  ])
}

export function diagnosticsNode(diagnostics: readonly Diagnostic[]): HTMLElement {
  const list = el('ul', { className: 'diagnostic-list' })
  for (const item of diagnostics) {
    list.append(
      el('li', { className: `diagnostic diagnostic-${item.severity}` }, [
        el('div', { className: 'diagnostic-head' }, [
          el('span', { className: 'diagnostic-code', text: item.code }),
          el('span', { className: 'diagnostic-file', text: item.field ? `${item.file} · ${item.field}` : item.file }),
        ]),
        el('p', { className: 'diagnostic-message', text: item.message }),
      ]),
    )
  }
  return list
}

export function sourceDetailNode(source: SourceEntry): HTMLElement {
  const usableUrl = source.locator.url && /^https?:\/\//i.test(source.locator.url)
  const rows: Array<Node | string> = [
    el('h4', { text: source.title }),
    el('p', { className: 'source-meta', text: `${source.citation} · ${source.location}` }),
    el('p', { className: 'source-excerpt', text: source.excerpt }),
    el('p', { className: 'source-meta', text: `使用限制：${source.rights}` }),
  ]
  if (usableUrl) {
    const link = el('a', {
      className: 'source-link',
      text: '打开外部原文',
    })
    link.href = source.locator.url as string
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    rows.push(link)
  } else {
    rows.push(
      el('p', {
        className: 'source-offline',
        text: '外部原文不可访问（离线或未提供链接），以上为包内摘要。',
      }),
    )
  }
  return el('div', { className: 'source-detail' }, rows)
}

function propertyLabel(property: Claim['property']): string {
  switch (property) {
    case 'dimensions':
      return '尺寸'
    case 'appearance':
      return '造型'
    case 'layout':
      return '布局'
    case 'count':
      return '数量'
    case 'narrative':
      return '叙事'
    case 'route':
      return '路线'
    default:
      return property
  }
}

function formatValue(claim: Claim): string {
  if (Array.isArray(claim.value)) {
    return `${claim.value.join(' × ')} 米`
  }
  if (claim.property === 'count') return `${claim.value} 件`
  return String(claim.value)
}
