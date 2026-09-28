import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

import { runSearch, type SearchProvider } from '../collector/src/search.ts'
import type { SearchPlan } from '../collector/src/types.ts'
import type { StoryFile } from '../contracts/src/types.ts'

it('张骞待批准计划恰好列出五个接收方配对，未有批准记录时零公共调用', async () => {
  const root = path.resolve('collector/experiments')
  const plan = JSON.parse(await readFile(path.join(root, 'zhang-qian-yuezhi-search-plan.proposed.json'), 'utf8')) as SearchPlan
  const story = JSON.parse(await readFile(path.join(root, 'zhang-qian-yuezhi-pilot/story.json'), 'utf8')) as StoryFile
  expect([plan.storyId, plan.baseRevision]).toEqual([story.storyId, story.contentRevision])
  expect(plan.queries.map((query) => [query.id, query.text, query.providerIds])).toEqual([
    ['q-1', '张骞 大月氏 竟不能得月氏要领 史记 汉书', ['wikipedia-zh']],
    ['q-2', 'Zhang Qian Yuezhi mission alliance Xiongnu', ['openalex', 'crossref', 'wikipedia-en']],
    ['q-3', '史记 太子 汉书 夫人 大月氏 异文', ['wikipedia-zh']],
  ])
  let calls = 0
  const providers: SearchProvider[] = ['wikipedia-zh', 'openalex', 'crossref', 'wikipedia-en'].map((id) => ({
    id, sourceTypes: ['website'], async search() { calls += 1; return [] },
  }))
  await expect(runSearch(plan, providers)).rejects.toThrow('人工审核')
  expect(calls).toBe(0)
})
