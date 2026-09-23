/**
 * AI 审查的纯函数部分：截断、严重级别归一化、评论拼装。
 * 单独放一个文件，方便在不联网、不调用模型的情况下直接验证这些规则。
 */

export const DEFAULT_MAX_DIFF_CHARS = 100_000
export const DEFAULT_TIMEOUT_MS = 180_000

/** 这三个级别视为需要人工确认。 */
export const BLOCKING_SEVERITIES = ['critical', 'blocking']

export function normalizeSeverity(severity) {
  return String(severity ?? 'info').trim().toLowerCase()
}

export function isBlocking(issue) {
  return BLOCKING_SEVERITIES.includes(normalizeSeverity(issue?.severity))
}

/**
 * 按字符数截断 diff。超限时优先切在行边界，避免留下半行 diff 让人误读；
 * 并在正文里写清截掉了多少，避免读者以为看的是完整改动。
 */
export function truncateDiff(diff, maxChars = DEFAULT_MAX_DIFF_CHARS) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new Error(`maxChars must be a positive number, received ${maxChars}`)
  }

  const totalChars = diff.length
  if (totalChars <= maxChars) {
    return { text: diff, truncated: false, totalChars, keptChars: totalChars, droppedChars: 0 }
  }

  const hardCut = diff.slice(0, maxChars)
  const lastNewline = hardCut.lastIndexOf('\n')
  const kept = lastNewline > 0 ? hardCut.slice(0, lastNewline) : hardCut
  const droppedChars = totalChars - kept.length
  const note = `\n\n[Diff truncated: showing the first ${kept.length} of ${totalChars} characters (${droppedChars} dropped). Review only the shown portion.]`

  return {
    text: `${kept}${note}`,
    truncated: true,
    totalChars,
    keptChars: kept.length,
    droppedChars,
  }
}

/** 模型有时仍会包 Markdown 代码块，这里兜一下再解析。 */
export function parseReviewContent(content) {
  const stripped = String(content ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(stripped)
}

export function formatIssue(issue) {
  const severity = normalizeSeverity(issue?.severity)
  const location = [issue?.file, issue?.line].filter(Boolean).join(':')
  const heading = isBlocking(issue)
    ? '🔴 Blocking issue'
    : severity === 'warning'
      ? '⚠️ Warning'
      : 'ℹ️ Note'

  return [
    `### ${heading}`,
    location ? `\`${location}\`` : '',
    issue?.description || 'No description provided.',
    issue?.suggestion ? `\n**Suggestion:** ${issue.suggestion}` : '',
  ].filter(Boolean).join('\n')
}

function contextLine(context = {}) {
  const parts = []
  if (context.base && context.head) parts.push(`\`${context.base}\` → \`${context.head}\``)
  else if (context.diffRef) parts.push(`\`${context.diffRef}\``)
  if (context.truncated) {
    parts.push(`diff 已截断，丢弃 ${context.droppedChars} 字符`)
  }
  return parts.join(' · ')
}

export function buildComment(review, issues, context = {}) {
  const summary = review?.summary || 'The AI reviewer did not provide a summary.'
  const header = contextLine(context)

  const lines = ['## 🤖 AI Review', '']
  if (header) lines.push(header, '')

  if (issues.length === 0) {
    lines.push(summary, '', 'No issues were found in this diff.')
  } else {
    lines.push(summary, '', ...issues.map(formatIssue))
  }

  const blocking = issues.filter(isBlocking).length
  if (blocking > 0) {
    lines.push('', `> ⚠️ ${blocking} 条 critical / blocking 判断需要人工确认。`)
  }

  return lines.join('\n')
}

/**
 * 审查没能跑起来时也要留痕：外部服务超时不应该让 PR 变红，
 * 更不应该一个字都不说就静默通过。
 */
export function buildUnavailableComment(reason, context = {}) {
  const header = contextLine(context)
  return [
    '## ⚠️ AI Review 未运行',
    '',
    header ? `${header}\n` : '',
    'AI 审查没有产出结果，本次 PR **没有被自动审查过**，请依赖人工审核。',
    '',
    '```text',
    String(reason ?? 'unknown error').split('\n').slice(0, 20).join('\n'),
    '```',
    '',
    '常见原因：`OPENAI_API_KEY` 未配置、上游接口超时或返回异常、diff 读取失败。',
    '重跑方式：在该 PR 的 Actions 页面重新运行 `AI PR Review`。',
  ].join('\n')
}
