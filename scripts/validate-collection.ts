import path from 'node:path'
import process from 'node:process'

import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollection } from '../contracts/src/validate.ts'
import { printDiagnostics } from './report.ts'

const DEFAULT_DIR = path.join('contracts', 'fixtures', 'collection', 'silk-road-demo')
const target = process.argv[2] ?? DEFAULT_DIR

const result = await validateCollection(createNodeReader(path.resolve(target)))
process.exit(printDiagnostics(target, result.diagnostics))
