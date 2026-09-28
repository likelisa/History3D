import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { candidateSha256, publishCandidate, type PublicationApproval } from '../collector/src/output.ts'

const [command, directoryArg, revisionArg, approvalArg] = process.argv.slice(2)
if (!directoryArg || !['hash', 'publish'].includes(command)) {
  throw new Error('用法：npm run collector:publish -- hash <候选目录>；或 publish <候选目录> <基线版本> <批准文件.json>')
}
const directory = path.resolve(directoryArg)
if (command === 'hash') {
  if (revisionArg || approvalArg) throw new Error('hash 命令只接受一个候选目录')
  process.stdout.write(`${await candidateSha256(directory)}\n`)
} else {
  const expectedBase = Number(revisionArg)
  if (!Number.isSafeInteger(expectedBase) || expectedBase < 0 || !approvalArg) {
    throw new Error('publish 需要非负整数基线版本和批准文件')
  }
  const approval = JSON.parse(await readFile(path.resolve(approvalArg), 'utf8')) as PublicationApproval
  const output = await publishCandidate(path.resolve('collector'), directory, expectedBase, approval)
  process.stdout.write(`已发布资料包：${output}\n`)
}
