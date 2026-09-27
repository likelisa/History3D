import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { hasBlockingError } from '../../contracts/src/diagnostics.ts'
import { createNodeReader } from '../../contracts/src/node-reader.ts'
import type { Claim, SourceEntry, SourcesFile, StoryFile } from '../../contracts/src/types.ts'
import { validateCollection, type PackageReader } from '../../contracts/src/validate.ts'
import type { CollectionCandidate, EvidenceCandidate } from './types.ts'

export type ClaimEdit =
  | { kind: 'add'; evidence: EvidenceCandidate }
  | { kind: 'replace'; previousClaimId: string; evidence: EvidenceCandidate }
  | { kind: 'withdraw'; previousClaimId: string; reason: string }

function rewriteRefs(story: StoryFile, oldId: string, newId: string | null): void {
  const update = (ids: string[]) => ids.flatMap((id) => id === oldId ? (newId ? [newId] : []) : [id])
  for (const brief of story.objectBriefs) brief.claimIds = update(brief.claimIds)
  for (const hotspot of story.hotspots) hotspot.claimIds = update(hotspot.claimIds)
}

export function buildCandidate(
  baseStory: StoryFile,
  baseSources: SourcesFile,
  edits: readonly ClaimEdit[],
  references: CollectionCandidate['references'],
): CollectionCandidate {
  if (baseStory.storyId !== baseSources.storyId || baseStory.contentRevision !== baseSources.contentRevision) {
    throw new Error('基线 story/sources 版本不一致')
  }
  if (edits.length === 0) throw new Error('没有确认的断言变更，不能生成新版本')
  const story = structuredClone(baseStory)
  const sources = structuredClone(baseSources)
  const changes: string[] = []
  for (const edit of edits) {
    if (edit.kind === 'withdraw') {
      const original = story.claims.find((claim) => claim.id === edit.previousClaimId)
      if (!original || !edit.reason.trim()) throw new Error('撤回断言不存在或缺少理由')
      story.claims = story.claims.filter((claim) => claim.id !== edit.previousClaimId)
      rewriteRefs(story, edit.previousClaimId, null)
      changes.push(`撤回 ${edit.previousClaimId}: ${edit.reason}`)
      continue
    }
    const next: Claim = structuredClone(edit.evidence.claim)
    const source: SourceEntry = structuredClone(edit.evidence.source)
    const existingSource = sources.sources.find((item) => item.id === source.id)
    if (existingSource && !isDeepStrictEqual(existingSource, source)) throw new Error(`来源 ID 冲突：${source.id}`)
    if (!existingSource) sources.sources.push(source)
    if (story.claims.some((claim) => claim.id === next.id)) throw new Error(`断言 ID 冲突：${next.id}`)
    if (edit.kind === 'replace') {
      if (!story.claims.some((claim) => claim.id === edit.previousClaimId)) throw new Error('替换的旧断言不存在')
      story.claims = story.claims.filter((claim) => claim.id !== edit.previousClaimId)
      rewriteRefs(story, edit.previousClaimId, next.id)
      changes.push(`替换 ${edit.previousClaimId} → ${next.id}`)
    } else {
      changes.push(`新增 ${next.id}`)
    }
    story.claims.push(next)
  }
  story.contentRevision += 1
  sources.contentRevision = story.contentRevision
  story.status = 'draft'
  return { story, sources, references, changes, unresolved: [] }
}

function validReferencePath(relPath: string): boolean {
  return /^references\/[A-Za-z0-9_./-]+$/.test(relPath) && !relPath.includes('..') && !relPath.includes('//')
}

export async function validateCandidate(candidate: CollectionCandidate): Promise<void> {
  const files = new Map<string, Uint8Array>()
  files.set('story.json', Buffer.from(JSON.stringify(candidate.story)))
  files.set('sources.json', Buffer.from(JSON.stringify(candidate.sources)))
  for (const item of candidate.references) {
    if (!validReferencePath(item.path) || files.has(item.path)) throw new Error(`非法或重复的素材路径：${item.path}`)
    files.set(item.path, item.bytes)
  }
  if (!validReferencePath(candidate.story.routeOverview.imagePath)) throw new Error('路线图必须位于 references/')
  for (const source of candidate.sources.sources) {
    if (source.locator.localPath && !validReferencePath(source.locator.localPath)) throw new Error('本地来源必须位于 references/')
  }
  const reader: PackageReader = {
    async readText(relPath) { const bytes = files.get(relPath); return bytes ? Buffer.from(bytes).toString('utf8') : null },
    async readBinary(relPath) { const bytes = files.get(relPath); return bytes ? Uint8Array.from(bytes).buffer : null },
    async exists(relPath) { return files.has(relPath) },
  }
  const result = await validateCollection(reader)
  if (hasBlockingError(result.diagnostics)) {
    throw new Error(`候选包未通过契约校验：${result.diagnostics.map((item) => `${item.code}:${item.field}`).join(', ')}`)
  }
}

export async function writeCandidate(root: string, candidate: CollectionCandidate): Promise<string> {
  await validateCandidate(candidate)
  const directory = path.join(root, 'candidates', randomUUID(), candidate.story.storyId)
  await mkdir(path.join(directory, 'references'), { recursive: true })
  await writeFile(path.join(directory, 'story.json'), `${JSON.stringify(candidate.story, null, 2)}\n`, 'utf8')
  await writeFile(path.join(directory, 'sources.json'), `${JSON.stringify(candidate.sources, null, 2)}\n`, 'utf8')
  for (const item of candidate.references) {
    const target = path.join(directory, ...item.path.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, item.bytes)
  }
  return directory
}

