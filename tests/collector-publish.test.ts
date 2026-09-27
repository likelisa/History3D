import { cp, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildCandidate, candidateSha256, publishCandidate, readReferences, writeCandidate } from '../collector/src/output.ts'
import type { SourcesFile, StoryFile } from '../contracts/src/types.ts'

async function sample() {
  const fixture = path.resolve('contracts/fixtures/collection/silk-road-demo')
  const root = await mkdtemp(path.join(os.tmpdir(), 'history3d-publish-'))
  await mkdir(path.join(root, 'output'), { recursive: true })
  await cp(fixture, path.join(root, 'output', 'silk-road-demo'), { recursive: true })
  const story = JSON.parse(await readFile(path.join(fixture, 'story.json'), 'utf8')) as StoryFile
  const sources = JSON.parse(await readFile(path.join(fixture, 'sources.json'), 'utf8')) as SourcesFile
  const references = await readReferences(fixture, story, sources)
  const candidate = buildCandidate(story, sources, [{ kind: 'withdraw', previousClaimId: story.claims[0].id, reason: 'synthetic withdrawal' }], references)
  const directory = await writeCandidate(root, candidate)
  return { root, directory, candidate }
}

describe('候选包受控发布', () => {
  it('没有人工发布批准不能把候选包交给 B', async () => {
    const { root, directory, candidate } = await sample()
    await expect(publishCandidate(root, directory, 1)).rejects.toThrow('批准')
    const stillPublished = JSON.parse(await readFile(path.join(root, 'output', candidate.story.storyId, 'story.json'), 'utf8')) as StoryFile
    expect(stillPublished.contentRevision).toBe(1)
  })

  it('具名批准绑定候选版本与基线后，完整目录原子发布；重发或版本错配被拒', async () => {
    const { root, directory, candidate } = await sample()
    const approval = { reviewer: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      storyId: candidate.story.storyId, candidateRevision: candidate.story.contentRevision,
      expectedBaseRevision: 1, evidenceRef: 'synthetic-approval-record', candidateSha256: await candidateSha256(directory) }
    await expect(publishCandidate(root, directory, 0, approval)).rejects.toThrow('基线')
    const published = await publishCandidate(root, directory, 1, approval)
    expect(published).toBe(path.join(root, 'output', candidate.story.storyId))
    expect(JSON.parse(await readFile(path.join(published, 'story.json'), 'utf8')).contentRevision).toBe(2)
    expect(JSON.parse(await readFile(path.join(published, 'sources.json'), 'utf8')).contentRevision).toBe(2)
    expect(await stat(path.join(published, 'references', 'route-overview.svg'))).toBeTruthy()
    await expect(publishCandidate(root, published, 1, approval)).rejects.toThrow('候选')
  })

  it('候选目录夹带未引用文件、或批准后字节变化均不得发布', async () => {
    const { root, directory, candidate } = await sample()
    const approval = { reviewer: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      storyId: candidate.story.storyId, candidateRevision: candidate.story.contentRevision,
      expectedBaseRevision: 1, evidenceRef: 'synthetic-approval-record', candidateSha256: await candidateSha256(directory) }
    await writeFile(path.join(directory, 'private-note.txt'), 'synthetic private note')
    await expect(publishCandidate(root, directory, 1, approval)).rejects.toThrow('未引用')
    const stillPublished = JSON.parse(await readFile(path.join(root, 'output', candidate.story.storyId, 'story.json'), 'utf8')) as StoryFile
    expect(stillPublished.contentRevision).toBe(1)
  })

  it('上次发布残留的锁给出可操作的恢复提示，清理后可重试', async () => {
    const { root, directory, candidate } = await sample()
    const approval = { reviewer: 'synthetic-reviewer', reviewedAt: '2026-09-25T00:00:00Z',
      storyId: candidate.story.storyId, candidateRevision: candidate.story.contentRevision,
      expectedBaseRevision: 1, evidenceRef: 'synthetic-approval-record', candidateSha256: await candidateSha256(directory) }
    const lockPath = path.join(root, '.publish.lock')
    await writeFile(lockPath, JSON.stringify({ pid: 999999, acquiredAt: '2026-09-25T00:00:00Z' }))
    await expect(publishCandidate(root, directory, 1, approval)).rejects.toThrow('先确认没有发布进程')
    expect(await readFile(lockPath, 'utf8')).toContain('999999')
    await unlink(lockPath)
    await publishCandidate(root, directory, 1, approval)
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
