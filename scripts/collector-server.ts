import path from 'node:path'

import { hasBlockingError } from '../contracts/src/diagnostics.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollection } from '../contracts/src/validate.ts'
import { createCollectorServer } from '../collector/src/server.ts'
import { CollectorCoordinator } from '../collector/src/coordinator.ts'
import { CollectorStore } from '../collector/src/store.ts'

const port = Number(process.env.COLLECTOR_PORT ?? 5188)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('COLLECTOR_PORT 无效')
const root = path.resolve('collector')
const demoFixture = process.argv.includes('--demo')
  ? path.resolve('contracts/fixtures/collection/silk-road-demo')
  : undefined

const store = new CollectorStore(root)
const coordinator = new CollectorCoordinator(root, store)
const recovered = await coordinator.recoverQueued(async (storyId) => {
  const output = path.join(root, 'output', storyId)
  for (const directory of [output, demoFixture].filter((item): item is string => Boolean(item))) {
    const loaded = await validateCollection(createNodeReader(directory))
    if (!hasBlockingError(loaded.diagnostics) && loaded.story?.storyId === storyId && loaded.sources) {
      return { story: loaded.story, sources: loaded.sources, directory }
    }
  }
  return null
})
createCollectorServer({ root, demoFixture, store, coordinator }).listen(port, '127.0.0.1', () => {
  process.stdout.write(`采集反馈页面：http://127.0.0.1:${port}/\n`)
  if (recovered) process.stdout.write(`已恢复 ${recovered} 条上次中断的采集修订；状态可在本机查询。\n`)
})
