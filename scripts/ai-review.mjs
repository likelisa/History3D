import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

import {
  DEFAULT_CHUNK_CHARS,
  DEFAULT_MAX_DIFF_CHARS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  buildComment,
  buildUnavailableComment,
  chunkDiff,
  describeEmptyReview,
  describeModelMatch,
  findModelMatch,
  mergeIssues,
  parseReviewContent,
  parseSseLine,
  truncateDiff,
} from './ai-review-lib.mjs'

const OUTPUT_DIR = process.env.RUNNER_TEMP || '.'
const MAX_DIFF_BUFFER_BYTES = 64 * 1024 * 1024
const SUMMARY_MAX_CHARS = 1200

const apiKey = process.env.OPENAI_API_KEY
const apiBaseUrl = (process.env.AI_API_BASE_URL || 'https://aiping.cn/api/v1').replace(/\/+$/, '')
// 默认值是可用的兜底，CI 实际用仓库 Variable AI_MODEL。
// 这里特意不用 GLM-5.3-Flash：它会把 token 全花在思考上，实测对一份 1 万字符的
// 分块就能产出 2.8 万字思考却写不出正文，永远等不到结果。模型 id 区分大小写。
const model = process.env.AI_MODEL || 'Qwen3.5-Flash'
const maxDiffChars = readPositiveInt(process.env.AI_MAX_DIFF_CHARS, DEFAULT_MAX_DIFF_CHARS)
const chunkChars = readPositiveInt(process.env.AI_CHUNK_CHARS, DEFAULT_CHUNK_CHARS)
const maxTokens = readPositiveInt(process.env.AI_MAX_TOKENS, DEFAULT_MAX_TOKENS)
const timeoutMs = readPositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
const totalTimeoutMs = readPositiveInt(process.env.AI_TOTAL_TIMEOUT_MS, DEFAULT_TOTAL_TIMEOUT_MS)
const PREFLIGHT_TIMEOUT_MS = 15_000
const preflightEnabled = !['0', 'false', 'no'].includes(String(process.env.AI_PREFLIGHT || '').toLowerCase())
/** 默认不让外部服务的不稳定把 PR 卡红；需要硬失败时设 AI_REVIEW_STRICT=1。 */
const strict = ['1', 'true', 'yes'].includes(String(process.env.AI_REVIEW_STRICT || '').toLowerCase())

function readPositiveInt(raw, fallback) {
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Ignoring invalid value for a numeric option: ${raw}`)
    return fallback
  }
  return Math.floor(parsed)
}

function readDiff() {
  const base = process.env.AI_BASE_SHA || process.env.GITHUB_BASE_SHA
  // `${base}...HEAD` 必须是一个参数：拆成两个参数时 git 只打印 usage 后退出，
  // 会被下面的 try 吃掉并静默退化成 HEAD~1，于是多提交的 PR 只审到最后一个提交。
  const attempts = []
  if (base) attempts.push({ label: `${base}...HEAD`, revision: `${base}...HEAD` })
  attempts.push({ label: 'HEAD~1', revision: 'HEAD~1' })

  const errors = []
  for (const [index, attempt] of attempts.entries()) {
    try {
      const diff = execFileSync(
        'git',
        ['diff', attempt.revision, '--unified=0', '--no-color'],
        { encoding: 'utf8', maxBuffer: MAX_DIFF_BUFFER_BYTES },
      )
      if (index > 0 && errors.length > 0) {
        console.log(
          `::warning title=AI review::读取基线 ${base} 失败，已退化为 ${attempt.label}；本次审查可能只覆盖部分改动。`,
        )
      }
      return { diff, ref: attempt.label }
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`)
    }
  }

  throw new Error(`Unable to read the pull request diff.\n${errors.join('\n')}`)
}

/** 配置错误要硬失败：这不是上游抽风，改配置才能解决。 */
class ModelConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ModelConfigError'
  }
}

/**
 * 用 /models 预先校验模型名。网关对不存在的模型 id 往往不报错、直接挂住，
 * 要等满整个超时才失败；这里几秒钟就能给出准确原因。
 */
