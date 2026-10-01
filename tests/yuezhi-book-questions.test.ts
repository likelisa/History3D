import { describe, expect, it } from 'vitest'
import { bookScenes, lineInScene } from '../viewer/src/yuezhi/book-content.ts'
import type { BookLine } from '../viewer/src/yuezhi/book-content.ts'
import { freshBook, nextLine, restoreBook, turnToScene } from '../viewer/src/yuezhi/book-state.ts'
import type { BookProgress } from '../viewer/src/yuezhi/book-state.ts'
import { REVISION, sources } from '../viewer/src/yuezhi/content.ts'

const originalEnds = ['arrival-6', 'meeting-5', 'waiting-5', 'market-6']
const questionCounts = [1, 1, 1, 2]
const retiredNodes = [
  'arrival-question-concerns', 'arrival-current-life', 'arrival-han-distance',
  'meeting-question-priorities', 'meeting-guard-stability', 'meeting-consider-distance',
  'waiting-question-observation', 'waiting-see-market', 'waiting-see-goods',
  'arrival-settled-life', 'arrival-herding-life',
  'market-question-origin', 'market-shendu-purchase', 'market-shu-origin',
]
const originalIds = [
  ['arrival-1', 'arrival-2', 'arrival-3', 'arrival-4', 'arrival-5', 'arrival-6'],
  ['meeting-1', 'meeting-2', 'meeting-3', 'meeting-grievance', 'meeting-distance', 'meeting-4', 'meeting-5'],
  ['waiting-1', 'waiting-2', 'waiting-3', 'waiting-4', 'waiting-5'],
  ['market-1', 'market-2', 'market-cloth', 'market-bamboo', 'market-3', 'market-4', 'market-5', 'market-6'],
]
const joins: Record<string, string> = {
  'arrival-question-life': 'arrival-3',
  'meeting-3': 'meeting-4',
  'waiting-question-region': 'waiting-3',
  'market-2': 'market-3',
  'market-question-shendu': 'market-4',
}

function pathsInScene(scene: number, id = bookScenes[scene]!.start, ancestors = new Set<string>()): BookLine[][] {
  if (ancestors.has(id)) throw new Error(`Dialogue cycle at ${id}`)
  const line = lineInScene(scene, id)
  if (!line) throw new Error(`Unknown dialogue line ${id}`)
  const successors = line.choices?.map(choice => choice.next) ?? (line.next ? [line.next] : [])
  if (!successors.length) return [[line]]
  const visited = new Set([...ancestors, id])
  return successors.flatMap(next => pathsInScene(scene, next, visited).map(path => [line, ...path]))
}

function readPath(progress: BookProgress, path: BookLine[]): BookProgress {
  let current = progress
  for (let index = 0; index < path.length - 1; index++) {
    const line = path[index]!, target = path[index + 1]!
    expect(current.line).toBe(line.id)
    // A displayed question must wait for a selected question; it is not auto-answered.
    if (line.choices) {
      expect(nextLine(current)).toBe(current)
      expect(nextLine(current, 'unknown-question')).toBe(current)
    }
    const chosen = line.choices?.find(choice => choice.next === target.id)
    const next = nextLine(current, chosen?.id)
    expect(next.line).toBe(target.id)
    expect(next.scene).toBe(current.scene)
    expect(next.read).toContain(line.id)
    current = next
  }
  return current
}

