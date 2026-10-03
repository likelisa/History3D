import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const base = 'viewer/public/tripo-prompt-lab/'
const experiment = JSON.parse(readFileSync(base + 'experiment.json', 'utf8'))
const results = JSON.parse(readFileSync(base + 'results.json', 'utf8'))

describe('controlled Tripo prompt experiment delivery', () => {
  it('changes only the prompt within each pair, not generation quality or randomness', () => {
    expect(experiment.cases.map((item: { id: string }) => item.id)).toEqual(['staff-a', 'staff-b', 'gate-a', 'gate-b'])
    for (const asset of ['staff', 'gate']) {
      const pair = experiment.cases.filter((item: { asset: string }) => item.asset === asset)
      const controls = pair.map((item: { request: Record<string, unknown> }) => {
        const { prompt, ...parameters } = item.request
        expect(String(prompt).length).toBeLessThanOrEqual(1024)
        expect(String(parameters.negative_prompt).length).toBeLessThanOrEqual(255)
        return parameters
      })
      expect(controls[0]).toEqual(controls[1])
      expect(pair[0].request.prompt).not.toEqual(pair[1].request.prompt)
    }
  })
  it('delivers all four real task outputs with intact GLB bytes and SHA', () => {
    expect(results.experimentId).toBe(experiment.experimentId)
    expect(results.cases).toHaveLength(4)
    for (const record of results.cases) {
      expect(record.status).toBe('downloaded')
      expect(record.taskId).toMatch(/^[0-9a-f-]{36}$/)
      expect(record.path).toBe(`/tripo-prompt-lab/${record.id}.glb`)
      const bytes = readFileSync('viewer/public' + record.path)
      expect(bytes.toString('ascii', 0, 4)).toBe('glTF')
      expect(bytes.readUInt32LE(8)).toBe(bytes.length)
      expect(bytes.length).toBe(record.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256)
      expect(record.stats.triangles).toBeGreaterThan(0)
    }
  })
  it('separates generated results from acceptance and reports actual task credits', () => {
    expect(experiment.status).toBe('generated_review_pending')
    expect(results.cases.reduce((sum: number, item: { creditsConsumed: number }) => sum + item.creditsConsumed, 0)).toBe(80)
  })
})
