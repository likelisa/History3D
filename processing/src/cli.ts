import path from 'node:path'
import { importCollection } from './intake.ts'
import { revalidateSavedInputReview, runInputReview } from './review/orchestrator.ts'
import { buildWorldRelease } from './world-compile.ts'
import { prepareReleasePreview } from './preview.ts'
import { revalidateSavedWorldReview, runWorldReview } from './review/world-review.ts'

const [command, input, key] = process.argv.slice(2)
const dataDir = path.resolve(process.env.PROCESSING_DATA_DIR ?? '.processing-data')
if (command === 'review-input' && input) {
  try { console.log(JSON.stringify(await runInputReview(input, dataDir), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command === 'revalidate-review' && input && key && process.argv[5]) {
  try { console.log(JSON.stringify(await revalidateSavedInputReview(input, key, dataDir, Number(process.argv[5])), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command === 'build-release' && input && key) {
  try { console.log(JSON.stringify(await buildWorldRelease(input, path.resolve(key), dataDir, process.cwd()), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command === 'preview-release' && input && key) {
  try { console.log(await prepareReleasePreview(input, key, dataDir, process.cwd())) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command === 'review-world' && input && key && process.argv[5]) {
  try { console.log(JSON.stringify(await runWorldReview(input, key, path.resolve(process.argv[5]), dataDir), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command === 'revalidate-world' && input && key && process.argv[5] && process.argv[6]) {
  try { console.log(JSON.stringify(await revalidateSavedWorldReview(input, key, process.argv[5], dataDir, Number(process.argv[6])), null, 2)) }
  catch (error) { console.error(error); process.exitCode = 1 }
} else if (command !== 'import' || !input || !key) {
  console.error('usage: npm run processing -- import <collection-dir> <idempotency-key> | review-input <importId> | revalidate-review <importId> <assetId> <attempt> | build-release <importId> <world-plan.json> | preview-release <storyId> <releaseId> | review-world <storyId> <releaseId> <world-plan.json> | revalidate-world <storyId> <releaseId> <reviewId> <attempt>')
  process.exitCode = 2
} else {
  try {
    const receipt = await importCollection(path.resolve(input), dataDir, key)
    const reviews = await runInputReview(receipt.importId, dataDir)
    console.log(JSON.stringify({ ...receipt, reviews }, null, 2))
  }
  catch (error) { console.error(error); process.exitCode = 1 }
}
