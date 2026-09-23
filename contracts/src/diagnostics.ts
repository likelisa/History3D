export type DiagnosticCode =
  | 'PACKAGE_FETCH_FAILED'
  | 'SCHEMA_UNSUPPORTED'
  | 'VALIDATION_FAILED'
  | 'REVISION_MISMATCH'
  | 'REFERENCE_MISSING'
  | 'ASSET_LOAD_FAILED'
  | 'OPTIONAL_IMAGE_FAILED'
  | 'SOURCE_OFFLINE'

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  code: DiagnosticCode
  severity: Severity
  file: string
  field: string
  message: string
}

export const SUPPORTED_SCHEMA_VERSION = '0.1.0'

export function errorDiagnostic(
  code: DiagnosticCode,
  file: string,
  field: string,
  message: string,
): Diagnostic {
  return { code, severity: 'error', file, field, message }
}

export function warningDiagnostic(
  code: DiagnosticCode,
  file: string,
  field: string,
  message: string,
): Diagnostic {
  return { code, severity: 'warning', file, field, message }
}

export function hasBlockingError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return a.field < b.field ? -1 : a.field > b.field ? 1 : 0
  })
}
