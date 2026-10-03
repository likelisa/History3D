import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {chapters} from '../viewer/src/mural/story.ts'
import {getSceneBeat} from '../viewer/src/mural/scene-beats.ts'

describe('mural scene supplements use delivered textured assets',()=>{
 it('verifies every adopted supplementary GLB against its byte digest and embedded textures',()=>{
  const manifest=JSON.parse(readFileSync('viewer/public/mural-assets/scene-assets-r4.json','utf8'))
  const departure=JSON.parse(readFileSync('viewer/public/mural-assets/departure-outpost-r8-manifest.json','utf8'))
  expect(manifest.historicalStatus).toContain('Illustrative')
  expect(departure.historicalStatus).toContain('Illustrative')
  expect(departure.asset.sha256).not.toBe(manifest.assets.find((asset:any)=>asset.id==='environment').sha256)
  for(const asset of [...manifest.assets,departure.asset]){
   const b=readFileSync('viewer/public'+asset.path)
   expect(b.length).toBe(asset.bytes)
   expect(createHash('sha256').update(b).digest('hex')).toBe(asset.sha256)
   expect(b.toString('ascii',0,4)).toBe('glTF')
   const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())
   expect(gltf.meshes.length).toBeGreaterThan(0)
   expect(gltf.images.length).toBeGreaterThan(0)
   expect(gltf.images.every((im:any)=>im.bufferView!==undefined)).toBe(true)
  }
 })
 it('gives the historically distinct 3D cues separate subjects and an explicit evidence boundary',()=>{
  const beats=chapters.flatMap(ch=>ch.cues.map(c=>getSceneBeat(c.id))).filter(b=>b!==undefined)
  expect(beats).toHaveLength(11)
  for(const beat of beats){expect(beat.visualSeconds).toBeGreaterThanOrEqual(1);expect(beat.boundaryNote.length).toBeGreaterThan(20)}
  expect(getSceneBeat('c1-2')?.id).toBe('retained-credential')
  expect(getSceneBeat('c1-2')?.id).not.toBe('city')
  expect(getSceneBeat('c1-1')?.id).toBe('detention')
  expect(getSceneBeat('c1-0')?.id).toBe('departure')
  expect(getSceneBeat('c1-0')?.id).not.toBe(getSceneBeat('c2-0')?.id)
 })
})
