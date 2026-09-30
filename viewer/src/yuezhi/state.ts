export type Prediction = 'accept' | 'decline' | 'skip'
export interface Progress { chapter: number; furthest: number; clues: string[]; prediction: Prediction | null; completed: boolean }
export const freshProgress = (): Progress => ({ chapter: 0, furthest: 0, clues: [], prediction: null, completed: false })
export function readProgress(value: unknown): Progress {
  if (!value || typeof value !== 'object') return freshProgress()
  const p = value as Partial<Progress>
  if (!Number.isInteger(p.chapter) || !Number.isInteger(p.furthest) || p.chapter! < 0 || p.chapter! > 2 || p.furthest! < p.chapter! || p.furthest! > 2 || !Array.isArray(p.clues) || p.clues.some((id) => !['settled', 'distance', 'past'].includes(id)) || ![null, 'accept', 'decline', 'skip'].includes(p.prediction ?? null) || typeof p.completed !== 'boolean') return freshProgress()
  return { chapter: p.chapter!, furthest: p.furthest!, clues: [...new Set(p.clues)], prediction: p.prediction ?? null, completed: p.completed }
}
export function advance(p: Progress): Progress {
  const chapter = Math.min(2, p.chapter + 1)
  return { ...p, chapter, furthest: Math.max(p.furthest, chapter) }
}
