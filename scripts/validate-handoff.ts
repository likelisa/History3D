import path from 'node:path'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateCollectionHandoff } from '../contracts/src/handoff-validate.ts'

const target = path.resolve(process.argv[2] ?? 'contracts/fixtures/handoff/collection')
const problems = await validateCollectionHandoff(createNodeReader(target))
for (const problem of problems) console.error(`${problem.path}: ${problem.message}`)
if (problems.length) process.exitCode = 1
else console.log(`collection handoff valid: ${target}`)
