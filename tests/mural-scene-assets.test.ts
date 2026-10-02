import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {chapters} from '../viewer/src/mural/story.ts'
import {getSceneBeat} from '../viewer/src/mural/scene-beats.ts'

describe('mural scene supplements use delivered textured assets',()=>{
 it('verifies every adopted supplementary GLB against its byte digest and embedded textures',()=>{
  const manifest=JSON.parse(readFileSync('viewer/public/mural-assets/scene-assets-r4.json','utf8'))
  expect(manifest.historicalStatus).toContain('Illustrative')
  for(const asset of manifest.assets){
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
  expect(beats).toHaveLength(12)
  expect(new Set(beats.map(b=>b.id)).size).toBe(11)
  for(const beat of beats){expect(beat.visualSeconds).toBeGreaterThanOrEqual(5);expect(beat.boundaryNote.length).toBeGreaterThan(20)}
  expect(getSceneBeat('c4-1')?.id).toBe('retained-credential')
  expect(getSceneBeat('c4-1')?.id).not.toBe('city')
  expect(getSceneBeat('c3-1')?.id).toBe('detention')
 })
})
