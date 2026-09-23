import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

import { pathToFileURL } from 'node:url'
import path from 'node:path'

const MAX_DIFF_CHARS = 100_000

const systemPrompt = [
  'You are a senior code reviewer for the History3D project.',
  'Review the provided git diff for correctness, security issues, performance problems, accessibility regressions, and maintainability risks.',
  'Focus only on changes introduced by this diff; do not report unrelated repository issues.',
  'Return a JSON object with this exact shape:',
  '{"summary":"short overall assessment","issues":[{"severity":"critical|blocking|warning|info","file":"relative/path","line":1,"description":"specific issue","suggestion":"concrete fix"}]}',
  'Use an empty issues array when there are no findings. Do not include Markdown code fences.',
].join('\n')

function normalizeSeverity(severity) {
  return String(severity || 'info').toLowerCase()
}

function formatIssue(issue) {
  const severity = normalizeSeverity(issue.severity)
  const location = [issue.file, issue.line].filter(Boolean).join(':')
  const heading = severity === 'critical' || severity === 'blocking'
    ? '🔴 Blocking issue'
    : severity === 'warning'
      ? '⚠️ Warning'
      : 'ℹ️ Note'

  return [
    `### ${heading}`,
    location ? `\`${location}\`` : '',
    issue.description || 'No description provided.',
    issue.suggestion ? `\n**Suggestion:** ${issue.suggestion}` : '',
  ].filter(Boolean).join('\n')
}

function buildComment(review, issues) {
  const summary = review.summary || 'The AI reviewer did not provide a summary.'

  if (issues.length === 0) {
    return `## ✅ AI Review\n\n${summary}\n\nNo issues were found in this diff.`
  }

  return [
    '## 🤖 AI Review',
    '',
    summary,
    '',
    ...issues.map(formatIssue),
  ].join('\n')
}

export async function runReview({ env = process.env, fetchImpl = fetch, readDiff } = {}) {
  const outputDir = env.RUNNER_TEMP || '.'
  await mkdir(outputDir, { recursive: true })
  async function save(result, comment) {
    await writeFile(path.join(outputDir, 'ai-review.json'), JSON.stringify(result, null, 2) + '\n', 'utf8')
    await writeFile(path.join(outputDir, 'ai-review.md'), comment + '\n', 'utf8')
  }
  async function failed(reason) {
    await save({ status: 'error', summary: reason, issues: [] },
      `## ⚠️ AI Review unavailable\n\n${reason}\n\nNo review was completed. This is not a clean review result; inspect the workflow and retry.`)
  }
  // Leave a truthful report even if the request or a later operation fails.
  await failed('The AI review did not complete.')
  try {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.')
    const timeoutMs = Number(env.AI_REVIEW_TIMEOUT_MS || 120_000)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240_000) {
      throw new Error('AI_REVIEW_TIMEOUT_MS must be between 1 and 240000.')
    }
    let diff
    try {
      if (readDiff) diff = readDiff()
      else {
        const revisions = env.PR_BASE_SHA && env.PR_HEAD_SHA
          ? [env.PR_BASE_SHA, env.PR_HEAD_SHA] : ['HEAD~1', 'HEAD']
        if (!revisions.every(ref => /^(?:[a-f0-9]{40}|HEAD(?:~1)?)$/.test(ref))) {
          throw new Error('Invalid revision')
        }
        diff = execFileSync('git', ['diff', '--unified=0', '--no-color', ...revisions, '--'],
          { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
      }
    } catch {
      throw new Error('Unable to read the pull request diff.')
    }
    const truncatedDiff = diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n[The diff was truncated for review.]' : diff
    const apiBaseUrl = (env.AI_API_BASE_URL || 'https://aiping.cn/api/v1').replace(/\/+$/, '')
    let response, payload
    try {
      response = await fetchImpl(`${apiBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.AI_MODEL || 'glm-5.3-flash', temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: systemPrompt },
            { role: 'user', content: `Review this pull request diff:\n\n${truncatedDiff}` }],
        }),
      })
      if (!response.ok) throw new Error(`AI API returned HTTP ${response.status}.`)
      payload = await response.json()
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error(`AI API request timed out after ${timeoutMs / 1000} seconds.`)
      }
      if (/^AI API returned HTTP \d+\.$/.test(error.message)) throw error
      throw new Error('AI API request failed due to a network or response error.')
    }
    let review
    try {
      review = JSON.parse(payload.choices?.[0]?.message?.content)
      if (!review || typeof review.summary !== 'string' || !Array.isArray(review.issues)
          || !review.issues.every(issue => issue && typeof issue === 'object'
            && ['critical', 'blocking', 'warning', 'info'].includes(issue.severity)
            && typeof issue.description === 'string')) throw new Error('Invalid shape')
    } catch {
      throw new Error('AI API returned an invalid or empty JSON review.')
    }
    await save({ ...review, status: 'success' }, buildComment(review, review.issues))
    return 0
  } catch (error) {
    await failed(error.message)
    console.error(error.message)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await runReview() }
  catch { console.error('Unable to write AI review artifacts.'); process.exitCode = 1 }
}
