import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runReview } from './ai-review.mjs'

async function run(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'history-review-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const code = await runReview({
    env: { RUNNER_TEMP: dir, OPENAI_API_KEY: 'test-key', ...options.env },
    readDiff: () => '+ test diff',
    fetchImpl: async () => { throw new Error('unexpected request') },
    ...options,
    ...(options.env ? { env: { RUNNER_TEMP: dir, OPENAI_API_KEY: 'test-key', ...options.env } } : {}),
  })
  return { code, report: JSON.parse(await readFile(path.join(dir, 'ai-review.json'), 'utf8')),
    comment: await readFile(path.join(dir, 'ai-review.md'), 'utf8') }
}
const response = review => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(review) } }] }) })

test('missing key writes failure report without network request', async t => {
  const result = await run(t, { env: { OPENAI_API_KEY: '' } })
  assert.equal(result.code, 1)
  assert.equal(result.report.status, 'error')
  assert.match(result.comment, /OPENAI_API_KEY/)
})
test('headers timeout writes failure report rather than clean review', async t => {
  const result = await run(t, { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError') } })
  assert.equal(result.code, 1)
  assert.match(result.comment, /timed out/)
  assert.doesNotMatch(result.comment, /No issues were found/)
})
test('network error does not leak raw details', async t => {
  const result = await run(t, { fetchImpl: async () => { throw new TypeError('secret raw response') } })
  assert.equal(result.code, 1)
  assert.doesNotMatch(result.comment, /secret raw response/)
})
test('HTTP failure writes sanitized status report', async t => {
  const result = await run(t, { fetchImpl: async () => ({ ok: false, status: 503 }) })
  assert.equal(result.code, 1)
  assert.match(result.comment, /HTTP 503/)
})
test('diff failure writes failure report', async t => {
  const result = await run(t, { readDiff: () => { throw new Error('git failed') } })
  assert.equal(result.code, 1)
  assert.match(result.comment, /Unable to read/)
})
test('invalid review shape is not considered a pass', async t => {
  const result = await run(t, { fetchImpl: async () => response({ summary: 'looks fine' }) })
  assert.equal(result.code, 1)
  assert.equal(result.report.status, 'error')
})
test('valid response creates success report with request timeout signal', async t => {
  const result = await run(t, { fetchImpl: async (url, request) => {
    assert.ok(request.signal instanceof AbortSignal)
    return response({ summary: 'Reviewed', issues: [] })
  } })
  assert.equal(result.code, 0)
  assert.equal(result.report.status, 'success')
  assert.match(result.comment, /No issues were found/)
})
test('blocking issue remains in report', async t => {
  const result = await run(t, { fetchImpl: async () => response({ summary: 'Fix needed', issues: [
    { severity: 'blocking', file: 'example.py', line: 2, description: 'Bug', suggestion: 'Fix' },
  ] }) })
  assert.equal(result.report.issues[0].severity, 'blocking')
  assert.match(result.comment, /Blocking issue/)
})