async function preflightModel() {
  if (!preflightEnabled) return

  const endpoint = `${apiBaseUrl}/models`
  let ids
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const payload = await response.json()
    ids = (payload?.data ?? []).map((entry) => entry?.id).filter(Boolean)
  } catch (error) {
    // 预检本身失败不该拦住审查，退回到直接调用。
    console.log(`::warning title=AI review::模型预检失败（${error?.message || error}），跳过模型名校验。`)
    return
  }

  if (ids.length === 0) return

  const match = findModelMatch(ids, model)
  if (match.status === 'exact') return

  throw new ModelConfigError(describeModelMatch(match, model, endpoint))
}

const systemPrompt = [
  'You are a senior code reviewer for the History3D project.',
  'Review the provided git diff for correctness, security issues, performance problems, accessibility regressions, and maintainability risks.',
  'The diff may be one slice of a larger pull request; review what is shown and do not report the omitted parts as a problem.',
  'Focus only on changes introduced by this diff; do not report unrelated repository issues.',
  'Return a JSON object with this exact shape:',
  '{"summary":"short overall assessment","issues":[{"severity":"critical|blocking|warning|info","file":"relative/path","line":1,"description":"specific issue","suggestion":"concrete fix"}]}',
  'Use an empty issues array when there are no findings. Do not include Markdown code fences.',
].join('\n')

function buildChunkPrompt(chunk) {
  return [
    `Review this pull request diff. It is part ${chunk.index + 1} of ${chunk.totalChunks}.`,
    'Files touched in this part:',
    chunk.files.length > 0 ? chunk.files.join('\n') : '(path not parsed)',
    '',
    '```diff',
    chunk.text,
    '```',
  ].join('\n')
}

function toRequestError(error, ms, extra = {}) {
  const name = error?.name || 'Error'
  if (name === 'TimeoutError' || name === 'AbortError') {
    const thought = extra.reasoningChars > 0 ? `；中止前已产出 ${extra.reasoningChars} 字思考内容` : ''
    return new Error(`AI provider did not respond within ${ms} ms (model: ${model})${thought}.`)
  }
  return new Error(`Unable to reach the AI provider at ${apiBaseUrl}: ${error?.message || error}`)
}

/**
 * 单个分块的审查请求。
 *
 * 这里必须用流式：非流式时网关要等整段生成完才回响应头，于是「上游很慢」和
 * 「连接已死」在客户端看起来一模一样，只能靠一个总超时兜底——一超时全部结果作废。
 * 流式下响应头几秒就回来，我们还能顺带看到模型是否一直在思考而没有产出正文。
 */
async function reviewChunk(chunk, { timeoutMs: chunkTimeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), chunkTimeoutMs)
  const startedAt = Date.now()

  let response
  try {
    response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        stream: true,
        // 不设上限时，推理模型在复杂 diff 上会一直「想」下去，请求可以几分钟不返回。
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildChunkPrompt(chunk) },
        ],
      }),
    })
  } catch (error) {
    clearTimeout(timer)
    throw toRequestError(error, chunkTimeoutMs)
  }

  if (!response.ok) {
    clearTimeout(timer)
    const body = await response.text().catch(() => '')
    throw new Error(`AI provider returned status ${response.status}.\n${body.slice(0, 2000)}`)
  }

  let pending = ''
  let content = ''
  let reasoningChars = 0
  let finishReason = null
  let completionTokens = null

  try {
    for await (const part of response.body) {
      pending += Buffer.from(part).toString('utf8')
      let cut
      // 一个 SSE 事件可能被拆在多个网络分片里，先按行缓冲再解析。
      while ((cut = pending.indexOf('\n')) >= 0) {
        const event = parseSseLine(pending.slice(0, cut))
        pending = pending.slice(cut + 1)
        if (!event) continue
        content += event.content
        reasoningChars += event.reasoning.length
        if (event.finishReason) finishReason = event.finishReason
        if (event.completionTokens !== null) completionTokens = event.completionTokens
      }
    }
  } catch (error) {
    throw toRequestError(error, chunkTimeoutMs, { reasoningChars })
  } finally {
    clearTimeout(timer)
  }

  if (content.trim() === '') {
    throw new Error(describeEmptyReview({ reasoningChars, finishReason }))
  }

  let review
  try {
    review = parseReviewContent(content)
  } catch {
    throw new Error(`AI provider returned invalid JSON.\n${content.slice(0, 2000)}`)
  }

  return {
    review,
    issues: Array.isArray(review?.issues) ? review.issues : [],
    elapsedMs: Date.now() - startedAt,
    reasoningChars,
    completionTokens,
    finishReason,
  }
}

