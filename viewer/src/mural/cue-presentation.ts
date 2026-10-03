export type PresentationView = 'mural' | 'spatial' | 'map'
export function cueView(id: string, _localSeconds: number, hasBeat: boolean): PresentationView {
  if (['c3-0', 'c5-0', 'c6-0', 'c6-1'].includes(id)) return 'mural'
  if (id === 'c7-1' || id === 'c3-2') return 'map'
  return hasBeat ? 'spatial' : 'mural'
}
const focus: Record<string, string[]> = {
  'c0-0': ['westward-party'], 'c1-0': ['golden-figures'], 'c1-1': ['golden-figures'],
  'c1-2': ['palace'], 'c2-0': ['emperor', 'envoy-farewell'], 'c2-1': ['envoy-farewell'],
  'c2-2': ['envoy-farewell'], 'c3-0': ['westward-party', 'mountain-road'],
  'c3-1': ['guard', 'detention'], 'c3-2': ['westward-party'],
  'c4-0': ['credential'], 'c4-1': ['credential'], 'c4-2': ['alliance-result'],
  'c5-0': ['daxia-city', 'monks', 'buddhist-tower'], 'c5-1': ['market-information'],
  'c5-2': ['market-information'], 'c6-0': ['monks', 'buddhist-tower'],
  'c6-1': ['golden-figures', 'monks'], 'c6-2': ['buddhist-tower'],
}
export const cueFocus = (id: string): readonly string[] => focus[id] ?? []
export const spatialFocusIds: Record<string, string> = {
  'westward-party': 'party', credential: 'staff', 'alliance-result': 'party',
  'daxia-city': 'gate', 'market-information': 'goods', monks: 'monks',
  'buddhist-tower': 'tower', guard: 'guard', detention: 'detention',
}
export type ImageRegion = { x: number; y: number; width: number; height: number }
export const goldenFigureRegions: ImageRegion[] = [
  { x: .764, y: .17, width: .047, height: .16 },
  { x: .812, y: .17, width: .043, height: .16 },
]

/** Point briefly as narration starts, then leave the object unobstructed. */
export function focusVisible(id: string, localSeconds: number, visualSeconds: number): boolean {
  const elapsed = localSeconds - visualSeconds
  return cueFocus(id).length > 0 && elapsed >= 0 && elapsed < 3.5
}