describe('expanded questions in the original dialogue book', () => {
  it('uses revision 4 and preserves the original book with scene-specific questions instead of a fixed quota', () => {
    expect(REVISION).toBe(4)
    expect(bookScenes.map(scene => scene.id)).toEqual(['arrival', 'meeting', 'waiting', 'market'])
    expect(bookScenes.map(scene => scene.start)).toEqual(['arrival-1', 'meeting-1', 'waiting-1', 'market-1'])
    expect(bookScenes.flatMap(scene => scene.lines)).toHaveLength(35)
    for (const retired of retiredNodes) expect(bookScenes.flatMap(scene => scene.lines.map(line => line.id))).not.toContain(retired)
    for (const [index, scene] of bookScenes.entries()) {
      const ids = scene.lines.map(line => line.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of originalIds[index]!) expect(ids).toContain(id)
      const questions = scene.lines.filter(line => line.choices)
      expect(questions).toHaveLength(questionCounts[index]!)
      for (const question of questions) {
        expect(question.choices).toHaveLength(2)
        expect(question.speaker).toBe('envoy')
        expect(question.next).toBeUndefined()
        expect(new Set(question.choices!.map(choice => choice.id)).size).toBe(2)
        expect(new Set(question.choices!.map(choice => choice.text)).size).toBe(2)
        for (const key of ['score', 'correctOptionId', 'clueIds', 'unlocked']) expect(question).not.toHaveProperty(key)
      }
    }
    expect(bookScenes.flatMap(scene => scene.lines.filter(line => line.choices))).toHaveLength(5)
    expect(bookScenes.flatMap(scene => scene.lines.flatMap(line => line.choices ?? []))).toHaveLength(10)
  })

  it('has a reachable, acyclic graph with every branch ending at its original page ending', () => {
    for (const [index, scene] of bookScenes.entries()) {
      const paths = pathsInScene(index)
      expect(paths).toHaveLength(2 ** questionCounts[index]!)
      const reachable = new Set(paths.flatMap(path => path.map(line => line.id)))
      expect([...reachable].sort()).toEqual(scene.lines.map(line => line.id).sort())
      for (const path of paths) {
        expect(path.at(-1)!.id).toBe(originalEnds[index])
        expect(path.filter(line => line.choices)).toHaveLength(questionCounts[index]!)
      }
      expect(scene.lines.filter(line => !line.next && !line.choices).map(line => line.id)).toEqual([originalEnds[index]])
    }
  })

  it('answers each selected question through the person present and rejoins the original main line', () => {
    for (const [index, scene] of bookScenes.entries()) for (const question of scene.lines.filter(line => line.choices)) {
      const replies = question.choices!.map(choice => lineInScene(index, choice.next)!)
      expect(replies).toHaveLength(2)
      expect(replies[0]!.text).not.toBe(replies[1]!.text)
      for (const reply of replies) {
        expect(reply.speaker).toBe(scene.partner)
        expect(reply.choices).toBeUndefined()
        expect(reply.next).toBe(joins[question.id])
        expect(reply.sourceIds.length).toBeGreaterThan(0)
      }
      const progress = { ...freshBook(), scene: index, furthest: index, line: question.id }
      expect(turnToScene(progress, index + 1)).toBe(progress)
      for (const choice of question.choices!) {
        const answered = nextLine(progress, choice.id)
        expect(answered.line).toBe(choice.next)
        expect(nextLine(answered).line).toBe(joins[question.id])
      }
    }
  })

  it('keeps the original two choices and response merges available at their original IDs', () => {
    expect(lineInScene(1, 'meeting-3')!.choices!.map(choice => choice.id)).toEqual(['grievance', 'distance'])
    expect(lineInScene(3, 'market-2')!.choices!.map(choice => choice.id)).toEqual(['cloth', 'bamboo'])
    for (const choice of ['grievance', 'distance']) {
      const originalQuestion = { ...freshBook(), scene: 1, furthest: 1, line: 'meeting-3' }
      expect(nextLine(nextLine(originalQuestion, choice)).line).toBe('meeting-4')
    }
    for (const choice of ['cloth', 'bamboo']) {
      const originalQuestion = { ...freshBook(), scene: 3, furthest: 3, line: 'market-2' }
      expect(nextLine(nextLine(originalQuestion, choice)).line).toBe('market-3')
    }
  })

  it('can complete the whole story for all 32 combinations of questions through the normal book-state API', () => {
    const paths = bookScenes.map((_, index) => pathsInScene(index))
    let combinations = 0
    function readFromScene(scene: number, progress: BookProgress): void {
      for (const path of paths[scene]!) {
        const finished = readPath(progress, path)
        expect(finished.line).toBe(originalEnds[scene])
        expect(restoreBook(JSON.parse(JSON.stringify(finished)))).toEqual(finished)
        if (scene === bookScenes.length - 1) {
          combinations++
          expect(finished.furthest).toBe(3)
          expect(finished.read).toContain('meeting-4')
          expect(finished.read).toContain('meeting-5')
          expect(finished.read).toContain('market-5')
          expect(nextLine(finished)).toBe(finished)
        } else {
          const nextPage = turnToScene(finished, scene + 1)
          expect(nextPage.scene).toBe(scene + 1)
          expect(nextPage.line).toBe(bookScenes[scene + 1]!.start)
          readFromScene(scene + 1, nextPage)
        }
      }
    }
    readFromScene(0, freshBook())
    expect(combinations).toBe(32)
  })

  it('keeps newly selected replies restorable without resetting the original reading progress', () => {
    for (const [index, scene] of bookScenes.entries()) for (const question of scene.lines.filter(line => line.choices)) {
      const before = { ...freshBook(), scene: index, furthest: index, line: question.id }
      for (const choice of question.choices!) {
        const saved = nextLine(before, choice.id)
        const restored = restoreBook(JSON.parse(JSON.stringify(saved)))
        expect(restored).toEqual(saved)
        expect(nextLine(restored).line).toBe(joins[question.id])
        expect(before.line).toBe(question.id)
        expect(before.read).toEqual([])
      }
    }
  })

  it('references real historical passages and restricts local replies to suitable regional information', () => {
    const existingSources = new Set(sources.map(source => source.id))
    for (const scene of bookScenes) {
      for (const source of scene.noteSourceIds ?? []) expect(existingSources.has(source)).toBe(true)
      for (const line of scene.lines) {
        expect(line.sourceIds.length).toBeGreaterThan(0)
        for (const id of line.sourceIds) {
          expect(existingSources.has(id)).toBe(true)
          expect(sources.find(source => source.id === id)!.excerpt.length).toBeGreaterThan(10)
        }
      }
    }
    const allowed: Record<string, string[]> = {
      'arrival-question-life': ['shiji-region'],
      'waiting-question-region': ['shiji-region'],
    }
    for (const sceneIndex of [0, 2]) for (const question of bookScenes[sceneIndex]!.lines.filter(line => line.choices)) {
      for (const choice of question.choices!) {
        const response = lineInScene(sceneIndex, choice.next)!
        expect(response.speaker).toBe('guide')
        for (const source of response.sourceIds) expect(allowed[question.id]).toContain(source)
        expect(response.text).not.toMatch(/我曾随你|我一路陪你|你心里|你内心|我走过.*大宛/)
      }
    }
    for (const index of [1, 3]) for (const question of bookScenes[index]!.lines.filter(line => line.choices)) {
      const expectedSource = index === 1 ? 'shiji-disposition' : question.id === 'market-2' ? 'shiji-market' : 'shiji-shendu'
      for (const choice of question.choices!) expect(lineInScene(index, choice.next)!.sourceIds).toEqual([expectedSource])
    }
  })

  it('adds migration and regional relations at arrival while leaving current priorities and lifestyle to their own scenes', () => {
    const question = lineInScene(0, 'arrival-question-life')!
    expect(question.choices!.map(choice => choice.id)).toEqual(['migration', 'daxia-relation'])
    expect(question.choices!.map(choice => choice.text).join(' ')).not.toMatch(/安定|畜群/)
    expect(lineInScene(0, 'arrival-migration')!.text).toContain('敦煌、祁连')
    expect(lineInScene(0, 'arrival-migration')!.text).toContain('被匈奴击败')
    expect(lineInScene(0, 'arrival-daxia-relations')!.text).toContain('使大夏臣属')
    expect(lineInScene(0, 'arrival-daxia-relations')!.text).toContain('不是同一个地方')
    const regionSource = sources.find(source => source.id === 'shiji-region')!
    expect(regionSource.excerpt).toContain('始月氏居敦煌、祁連閒')
    expect(regionSource.excerpt).toContain('西擊大夏而臣之')
    expect(regionSource.location).toContain('大月氏条')
    expect(lineInScene(1, 'meeting-2')!.text).not.toMatch(/地肥饶|安定|离这里遥远|不意味着.*出战/)
    expect(lineInScene(2, 'waiting-3')!.text).toContain('留意市场上的物品')
    expect(lineInScene(2, 'waiting-3')!.text).not.toMatch(/有城邑|有房屋|随畜迁移/)
  })

  it('asks for new information about Shendu and treats directions and climate as hearsay rather than a visited route', () => {
    const question = lineInScene(3, 'market-question-shendu')!
    expect(question.choices!.map(choice => choice.id)).toEqual(['shendu-direction', 'shendu-life'])
    expect(question.choices!.map(choice => choice.text).join(' ')).not.toMatch(/购入的地方|产地仍/)
    const purchaseReply = lineInScene(3, 'market-3')!
    expect(purchaseReply.text).toContain('从身毒购得')
    expect(purchaseReply.text).not.toMatch(/东南|数千里|湿热/)
    const direction = lineInScene(3, 'market-shendu-direction')!
    expect(direction.text).toContain('据说在大夏东南，约数千里')
    const climate = lineInScene(3, 'market-shendu-life')!
    expect(climate.text).toContain('听说')
    expect(climate.text).toContain('与大夏大体相似')
    expect(climate.text).toContain('地势低湿、天气湿热')
    for (const reply of [direction, climate]) expect(reply.sourceIds).toEqual(['shiji-shendu'])
    const source = sources.find(item => item.id === 'shiji-shendu')!
    expect(source.excerpt).toContain('身毒在大夏東南可數千里')
    expect(source.excerpt).toContain('其俗土著，大與大夏同，而卑溼暑熱云')
    expect(source.note).toContain('传闻')
    expect(source.note).toContain('约数')
    expect(bookScenes[3]!.note).toContain('张骞未亲至身毒')
    expect(lineInScene(3, 'market-4')!.text).toContain('听来的消息')
    expect(lineInScene(3, 'market-5')!.text).toContain('并未亲至身毒')
  })

  it('retains the historical outcome and puts reconstruction limits in page notes and narration', () => {
    expect(lineInScene(1, 'meeting-5')!.text).toContain('未能取得期望的联合约定')
    expect(lineInScene(3, 'market-5')!.text).toContain('道路推想')
    expect(lineInScene(3, 'market-5')!.text).toContain('并非已经走通的新路线')
    expect(bookScenes[0]!.note).toContain('不指定此人一路随行')
    expect(bookScenes[1]!.note).toContain('不是留存的谈判原话')
    expect(bookScenes[1]!.note).toContain('接见者不指定为国王')
    expect(bookScenes[2]!.note).toContain('不表示整年住在同一王庭')
    expect(bookScenes[3]!.note).toContain('不确定答问者就是售货商人')
    expect(bookScenes[3]!.note).toContain('纤维、织法、颜色未详')
    for (const [index, scene] of bookScenes.entries()) for (const question of scene.lines.filter(line => line.choices)) {
      for (const choice of question.choices!) {
        expect(lineInScene(index, choice.next)!.text).not.toMatch(/现代改编|制作示意|底本校勘|不复原|请重新准备|答对|答错|积分/)
      }
    }
  })
})