function buildSummary(summaries) {
  const text = summaries
    .map((summary) => String(summary ?? '').trim())
    .filter(Boolean)
    // 每块一段：分块审查时把多段摘要用空格拼在一起会变成一整坨，读不出边界。
    .join('\n\n')
  if (text === '') return 'The AI reviewer did not provide a summary.'
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}…` : text
}

async function writeOutputs(comment, payload) {
  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(`${OUTPUT_DIR}/ai-review.md`, `${comment}\n`, 'utf8')
  await writeFile(`${OUTPUT_DIR}/ai-review.json`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function main() {
  let ref = process.env.AI_BASE_SHA || process.env.GITHUB_BASE_SHA || null

  try {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

    await preflightModel()

    const { diff, ref: diffRef } = readDiff()
    ref = diffRef
    const truncated = truncateDiff(diff, maxDiffChars)
    const chunks = chunkDiff(truncated.text, chunkChars)

    const context = {
      base: process.env.GITHUB_BASE_SHA,
      head: process.env.GITHUB_HEAD_SHA,
      diffRef,
      truncated: truncated.truncated,
      droppedChars: truncated.droppedChars,
    }

    console.log(
      `Reviewing ${truncated.keptChars} of ${truncated.totalChars} diff characters in ${chunks.length} chunk(s) ` +
        `(${diffRef}, model: ${model}, chunk: ${chunkChars} chars, max_tokens: ${maxTokens}, ` +
        `per-chunk timeout: ${timeoutMs} ms, total budget: ${totalTimeoutMs} ms).`,
    )

    const summaries = []
    const issueGroups = []
    const failedChunks = []
    const deadline = Date.now() + totalTimeoutMs

    for (const chunk of chunks) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        failedChunks.push({
          index: chunk.index,
          files: chunk.files,
          reason: `总时间预算 ${totalTimeoutMs} ms 已用完，未提交这一块`,
        })
        continue
      }

      process.stdout.write(`  · chunk ${chunk.index + 1}/${chunk.totalChunks} (${chunk.chars} chars) … `)
      try {
        const result = await reviewChunk(chunk, { timeoutMs: Math.min(timeoutMs, remaining) })
        issueGroups.push(result.issues)
        summaries.push(result.review?.summary)
        console.log(`${(result.elapsedMs / 1000).toFixed(1)}s, ${result.issues.length} issue(s)`)
      } catch (error) {
        const reason = error?.message || String(error)
        failedChunks.push({ index: chunk.index, files: chunk.files, reason })
        console.log(`failed: ${reason.split('\n')[0]}`)
      }
    }

    // 一块都没成就当作「审查没跑」处理；有成功块时如实标注覆盖范围再出评论。
    if (issueGroups.length === 0) {
      throw new Error(
        `所有 ${chunks.length} 块都没有产出结果。\n` +
          failedChunks.map((failure) => `- chunk ${failure.index + 1}: ${failure.reason}`).join('\n'),
      )
    }

    const issues = mergeIssues(issueGroups)
    const review = { summary: buildSummary(summaries), issues }
    const comment = buildComment(review, issues, {
      ...context,
      coverage: { totalChunks: chunks.length, reviewedChunks: issueGroups.length, failedChunks },
    })

    await writeOutputs(comment, { ...review, issues })
    console.log(comment)
    return 0
  } catch (error) {
    const reason = error?.message || String(error)
    console.error(reason)

    const context = { base: process.env.GITHUB_BASE_SHA, head: process.env.GITHUB_HEAD_SHA, diffRef: ref }
    // 空 issues：审查没跑成，不能顺带把“发现阻塞问题”的警告也打出来。
    await writeOutputs(buildUnavailableComment(reason, context), {
      summary: 'AI review did not run.',
      unavailable: true,
      reason,
      issues: [],
    })

    // ::warning 让问题在 Actions 摘要里显眼，但不改变 job 结论。
    console.log(`::warning title=AI review::AI 审查未产出结果：${reason.split('\n')[0]}`)
    // 配置错误是「改一下就好的事」，按 error 标注，方便在 Actions 摘要里一眼看到。
    if (error instanceof ModelConfigError) {
      console.log(`::error title=AI review::${reason.split('\n')[0]}`)
    }
    return strict ? 1 : 0
  }
}

process.exit(await main())
