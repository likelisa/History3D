import { describe, expect, it } from 'vitest'
import { candidateBaseUrl } from '../viewer/src/reader.ts'

describe('fixed candidate URL', () => {
  it('builds a same-origin path for a valid release', () => {
    expect(candidateBaseUrl('silk-road-demo', 'release-efecbcecfaceae4a3023')).toBe('/candidates/silk-road-demo/release-efecbcecfaceae4a3023')
  })

  it('rejects traversal and remote-looking identifiers', () => {
    expect(candidateBaseUrl('../other', 'release-efecbcecfaceae4a3023')).toBeNull()
    expect(candidateBaseUrl('silk-road-demo', 'https://example.com')).toBeNull()
  })
})
