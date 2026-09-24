/**
 * AI 审查的纯函数部分：截断、严重级别归一化、评论拼装。
 * 单独放一个文件，方便在不联网、不调用模型的情况下直接验证这些规则。
 */

export const DEFAULT_MAX_DIFF_CHARS = 100_000
/**
 * 单次请求的 diff 预算。整份 diff 一次丢给推理模型时，它要「想」的东西太多，
 * 思考长度不受控，请求可能几分钟都不返回；按文件边界切成小块后每块都能收敛。
 */
export const DEFAULT_CHUNK_CHARS = 25_000
export const DEFAULT_TIMEOUT_MS = 180_000
/** 所有分块加起来的墙钟预算，避免分块数变多后把 job 拖到超时。 */
export const DEFAULT_TOTAL_TIMEOUT_MS = 600_000
/**
 * 给「思考 + 正文」一个硬上限；不设的话生成长度完全不受控。
 * 这个值必须容得下推理模型的思考：实测 DeepSeek-V4.1-Flash 单块要 2.5 万～3 万字符
 * 的思考才写出正文，8000 会让它全部卡在思考阶段、一个字都产不出来。
 */
export const DEFAULT_MAX_TOKENS = 32_000

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
  const coverage = coverageLines(context.coverage)
  if (coverage.length > 0) lines.push(...coverage, '')

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
 * 分块审查后，必须说清「哪几块真的审过」。
 * 只报「审完了」而不提失败的分块，等于把部分覆盖伪装成完整覆盖。
 */
export function coverageLines(coverage) {
  if (!coverage || !Number.isFinite(coverage.totalChunks) || coverage.totalChunks <= 0) return []

  const reviewed = coverage.reviewedChunks ?? 0
  const failed = Array.isArray(coverage.failedChunks) ? coverage.failedChunks : []
  const lines = [`本次审查覆盖 ${reviewed}/${coverage.totalChunks} 块。`]

  for (const failure of failed) {
    const where = failure.files?.length ? `（${failure.files.slice(0, 3).join(', ')}${failure.files.length > 3 ? ' 等' : ''}）` : ''
    lines.push(`- 第 ${Number(failure.index) + 1} 块未审查${where}：${failure.reason}`)
  }

  return lines
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

/**
 * 网关的模型 id 区分大小写，而写错时它往往既不报错也不返回，直接挂住。
 * 这里先拿 /models 对一遍，把「配错模型名」变成一条能立刻看懂的错误。
 */
export function findModelMatch(models, wanted) {
  const target = String(wanted ?? '').trim()
  const ids = (Array.isArray(models) ? models : []).filter((id) => typeof id === 'string' && id.length > 0)

  if (!target) return { status: 'missing', caseInsensitive: [], suggestions: [] }
  if (ids.includes(target)) return { status: 'exact', caseInsensitive: [], suggestions: [] }

  const caseInsensitive = ids.filter((id) => id.toLowerCase() === target.toLowerCase())
  if (caseInsensitive.length > 0) return { status: 'case-mismatch', caseInsensitive, suggestions: [] }

  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wantedNorm = normalize(target)
  const suggestions = ids
    .filter((id) => {
      const candidate = normalize(id)
      return candidate.includes(wantedNorm) || wantedNorm.includes(candidate)
    })
    .slice(0, 5)

  return { status: 'missing', caseInsensitive: [], suggestions }
}

export function describeModelMatch(match, model, modelsEndpoint) {
  const quoted = match.caseInsensitive.map((id) => `\`${id}\``).join(' 或 ')
  if (match.status === 'case-mismatch') {
    return `AI_MODEL 配置为 "${model}"，但该网关的模型 id 大小写不同。请改成 ${quoted}。`
  }
  const hint = match.suggestions.length > 0 ? `相近的候选：${match.suggestions.join(', ')}。` : ''
  return `AI_MODEL 配置为 "${model}"，但该网关的模型列表里没有它。${hint}完整列表见 ${modelsEndpoint}。`
}

/**
 * 解析 SSE 的一行。返回 null 表示这行没有可用内容（注释、心跳、[DONE] 等）。
 * 推理模型的思考内容走 `reasoning_content`，正文才在 `content`。
 */
export function parseSseLine(line) {
  const text = String(line ?? '').trim()
  if (!text.startsWith('data:')) return null

  const payload = text.slice(5).trim()
  if (!payload || payload === '[DONE]') return null

  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  const choice = parsed?.choices?.[0]
  const delta = choice?.delta ?? {}
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '',
    finishReason: choice?.finish_reason ?? null,
    completionTokens: parsed?.usage?.completion_tokens ?? null,
  }
}

