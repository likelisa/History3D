import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { importCollection } from './intake.ts'
import { revalidateSavedInputReview, runInputReview } from './review/orchestrator.ts'
import { buildWorldRelease } from './world-compile.ts'
import { prepareReleasePreview } from './preview.ts'
import { reviewViewerPatch } from './asset-patch.ts'
import { revalidateSavedWorldReview, runWorldReview } from './review/world-review.ts'
import { revalidateSavedAssetReview, runAssetReview } from './review/asset-review.ts'

const dataDir = path.resolve(process.env.PROCESSING_DATA_DIR ?? '.processing-data')
const [command, ...args] = process.argv.slice(2)
const arity: Record<string, number> = {
  import: 2, 'review-input': 1, 'revalidate-review': 3,
  'build-release': 2, 'preview-release': 2, 'review-world': 3,
  'revalidate-world': 4, 'review-patch': 1,
  'review-asset': 1,
  'revalidate-asset': 3,
}
const usage = 'usage: npm run processing -- import <collection-dir> <idempotency-key> | review-input <importId> | review-asset <taskId> | revalidate-asset <taskId> <reviewId> <attempt> | revalidate-review <importId> <assetId> <attempt> | build-release <importId> <world-plan.json> | preview-release <storyId> <releaseId> | review-world <storyId> <releaseId> <world-plan.json> | revalidate-world <storyId> <releaseId> <reviewId> <attempt> | review-patch <decision.json>'

function positiveAttempt(value: string): number {
  const attempt = Number(value)
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer')
  return attempt
}
async function existingFile(value: string): Promise<string> {
  const file = path.resolve(value)
  if (!(await stat(file)).isFile()) throw new Error(`not a regular file: ${file}`)
  return file
}

if (!command || arity[command] !== args.length) {
  console.error(usage)
  process.exitCode = 2
} else {
  try {
    let output: unknown
    switch (command) {
      case 'import': {
        const receipt = await importCollection(path.resolve(args[0]), dataDir, args[1])
        output = { ...receipt, reviews: await runInputReview(receipt.importId, dataDir) }
        break
      }
      case 'review-input': output = await runInputReview(args[0], dataDir); break
      case 'review-asset': output = await runAssetReview(args[0], dataDir); break
      case 'revalidate-asset': output = await revalidateSavedAssetReview(args[0], args[1], dataDir, positiveAttempt(args[2])); break
      case 'revalidate-review': output = await revalidateSavedInputReview(args[0], args[1], dataDir, positiveAttempt(args[2])); break
      case 'build-release': output = await buildWorldRelease(args[0], await existingFile(args[1]), dataDir, process.cwd()); break
      case 'preview-release': output = await prepareReleasePreview(args[0], args[1], dataDir, process.cwd()); break
      case 'review-world': output = await runWorldReview(args[0], args[1], await existingFile(args[2]), dataDir); break
      case 'revalidate-world': output = await revalidateSavedWorldReview(args[0], args[1], args[2], dataDir, positiveAttempt(args[3])); break
      case 'review-patch': output = await reviewViewerPatch(JSON.parse(await readFile(await existingFile(args[0]), 'utf8')), dataDir); break
    }
    console.log(typeof output === 'string' ? output : JSON.stringify(output, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
