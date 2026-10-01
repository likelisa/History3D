import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { importCollection } from '../processing/src/intake.ts'
import type { ProcessingFeedback } from '../contracts/src/handoff-types.ts'

const fixture = path.resolve('contracts/fixtures/handoff/collection')
const tempDirs: string[] = []
async function workspace() { const dir = await mkdtemp(path.join(os.tmpdir(), 'history3d-intake-')); tempDirs.push(dir); return dir }
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('collection import', () => {
  it('freezes the original package and returns the same receipt on retry', async () => {
    const dataDir = await workspace()
    const first = await importCollection(fixture, dataDir, 'fu-first')
    const second = await importCollection(fixture, dataDir, 'fu-first')
    expect(second).toEqual(first)
    expect(first.status).toBe('needs_input')
    const frozen = path.join(dataDir, 'imports', first.importId)
    const feedback = JSON.parse(await readFile(path.join(frozen, 'feedback', 'feedback.json'), 'utf8')) as ProcessingFeedback
    expect(feedback.informationRequests.length).toBeGreaterThan(0)
    expect(feedback.reviewRefs).toEqual([])
    expect(await readFile(path.join(frozen, 'source', 'assets', 'pack-bundle.glb'))).toEqual(await readFile(path.join(frozen, 'feedback', 'assets', 'pack-bundle.glb')))
  })

  it('rejects reuse of an idempotency key with different input', async () => {
    const dataDir = await workspace()
    const changed = await workspace()
    await cp(fixture, changed, { recursive: true })
    await importCollection(fixture, dataDir, 'shared-key')
    const handoffPath = path.join(changed, 'handoff.json')
    const handoff = JSON.parse(await readFile(handoffPath, 'utf8'))
    handoff.submissionId = 'different-submission'
    const planPath = path.join(changed, 'plan.md')
    await writeFile(planPath, `${await readFile(planPath, 'utf8')}\n新增待核要求。\n`)
    const bytes = await readFile(planPath)
    const entry = handoff.files.find((item: { path: string }) => item.path === 'plan.md')
    entry.bytes = bytes.length
    entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    await writeFile(handoffPath, JSON.stringify(handoff))
    await expect(importCollection(changed, dataDir, 'shared-key')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('does not replace a frozen submission with changed bytes under a new key', async () => {
    const dataDir = await workspace()
    const changed = await workspace()
    await cp(fixture, changed, { recursive: true })
    await importCollection(fixture, dataDir, 'key-a')
    const planPath = path.join(changed, 'plan.md')
    await writeFile(planPath, 'altered plan')
    const handoffPath = path.join(changed, 'handoff.json')
    const handoff = JSON.parse(await readFile(handoffPath, 'utf8'))
    const bytes = await readFile(planPath)
    const entry = handoff.files.find((item: { path: string }) => item.path === 'plan.md')
    entry.bytes = bytes.length
    entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    await writeFile(handoffPath, JSON.stringify(handoff))
    await expect(importCollection(changed, dataDir, 'key-b')).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' })
  })

  it('rejects an intermediate asset directory symlink even when target bytes match', async () => {
    const dataDir = await workspace()
    const changed = await workspace()
    await cp(fixture, changed, { recursive: true })
    await rm(path.join(changed, 'assets'), { recursive: true })
    await symlink(path.join(fixture, 'assets'), path.join(changed, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(importCollection(changed, dataDir, 'symlink-key')).rejects.toMatchObject({ code: 'COLLECTION_INVALID' })
  })

  it('keeps old issues open until a changed revision names the resolved issue', async () => {
    const dataDir = await workspace()
    const first = await importCollection(fixture, dataDir, 'initial')
    const prior = JSON.parse(await readFile(path.join(dataDir, first.feedbackPath, 'feedback.json'), 'utf8')) as ProcessingFeedback
    const relationIssue = prior.issues.find((issue) => issue.fieldPath.startsWith('relations['))!
    expect(relationIssue).toBeDefined()
    const revised = await workspace()
    await cp(fixture, revised, { recursive: true })
    const planPath = path.join(revised, 'plan.json')
    const plan = JSON.parse(await readFile(planPath, 'utf8'))
    plan.relations = []
    await writeFile(planPath, JSON.stringify(plan))
    const handoffPath = path.join(revised, 'handoff.json')
    const handoff = JSON.parse(await readFile(handoffPath, 'utf8'))
    handoff.submissionId = 'fixture-collection-002'
    handoff.supersedesSubmissionId = 'fixture-collection-001'
    const bytes = await readFile(planPath)
    const entry = handoff.files.find((item: { path: string }) => item.path === 'plan.json')
    entry.bytes = bytes.length
    entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    await writeFile(handoffPath, JSON.stringify(handoff))
    const unclaimed = await importCollection(revised, dataDir, 'revision-unclaimed')
    const pending = JSON.parse(await readFile(path.join(dataDir, unclaimed.feedbackPath, 'feedback.json'), 'utf8')) as ProcessingFeedback
    expect(pending.issues.find((issue) => issue.issueId === relationIssue.issueId)?.status).toBe('open')
    handoff.submissionId = 'fixture-collection-003'
    handoff.resolvesIssueIds = [relationIssue.issueId]
    await writeFile(handoffPath, JSON.stringify(handoff))
    const claimed = await importCollection(revised, dataDir, 'revision-claimed')
    const resolved = JSON.parse(await readFile(path.join(dataDir, claimed.feedbackPath, 'feedback.json'), 'utf8')) as ProcessingFeedback
    expect(resolved.issues.find((issue) => issue.issueId === relationIssue.issueId)?.status).toBe('resolved')
    expect(resolved.status).toBe('needs_review') // deterministic issues closed; mandatory AI review remains
  })
})