export function readReviewResponse(payload) {
  const choice = payload?.choices?.[0]
  const message = choice?.message ?? {}
  const content = typeof message.content === 'string' ? message.content : ''
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : ''

  return {
    content,
    reasoningChars: reasoning.length,
    finishReason: choice?.finish_reason ?? null,
    completionTokens: payload?.usage?.completion_tokens ?? null,
  }
}

/**
 * 模型没给出正文时，尽量说清是哪种「没给出」。
 * 推理模型会把 token 全花在思考上，这类失败和「网关挂了」完全是两回事。
 */
export function describeEmptyReview(response = {}) {
  const reasoningChars = Number(response.reasoningChars) || 0
  const truncated = response.finishReason === 'length'

  if (reasoningChars > 0) {
    return (
      `模型只产出了思考内容（${reasoningChars} 字）` +
      (truncated ? '，并在思考阶段就撞上了 max_tokens 上限' : '') +
      '，没有给出审查结果。这通常是推理模型：改用非推理模型，' +
      '或调小 AI_CHUNK_CHARS / 调大 AI_MAX_TOKENS。'
    )
  }

  return truncated
    ? '模型在产出内容前就撞上了 max_tokens 上限，请调大 AI_MAX_TOKENS。'
    : '模型返回了空响应。'
}

export function issueKey(issue) {
  return [
    normalizeSeverity(issue?.severity),
    String(issue?.file ?? '').trim().toLowerCase(),
    String(issue?.line ?? '').trim(),
    String(issue?.description ?? '').trim().toLowerCase(),
  ].join('|')
}

/**
 * 合并各分块的判断。同一个问题被多块重复指出时只保留一条，
 * 排序把需要人工确认的阻塞项放在最前面。
 */
export function mergeIssues(groups) {
  const seen = new Set()
  const merged = []

  for (const group of Array.isArray(groups) ? groups : []) {
    for (const issue of Array.isArray(group) ? group : []) {
      const key = issueKey(issue)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(issue)
    }
  }

  return merged.sort((a, b) => Number(isBlocking(b)) - Number(isBlocking(a)))
}

const FILE_HEADER = /^diff --git /

/** 从 `diff --git a/x b/y` 头部取出路径。 */
export function diffFilePath(header) {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(String(header ?? ''))
  return match ? match[2] : null
}

function splitDiffIntoFiles(diff) {
  const files = []
  let current = null

  for (const line of String(diff ?? '').split('\n')) {
    if (FILE_HEADER.test(line)) {
      current = { header: line, lines: [line] }
      files.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }

  return files.map((file) => ({ path: diffFilePath(file.header), text: file.lines.join('\n') }))
}

/** 单个文件就超预算时按行硬切，保证任何一块都不会撑爆请求。 */
function splitOversizedSection(text, maxChars) {
  const pieces = []
  let buffer = []
  let size = 0

  for (const line of text.split('\n')) {
    if (size + line.length + 1 > maxChars && buffer.length > 0) {
      pieces.push(buffer.join('\n'))
      buffer = []
      size = 0
    }
    buffer.push(line)
    size += line.length + 1
  }

  if (buffer.length > 0) pieces.push(buffer.join('\n'))
  return pieces
}

/**
 * 按文件边界把 diff 切成多块。切在文件之间而不是任意字符处，
 * 是为了让每一块都是一个能独立看懂、独立评审的完整改动。
 */
export function chunkDiff(diff, maxChars = DEFAULT_CHUNK_CHARS) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new Error(`maxChars must be a positive number, received ${maxChars}`)
  }

  const chunks = []
  let buffer = []
  let bufferChars = 0

  const flush = () => {
    if (buffer.length === 0) return
    chunks.push({
      files: buffer.map((file) => file.path).filter(Boolean),
      text: buffer.map((file) => file.text).join('\n'),
    })
    buffer = []
    bufferChars = 0
  }

  for (const file of splitDiffIntoFiles(diff)) {
    if (file.text.length > maxChars) {
      flush()
      for (const piece of splitOversizedSection(file.text, maxChars)) {
        chunks.push({ files: file.path ? [file.path] : [], text: piece })
      }
      continue
    }

    if (bufferChars + file.text.length > maxChars) flush()
    buffer.push(file)
    bufferChars += file.text.length
  }
  flush()

  return chunks.map((chunk, index) => ({ ...chunk, index, totalChunks: chunks.length, chars: chunk.text.length }))
}
