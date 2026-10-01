import { describe, expect, it } from 'vitest'
import { bookScenes, lineInScene, speakerNames } from '../viewer/src/yuezhi/book-content.ts'
import { sources } from '../viewer/src/yuezhi/content.ts'
import { freshBook, nextLine, restoreBook, turnToScene } from '../viewer/src/yuezhi/book-state.ts'
import type { BookProgress } from '../viewer/src/yuezhi/book-state.ts'
import { captivityLineId, captivityPerspectives, evidenceTypeLabels, getAvailablePerspectives, getPerspectiveLine, getPerspectiveScene, isPerspectiveId, perspectiveIds, perspectives, scenePerspectives } from '../viewer/src/yuezhi/perspectives.ts'
import type { PerspectiveContext, PerspectiveId } from '../viewer/src/yuezhi/perspectives.ts'

const expectedViews: PerspectiveId[][] = [
  ['envoy', 'passersby', 'overview'],
  ['envoy', 'host', 'overview'],
  ['envoy', 'passersby', 'overview'],
  ['envoy', 'trader', 'passersby', 'overview'],
]

function walkToLine(start: BookProgress, lineId: string): BookProgress {
  let progress = start
  // Every question needs an explicit legal choice; never let an unchanged node spin.
  for (let step = 0; step <= bookScenes[start.scene]!.lines.length; step++) {
    if (progress.line === lineId) return progress
    const line = lineInScene(progress.scene, progress.line)!
    const next = nextLine(progress, line.choices?.[0]?.id)
    expect(next, `默认路径不能从 ${progress.line} 继续到 ${lineId}`).not.toBe(progress)
    progress = next
  }
  throw new Error(`默认路径未在当前场景节点数内到达 ${lineId}`)
}

