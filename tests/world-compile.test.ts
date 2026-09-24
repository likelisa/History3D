import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importCollection } from '../processing/src/intake.ts'
import { buildWorldRelease } from '../processing/src/world-compile.ts'
import { createNodeReader } from '../contracts/src/node-reader.ts'
import { validateScenePackage } from '../contracts/src/validate.ts'

const repoRoot = path.resolve('.')
const fixture = path.join(repoRoot, 'contracts/fixtures/handoff/collection')
const planFixture = path.join(repoRoot, 'processing/fixtures/silk-road-world-plan.json')
const tempDirs: string[] = []
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), 'history3d-world-')); tempDirs.push(dir); return dir }
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('world release compiler', () => {
  it('builds a fixed candidate that the formal package validator accepts', async () => {
    const data = await temp()
    const receipt = await importCollection(fixture, data, 'build-one')
    const release = await buildWorldRelease(receipt.importId, planFixture, data, repoRoot)
    expect(release.status).toBe('needs_review')
    const validated = await validateScenePackage(createNodeReader(release.path), { checkGlbBounds: true })
    expect(validated.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(validated.scene?.objects.find((item) => item.id === 'obj-pack-a')?.position).toEqual([0, 2, 2])
    expect(validated.scene?.objects.find((item) => item.id === 'obj-road-ahead')?.position).toEqual([0, 0, -4])
    expect(validated.story?.contentRevision).toBe(2)
    expect(validated.story?.claims.find((item) => item.id === 'claim-pack-layout')?.statement).toContain('背部')
    expect(validated.scene?.objects.some((item) => item.id === 'obj-traveler')).toBe(true)
    expect(validated.scene?.objects.some((item) => item.id === 'obj-staff')).toBe(true)
    const experience = JSON.parse(await readFile(path.join(release.path, 'experience.json'), 'utf8'))
    expect(experience.beats).toHaveLength(3)
    const releaseManifest = JSON.parse(await readFile(path.join(release.path, 'release.json'), 'utf8'))
    expect(releaseManifest.requiredCapabilities).toContain('attachment-tracks-v1')
    const quality = JSON.parse(await readFile(path.join(release.path, 'quality-report.json'), 'utf8'))
    expect(quality.relationChecks[0].pass).toBe(true)
    expect((await buildWorldRelease(receipt.importId, planFixture, data, repoRoot)).releaseId).toBe(release.releaseId)
  })

  it('rejects a cargo placement detached from its carrier', async () => {
    const data = await temp()
    const receipt = await importCollection(fixture, data, 'build-two')
    const planDir = await temp()
    const planPath = path.join(planDir, 'plan.json')
    await cp(planFixture, planPath)
    const plan = JSON.parse(await readFile(planPath, 'utf8'))
    plan.placements[0].position = [4, 0, 4]
    await writeFile(planPath, JSON.stringify(plan))
    await expect(buildWorldRelease(receipt.importId, planPath, data, repoRoot)).rejects.toThrow('ASSEMBLY_INVALID')
  })

  it('does not let B rewrite a documented historical claim', async () => {
    const data = await temp()
    const receipt = await importCollection(fixture, data, 'build-three')
    const planDir = await temp()
    const planPath = path.join(planDir, 'plan.json')
    const plan = JSON.parse(await readFile(planFixture, 'utf8'))
    plan.claimChanges[0].claimId = 'claim-story-context'
    await writeFile(planPath, JSON.stringify(plan))
    await expect(buildWorldRelease(receipt.importId, planPath, data, repoRoot)).rejects.toThrow('CLAIM_CHANGE_REQUIRES_COLLECTOR_REVIEW')
  })
})