export interface PublicationApproval {
  reviewer: string
  reviewedAt: string
  storyId: string
  candidateRevision: number
  expectedBaseRevision: number
  candidateSha256: string
  evidenceRef: string
}

async function assertExactFiles(directory: string, expected: ReadonlySet<string>): Promise<void> {
  const actual = new Set<string>()
  const visit = async (subdir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(subdir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(path.join(subdir, entry.name), relative)
      else if (entry.isFile()) actual.add(relative)
      else throw new Error('候选包包含非普通文件或符号链接')
    }
  }
  await visit(directory, '')
  if (actual.size !== expected.size || [...actual].some((file) => !expected.has(file))) {
    throw new Error('候选包包含未引用文件或缺少交接文件')
  }
}

/** Hash the exact public handoff bytes, including referenced material, without including private review notes. */
export async function candidateSha256(directory: string): Promise<string> {
  const verified = await validateCollection(createNodeReader(directory))
  if (hasBlockingError(verified.diagnostics) || !verified.story || !verified.sources) throw new Error('候选包校验失败')
  const refs = new Set<string>([verified.story.routeOverview.imagePath])
  for (const source of verified.sources.sources) if (source.locator.localPath) refs.add(source.locator.localPath)
  const files = ['story.json', 'sources.json', ...refs].sort()
  await assertExactFiles(directory, new Set(files))
  const reader = createNodeReader(directory)
  const hash = createHash('sha256')
  for (const file of files) {
    const content = await reader.readBinary(file)
    if (!content) throw new Error('候选包缺少交接文件')
    hash.update(file).update('\0').update(String(content.byteLength)).update('\0').update(Buffer.from(content))
  }
  return hash.digest('hex')
}

/** 持有独占锁、对照当前基线；旧版归档而非删除，失败尝试回滚。 */
export async function publishCandidate(root: string, candidateDirectory: string, expectedBaseRevision: number, approval?: PublicationApproval): Promise<string> {
  if (!approval || !approval.reviewer.trim() || !Number.isFinite(Date.parse(approval.reviewedAt)) ||
      !approval.evidenceRef.trim() || !/^[a-f0-9]{64}$/.test(approval.candidateSha256)) {
    throw new Error('缺少有效的人工发布批准与候选摘要')
  }
  const candidatesRoot = path.resolve(root, 'candidates')
  const candidatePath = path.resolve(candidateDirectory)
  const relative = path.relative(candidatesRoot, candidatePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('候选包不在受控目录中')
  }
  // A symlinked candidate root could validate one real directory and then publish
  // a pointer outside the controlled tree. Reject that before acquiring the lock.
  if (!(await lstat(candidatePath)).isDirectory() ||
      !(await realpath(candidatePath)).startsWith(`${await realpath(candidatesRoot)}${path.sep}`)) {
    throw new Error('候选包不是受控目录')
  }
  const lockPath = path.join(root, '.publish.lock')
  await mkdir(root, { recursive: true })
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    throw new Error(`发布锁已存在：${lockPath}。若上次发布中断，请先确认没有发布进程，再手动移走此锁文件并重试。`)
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), 'utf8')
    const verified = await validateCollection(createNodeReader(candidatePath))
    if (hasBlockingError(verified.diagnostics) || !verified.story || !verified.sources) throw new Error('候选包校验失败')
    const storyId = verified.story.storyId
    if (path.basename(candidatePath) !== storyId) throw new Error('候选目录与 storyId 不一致')
    if (approval.storyId !== storyId || approval.candidateRevision !== verified.story.contentRevision ||
        approval.expectedBaseRevision !== expectedBaseRevision || approval.candidateSha256 !== await candidateSha256(candidatePath)) {
      throw new Error('发布批准与候选包或基线不匹配')
    }
    const output = path.join(root, 'output', storyId)
    const current = await validateCollection(createNodeReader(output))
    const hasCurrent = current.story !== null && current.sources !== null
    if (hasCurrent) {
      if (hasBlockingError(current.diagnostics)) throw new Error('当前发布包已损坏，需人工处理')
      if (current.story!.contentRevision !== expectedBaseRevision) throw new Error('发布基线已变化，需要重新采集')
      if (verified.story.contentRevision !== expectedBaseRevision + 1) throw new Error('候选版本不是基线的下一版')
    } else if (expectedBaseRevision !== 0 || verified.story.contentRevision !== 1) {
      throw new Error('首版发布基线或候选版本不正确')
    }
    await mkdir(path.dirname(output), { recursive: true })
    let archived: string | null = null
    if (hasCurrent) {
      archived = path.join(root, 'archive', `${storyId}-r${expectedBaseRevision}-${randomUUID()}`)
      await mkdir(path.dirname(archived), { recursive: true })
      await rename(output, archived)
    }
    try { await rename(candidatePath, output) }
    catch (error) {
      if (archived) await rename(archived, output)
      throw error
    }
    return output
  } finally {
    await lock.close()
    await (await import('node:fs/promises')).unlink(lockPath)
  }
}

export async function readReferences(root: string, story: StoryFile, sources: SourcesFile): Promise<CollectionCandidate['references']> {
  const paths = new Set<string>([story.routeOverview.imagePath])
  for (const source of sources.sources) if (source.locator.localPath) paths.add(source.locator.localPath)
  const result: CollectionCandidate['references'] = []
  for (const relPath of paths) {
    if (!validReferencePath(relPath)) throw new Error(`基线包含非法素材路径：${relPath}`)
    result.push({ path: relPath, bytes: await readFile(path.join(root, ...relPath.split('/'))) })
  }
  return result
}
