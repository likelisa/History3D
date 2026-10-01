import { bookScenes, lineInScene } from './book-content.ts'
export interface BookProgress { scene: number; line: string; furthest: number; read: string[]; complete: boolean }
export function freshBook(): BookProgress { return { scene: 0, line: bookScenes[0]!.start, furthest: 0, read: [], complete: false } }
export function restoreBook(value: unknown): BookProgress {
  if (!value || typeof value !== 'object') return freshBook()
  const p = value as Partial<BookProgress>
  const all = new Set(bookScenes.flatMap((scene) => scene.lines.map((line) => line.id)))
  if (!Number.isInteger(p.scene) || !Number.isInteger(p.furthest) || p.scene! < 0 || p.furthest! < p.scene! || p.furthest! >= bookScenes.length || !lineInScene(p.scene!, p.line ?? '') || !Array.isArray(p.read) || p.read.some((id) => !all.has(id)) || typeof p.complete !== 'boolean') return freshBook()
  return { scene: p.scene!, line: p.line!, furthest: p.furthest!, read: [...new Set(p.read)], complete: p.complete }
}
export function nextLine(p: BookProgress, choiceId?: string): BookProgress {
  const current = lineInScene(p.scene, p.line)!
  const next = current.choices ? current.choices.find((choice) => choice.id === choiceId)?.next : current.next
  if (!next || !lineInScene(p.scene, next)) return p
  return { ...p, line: next, read: [...new Set([...p.read, current.id])] }
}
export function turnToScene(p: BookProgress, scene: number): BookProgress {
  if (!Number.isInteger(scene) || scene < 0 || scene >= bookScenes.length || scene > p.furthest + 1) return p
  const current = lineInScene(p.scene, p.line)!
  if (scene > p.furthest && (current.next || current.choices)) return p
  return { ...p, scene, line: bookScenes[scene]!.start, furthest: Math.max(p.furthest, scene), read: [...new Set([...p.read, current.id])] }
}
