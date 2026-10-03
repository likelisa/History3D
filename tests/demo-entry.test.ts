import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMuralAgentServer } from '../agent/server'

const apps: Awaited<ReturnType<typeof createMuralAgentServer>>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

describe('saved demo entry routes', () => {
  it('opens both saved works without credentials or upstream requests and confines public files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'history3d-demo-'))
    const demoDir = path.join(root, 'dist'), artifactDir = path.join(root, 'horse')
    await mkdir(path.join(demoDir, 'assets'), { recursive: true })
    await mkdir(path.join(artifactDir, 'assets'), { recursive: true })
    await writeFile(path.join(demoDir, 'mural.html'), '<title>Mural</title>')
    await mkdir(path.join(demoDir, 'tripo-prompt-lab'), { recursive: true })
    await writeFile(path.join(demoDir, 'tripo-prompt-lab', 'results.json'), '{}')
    await writeFile(path.join(demoDir, 'assets', 'narration.mp3'), 'saved audio')
    await writeFile(path.join(artifactDir, 'viewer.html'), '<title>Horse</title>')
    await writeFile(path.join(artifactDir, 'state.json'), 'private state')
    await writeFile(path.join(root, 'private.glb'), 'private asset')
    await symlink(path.join(root, 'private.glb'), path.join(artifactDir, 'assets', 'escape.glb'))
    await symlink(path.join(root, 'private.glb'), path.join(demoDir, 'assets', 'escape.glb'))
    const app = await createMuralAgentServer({ dataDir: path.join(root, 'state'), demoDir, artifactDir, fetchImpl: async () => { throw new Error('Viewing must not call upstream') } })
    await app.listen(0); apps.push(app)
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No listener')
    const base = `http://127.0.0.1:${address.port}`
    for (const route of ['/experience.html', '/guide.html', '/demo.html', '/', '/mural.html', '/examples/bronze-horse/viewer.html']) {
      const response = await fetch(base + route); expect(response.status, route).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
    }
    const audio = await fetch(base + '/assets/narration.mp3'); expect(audio.headers.get('content-type')).toBe('audio/mpeg')
    expect((await (await fetch(base + '/api/baseline')).json()).url).toBe('/mural.html')
    expect((await fetch(base + '/tripo-prompt-lab/results.json')).status).toBe(200)
    for (const route of ['/examples/bronze-horse/state.json', '/examples/bronze-horse/assets/escape.glb', '/assets/escape.glb', '/assets/%2e%2e%2fprivate.glb', '/.processing-data/state.json', '/agent/server.ts']) {
      expect((await fetch(base + route)).status, route).toBe(404)
    }
  })
})
