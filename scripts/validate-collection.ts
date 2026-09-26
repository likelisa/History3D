import path from 'node:path'
import process from 'node:process'

import { errorDiagnostic } from '../contracts/src/diagnostics.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollection } from '../contracts/src/validate.ts'
import { printDiagnostics } from './report.ts'

const DEFAULT_DIR = path.join('contracts', 'fixtures', 'collection', 'silk-road-demo')
const target = process.argv[2] ?? DEFAULT_DIR

const directory = path.resolve(target)
const result = await validateCollection(createNodeReader(directory))
if (result.story && path.basename(directory) !== result.story.storyId) {
  result.diagnostics.push(errorDiagnostic(
    'VALIDATION_FAILED',
    'story.json',
    'storyId',
    `包目录名 ${path.basename(directory)} 与 storyId ${result.story.storyId} 不一致`,
  ))
}
process.exit(printDiagnostics(target, result.diagnostics))