describe('optional Yuezhi 3D window scene-specific perspectives', () => {
  it('defines six possible identities but offers only people belonging to the current scene', () => {
    expect(perspectives.map((view) => view.id)).toEqual([...perspectiveIds])
    expect(perspectives).toHaveLength(6)
    for (const [index, expected] of expectedViews.entries()) {
      expect(getAvailablePerspectives(index).map((view) => view.id)).toEqual(expected)
      expect(getAvailablePerspectives(bookScenes[index]!).map((view) => view.id)).toEqual(expected)
      for (const metadata of getAvailablePerspectives(index)) {
        expect(isPerspectiveId(metadata.id)).toBe(true)
        expect(metadata.identity.length).toBeGreaterThan(3)
        expect(metadata.boundary.length).toBeGreaterThan(10)
        expect(metadata.evidenceScope.length).toBeGreaterThan(10)
      }
    }
    for (const invalid of [undefined, null, '', 'enemy', 'yuezhi', {}, 0]) expect(isPerspectiveId(invalid)).toBe(false)
    expect(getAvailablePerspectives(0).find((view) => view.id === 'passersby')!.label).toBe('接引者视角')
    expect(getAvailablePerspectives(2).find((view) => view.id === 'passersby')!.label).toBe('路人视角')
    expect(getAvailablePerspectives(1).some((view) => ['passersby', 'opponent', 'trader'].includes(view.id))).toBe(false)
    expect(getAvailablePerspectives(1).find((view) => view.id === 'host')!.boundary).toContain('不是战争中的敌方')
    expect(getAvailablePerspectives(3).find((view) => view.id === 'trader')!.boundary).toContain('不把答问者确定为售货商人')
  })

  it('covers every real node for its available views and preserves the original source references', () => {
    const validSources = new Set(sources.map((source) => source.id))
    let coverage = 0
    for (const [index, scene] of bookScenes.entries()) for (const line of scene.lines) {
      const views = getAvailablePerspectives(index)
      const texts = new Set<string>()
      for (const { id: view } of views) {
        const result = getPerspectiveLine(index, line.id, view)
        coverage++
        texts.add(result.text)
        expect(result.text.length).toBeGreaterThan(10)
        expect(result.text).not.toMatch(/undefined|\[object Object\]/)
        expect(result.speakerLabel.length).toBeGreaterThan(1)
        expect(result.sourceIds).toEqual(line.sourceIds)
        expect(result.sourceIds).not.toBe(line.sourceIds)
        for (const id of result.sourceIds) expect(validSources.has(id)).toBe(true)
        expect(evidenceTypeLabels[result.evidenceType]).toBeTruthy()
        expect(getPerspectiveLine(scene, line.id, view)).toEqual(result)
      }
      expect(texts.size).toBe(views.length)
    }
    expect(coverage).toBe(bookScenes.reduce((total, scene, index) => total + scene.lines.length * expectedViews[index]!.length, 0))
  })

  it('keeps overview identical to the existing book including speaker and evidence status', () => {
    for (const [index, scene] of bookScenes.entries()) for (const line of scene.lines) {
      expect(getPerspectiveLine(index, line.id, 'overview')).toEqual({
        text: line.text,
        sourceIds: line.sourceIds,
        speakerLabel: speakerNames[line.speaker],
        evidenceType: line.speaker === 'narrator' ? 'historical-summary' : 'modern-adaptation',
      })
    }
  })

  it('rejects absent people rather than supplying an unrelated distant opponent or meeting passerby', () => {
    for (const [index, scene] of bookScenes.entries()) {
      for (const view of perspectiveIds.filter((id) => !expectedViews[index]!.includes(id))) {
        expect(() => getPerspectiveScene(view, index)).toThrow('该人物视角不属于当前场景')
        expect(() => getPerspectiveLine(index, scene.start, view)).toThrow('该人物视角不属于当前场景')
      }
    }
    expect(() => getPerspectiveLine(0, 'market-1', 'envoy')).toThrow('该句不属于当前书页')
    expect(() => getPerspectiveLine(10, 'arrival-1', 'overview')).toThrow('没有对应的故事书页')
    expect(() => getPerspectiveScene('enemy' as PerspectiveId, 0)).toThrow('没有对应的阅读视角')
    expect(() => getAvailablePerspectives(0, 'battle' as PerspectiveContext)).toThrow('没有对应的场景上下文')
  })

  it('gives every available position a distinct composition and clear visible/unavailable information', () => {
    for (const [index, scene] of bookScenes.entries()) {
      const crops = new Set<string>()
      const views = getAvailablePerspectives(index)
      for (const { id: view } of views) {
        const result = getPerspectiveScene(view, index)
        crops.add(JSON.stringify(result.crop))
        expect(getPerspectiveScene(view, scene)).toEqual(result)
        expect(result.description.length).toBeGreaterThan(10)
        expect(result.visibleInformation.length).toBeGreaterThan(10)
        expect(result.unavailableInformation.length).toBeGreaterThan(10)
        expect(result.crop.x).toBeGreaterThanOrEqual(0)
        expect(result.crop.x).toBeLessThanOrEqual(1)
        expect(result.crop.y).toBeGreaterThanOrEqual(0)
        expect(result.crop.y).toBeLessThanOrEqual(1)
        expect(result.crop.scale).toBeGreaterThanOrEqual(1)
      }
      expect(crops.size).toBe(views.length)
    }
  })

  it('offers a separately sourced captivity prequel with envoy, Xiongnu person and overview', () => {
    const texts = new Set<string>()
    for (const [index, scene] of bookScenes.entries()) {
      const available = getAvailablePerspectives(index, 'captivity')
      expect(available.map((view) => view.id)).toEqual(['envoy', 'opponent', 'overview'])
      for (const { id: view } of available) {
        const narrative = getPerspectiveLine(index, scene.start, view, 'captivity')
        texts.add(narrative.text)
        expect(narrative.sourceIds).toEqual(['shiji-mission'])
        expect(narrative.text).toContain('被留')
        expect(getPerspectiveLine(index, captivityLineId, view, 'captivity')).toEqual(narrative)
        expect(getPerspectiveScene(view, index, 'captivity').description).toContain('前情')
      }
      for (const view of ['host', 'trader', 'passersby'] as const) expect(() => getPerspectiveScene(view, index, 'captivity')).toThrow('该人物视角不属于当前场景')
    }
    expect(texts.size).toBe(3)
    const xiongnu = getAvailablePerspectives(0, 'captivity').find((view) => view.id === 'opponent')!
    expect(xiongnu.identity).toContain('匈奴')
    expect(xiongnu.boundary).toContain('仅在匈奴羁留前情')
    expect(xiongnu.boundary).toContain('月氏不是敌方')
    expect(getPerspectiveScene('opponent', 0, 'captivity').description).toContain('近看')
  })

  it('reading and prequel descriptions cannot change progress or either fixed branch result', () => {
    const originalBook = JSON.stringify(bookScenes)
    let progress = walkToLine(freshBook(), 'arrival-6')
    progress = turnToScene(progress, 1)
    progress = walkToLine(progress, 'meeting-3')
    expect(progress.line).toBe('meeting-3')
    for (const choice of ['grievance', 'distance']) {
      const answer = nextLine(progress, choice)
      const savedAnswer = JSON.stringify(answer)
      for (const { id: selected } of getAvailablePerspectives(answer.scene)) getPerspectiveLine(answer.scene, answer.line, selected)
      for (const { id: selected } of getAvailablePerspectives(answer.scene, 'captivity')) getPerspectiveLine(answer.scene, answer.line, selected, 'captivity')
      expect(JSON.stringify(answer)).toBe(savedAnswer)
      expect(restoreBook(JSON.parse(savedAnswer))).toEqual(answer)
      expect(nextLine(answer).line).toBe('meeting-4')
      expect(walkToLine(answer, 'meeting-5').line).toBe('meeting-5')
      for (const { id: view } of getAvailablePerspectives(1)) expect(getPerspectiveLine(1, 'meeting-5', view).text).toMatch(/未成|未能/)
    }
    const market = { ...progress, scene: 3, furthest: 3, line: 'market-2' }
    for (const choice of ['cloth', 'bamboo']) {
      const answer = nextLine(market, choice)
      for (const { id: view } of getAvailablePerspectives(3)) getPerspectiveLine(3, answer.line, view)
      expect(walkToLine(answer, 'market-3').line).toBe('market-3')
    }
    const legacyFinished = { scene: 3, line: 'market-6', furthest: 3, read: ['arrival-1', 'meeting-3', 'market-5'], complete: true }
    expect(restoreBook(legacyFinished)).toEqual(legacyFinished)
    expect(JSON.stringify(bookScenes)).toBe(originalBook)
  })

  it('covers selectable questions and each answer as modern adaptations without changing their progress', () => {
    for (const [index, scene] of bookScenes.entries()) for (const question of scene.lines.filter(line => line.choices)) {
      const before = { scene: index, line: question.id, furthest: index, read: [], complete: false }
      for (const choice of question.choices!) {
        const after = nextLine(before, choice.id)
        const snapshot = JSON.stringify(after)
        expect(after.line).toBe(choice.next)
        for (const { id: view } of getAvailablePerspectives(index)) {
          const prompt = getPerspectiveLine(index, question.id, view)
          const reply = getPerspectiveLine(index, after.line, view)
          expect(prompt.text.trim()).not.toBe('')
          expect(reply.text.trim()).not.toBe('')
          expect(prompt.evidenceType).toBe('modern-adaptation')
          expect(reply.evidenceType).toBe('modern-adaptation')
        }
        expect(JSON.stringify(after)).toBe(snapshot)
      }
    }
  })

  it('covers the revised migration and Shendu questions in every present view and excludes retired duplicate nodes', () => {
    for (const [index, ids] of [
      [0, ['arrival-question-life', 'arrival-migration', 'arrival-daxia-relations']],
      [3, ['market-question-shendu', 'market-shendu-direction', 'market-shendu-life']],
    ] as const) for (const id of ids) {
      for (const { id: view } of getAvailablePerspectives(index)) {
        const result = getPerspectiveLine(index, id, view)
        expect(result.sourceIds).toEqual([index === 0 ? 'shiji-region' : 'shiji-shendu'])
        expect(result.evidenceType).toBe('modern-adaptation')
      }
    }
    for (const { id: view } of getAvailablePerspectives(3)) {
      const direction = getPerspectiveLine(3, 'market-shendu-direction', view)
      const climate = getPerspectiveLine(3, 'market-shendu-life', view)
      expect(direction.text).toContain('数千里')
      expect(direction.text).toMatch(/据说|答问|转述/)
      expect(climate.text).toMatch(/听说|答问|听来/)
      expect(getPerspectiveLine(3, 'market-5', view).text).toMatch(/未亲至|没有亲至|并未亲至/)
    }
    const retired: Record<number, string[]> = {
      0: ['arrival-question-concerns', 'arrival-current-life', 'arrival-han-distance', 'arrival-settled-life', 'arrival-herding-life'],
      1: ['meeting-question-priorities', 'meeting-guard-stability', 'meeting-consider-distance'],
      2: ['waiting-question-observation', 'waiting-see-market', 'waiting-see-goods'],
      3: ['market-question-origin', 'market-shendu-purchase', 'market-shu-origin'],
    }
    for (const [index, ids] of Object.entries(retired)) for (const id of ids) {
      expect(() => getPerspectiveLine(Number(index), id, 'envoy')).toThrow('该句不属于当前书页')
      for (const { id: view } of getAvailablePerspectives(Number(index))) {
        expect(scenePerspectives[Number(index)]!.views[view]!.lines.map(line => line.lineId)).not.toContain(id)
      }
    }
  })

  it('returns isolated metadata, references and compositions', () => {
    const metadata = getAvailablePerspectives(0)
    metadata[1]!.label = 'incorrect'
    expect(getAvailablePerspectives(0)[1]!.label).toBe('接引者视角')
    const first = getPerspectiveLine(0, 'arrival-1', 'envoy')
    first.sourceIds.push('invalid-source')
    expect(getPerspectiveLine(0, 'arrival-1', 'envoy').sourceIds).not.toContain('invalid-source')
    const scene = getPerspectiveScene('envoy', 0)
    scene.crop.x = 99
    expect(getPerspectiveScene('envoy', 0).crop.x).toBeLessThanOrEqual(1)
    getPerspectiveLine(0, 'arrival-1', 'opponent', 'captivity').sourceIds.push('invalid-source')
    expect(getPerspectiveLine(0, 'arrival-1', 'opponent', 'captivity').sourceIds).toEqual(['shiji-mission'])
  })

  it('serializes only available book views and a separate, complete prequel context', () => {
    const exported = JSON.parse(JSON.stringify(scenePerspectives)) as typeof scenePerspectives
    expect(exported.map((scene) => scene.sceneId)).toEqual(bookScenes.map((scene) => scene.id))
    for (const [index, scene] of exported.entries()) {
      expect(scene.available).toEqual(expectedViews[index])
      expect(Object.keys(scene.views)).toEqual(expectedViews[index])
      for (const view of scene.available) {
        const entry = scene.views[view]!
        expect(entry.metadata).toEqual(getAvailablePerspectives(index).find((metadata) => metadata.id === view))
        expect(entry.lines.map((line) => line.lineId)).toEqual(bookScenes[index]!.lines.map((line) => line.id))
        for (const line of entry.lines) expect(line).toEqual({ lineId: line.lineId, ...getPerspectiveLine(index, line.lineId, view) })
      }
    }
    const context = JSON.parse(JSON.stringify(captivityPerspectives)) as typeof captivityPerspectives
    expect(context.id).toBe('captivity')
    expect(context.sourceIds).toEqual(['shiji-mission'])
    expect(context.available).toEqual(['envoy', 'opponent', 'overview'])
    expect(Object.keys(context.views)).toEqual(context.available)
    for (const view of context.available) {
      expect(context.views[view]!.lines).toEqual([{ lineId: captivityLineId, ...getPerspectiveLine(0, captivityLineId, view, 'captivity') }])
    }
  })
})
