/** PROCESSING_PYTHON permits an explicit installed runtime; Windows has no /usr/bin. */
export function processingPython(): string {
  return process.env.PROCESSING_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
}
