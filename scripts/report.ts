import { hasBlockingError, sortDiagnostics } from '../contracts/src/diagnostics.ts'
import type { Diagnostic } from '../contracts/src/diagnostics.ts'

/** 打印诊断并按是否存在阻塞错误返回退出码。 */
export function printDiagnostics(target: string, diagnostics: readonly Diagnostic[]): number {
  const sorted = sortDiagnostics(diagnostics)
  const errors = sorted.filter((item) => item.severity === 'error')
  const warnings = sorted.filter((item) => item.severity === 'warning')

  process.stdout.write(`\n校验对象：${target}\n`)
  if (sorted.length === 0) {
    process.stdout.write('✓ 未发现问题\n')
    return 0
  }

  for (const item of sorted) {
    const marker = item.severity === 'error' ? '✗' : '!'
    const location = item.field ? `${item.file}#${item.field}` : item.file
    process.stdout.write(`${marker} [${item.code}] ${location}\n    ${item.message}\n`)
  }
  process.stdout.write(`\n共 ${errors.length} 个错误、${warnings.length} 个警告\n`)
  return hasBlockingError(sorted) ? 1 : 0
}
