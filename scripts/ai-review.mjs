import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'

const MAX_DIFF_CHARS = 100_000
const OUTPUT_DIR = process.env.RUNNER_TEMP || '.'

const apiKey = process.env.OPENAI_API_KEY
const apiBaseUrl = (process.env.AI_API_BASE_URL || 'https://aiping.cn/api/v1').replace(/\/+$/, '')
const model = process.env.AI_MODEL || 'glm-5.3-flash'
if (!apiKey) {
  console.error('OPENAI_API_KEY is not configured.')
  process.exit(1)
}

let diff
try {
  diff = execFileSync(
    'git',
    ['diff', 'HEAD~1', '--unified=0', '--no-color'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  )
} catch (error) {
  console.error('Unable to read the pull request diff.')
  console.error(error.message)
  process.exit(1)
}

const truncatedDiff =
  diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[The diff was truncated for review.]`
    : diff

const systemPrompt = [
  'You are a senior code reviewer for the History3D project.',
  'Review the provided git diff for correctness, security issues, performance problems, accessibility regressions, and maintainability risks.',
  'Focus only on changes introduced by this diff; do not report unrelated repository issues.',
  'Return a JSON object with this exact shape:',
  '{"summary":"short overall assessment","issues":[{"severity":"critical|blocking|warning|info","file":"relative/path","line":1,"description":"specific issue","suggestion":"concrete fix"}]}',
  'Use an empty issues array when there are no findings. Do not include Markdown code fences.',
].join('\n')

const userPrompt = `Review this pull request diff:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``

async function requestReview() {
  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
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

  if (!response.ok) {
    const body = await response.text()
    console.error(`AI Ping API request failed with status ${response.status}.`)
    console.error(body)
    process.exit(1)
  }

  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    console.error('AI Ping returned an empty review response.')
    process.exit(1)
  }

  try {
    return JSON.parse(content)
  } catch {
    console.error('AI Ping returned an invalid JSON review response.')
    console.error(content)
    process.exit(1)
  }
}

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

const review = await requestReview()
const issues = Array.isArray(review.issues) ? review.issues : []
const comment = buildComment(review, issues)

await mkdir(OUTPUT_DIR, { recursive: true })
await writeFile(`${OUTPUT_DIR}/ai-review.md`, `${comment}\n`, 'utf8')
await writeFile(
  `${OUTPUT_DIR}/ai-review.json`,
  `${JSON.stringify({ ...review, issues }, null, 2)}\n`,
  'utf8',
)

console.log(comment)
