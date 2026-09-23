import path from 'node:path'
import process from 'node:process'

import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateScenePackage } from '../contracts/src/validate.ts'
import { printDiagnostics } from './report.ts'

const DEFAULT_DIR = path.join('packages', 'silk-road-demo')
const target = process.argv[2] ?? DEFAULT_DIR

const result = await validateScenePackage(createNodeReader(path.resolve(target)), {
  checkGlbBounds: true,
})
process.exit(printDiagnostics(target, result.diagnostics))
