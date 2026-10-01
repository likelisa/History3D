import path from 'node:path'
import { auditYuezhiPackage } from '../processing/src/yuezhi-package.ts'

const output = path.resolve(process.argv[2] ?? 'packages/zhang-qian-yuezhi')
const collection = path.resolve(process.argv[3] ?? 'collector/deliveries/zhang-qian-yuezhi')
const result = await auditYuezhiPackage(output, collection)
for (const error of result.errors) console.error(error)
console.log(JSON.stringify(result, null, 2))
process.exitCode = result.ok ? 0 : 1
