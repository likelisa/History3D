import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

import {
  DEFAULT_MAX_DIFF_CHARS,
  DEFAULT_TIMEOUT_MS,
  buildComment,
  buildUnavailableComment,
  describeModelMatch,
  findModelMatch,
  parseReviewContent,
  truncateDiff,
} from './ai-review-lib.mjs'

const OUTPUT_DIR = process.env.RUNNER_TEMP || '.'
const MAX_DIFF_BUFFER_BYTES = 64 * 1024 * 1024

const apiKey = process.env.OPENAI_API_KEY
const apiBaseUrl = (process.env.AI_API_BASE_URL || 'https://aiping.cn/api/v1').replace(/\/+$/, '')
// 注意大小写：该网关的模型 id 是 GLM-5.3-Flash，写错会被预检拦下。
const model = process.env.AI_MODEL || 'GLM-5.3-Flash'
const maxDiffChars = readPositiveInt(process.env.AI_MAX_DIFF_CHARS, DEFAULT_MAX_DIFF_CHARS)
const timeoutMs = readPositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
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
  'Focus only on changes introduced by this diff; do not report unrelated repository issues.',
  'Return a JSON object with this exact shape:',
  '{"summary":"short overall assessment","issues":[{"severity":"critical|blocking|warning|info","file":"relative/path","line":1,"description":"specific issue","suggestion":"concrete fix"}]}',
  'Use an empty issues array when there are no findings. Do not include Markdown code fences.',
].join('\n')

async function requestReview(userPrompt) {
  let response
  try {
    response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // 没有超时的话，上游不回响应头就会一直挂着，最后抛 undici 的
      // HeadersTimeoutError，把整个 job 打红却看不出原因。
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
  } catch (error) {
    const name = error?.name || 'Error'
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`AI provider did not respond within ${timeoutMs} ms (model: ${model}).`)
    }
    throw new Error(`Unable to reach the AI provider at ${apiBaseUrl}: ${error?.message || error}`)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`AI provider returned status ${response.status}.\n${body.slice(0, 2000)}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI provider returned an empty review response.')

  try {
    return parseReviewContent(content)
  } catch {
    throw new Error(`AI provider returned invalid JSON.\n${String(content).slice(0, 2000)}`)
  }
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
    const context = {
      base: process.env.GITHUB_BASE_SHA,
      head: process.env.GITHUB_HEAD_SHA,
      diffRef,
      truncated: truncated.truncated,
      droppedChars: truncated.droppedChars,
    }

    console.log(
      `Reviewing ${truncated.keptChars} of ${truncated.totalChars} diff characters ` +
        `(${diffRef}, model: ${model}, timeout: ${timeoutMs} ms).`,
    )

    const review = await requestReview(`Review this pull request diff:\n\n\`\`\`diff\n${truncated.text}\n\`\`\``)
    const issues = Array.isArray(review?.issues) ? review.issues : []
    const comment = buildComment(review, issues, context)

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
