import { TypeSafeJevJudge } from '../collector/src/jev.ts'

const key = process.env.TYPESAFE_API_KEY
if (!key) throw new Error('请在本地进程设置 TYPESAFE_API_KEY；不要把密钥放进命令、仓库或日志')

// Synthetic only: validates live authentication and response parsing, never sends user feedback.
const decision = await new TypeSafeJevJudge(key).judge({
  id: 'synthetic-smoke', claimId: 'synthetic-only',
  question: 'The sample museum is open on Mondays.',
  evidenceA: 'The sample museum is open on Mondays.',
  evidenceB: 'The sample museum is closed on Mondays.',
})
process.stdout.write(`Jev 协议响应已解析：model=${decision.model}; verdict=${decision.verdict}; confidence=${decision.confidence ?? 'n/a'}\n`)
