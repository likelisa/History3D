export type PresentationView = 'mural' | 'spatial' | 'map'
/** The story chooses its evidence view. Only the epilogue interprets the mural. */
export function cueView(id: string, _localSeconds: number, hasBeat: boolean): PresentationView {
  if (['c7-0', 'c7-1'].includes(id)) return 'mural'
  return hasBeat ? 'spatial' : 'map'
}
const focus: Record<string, string[]> = {
  'c1-1': ['guard', 'detention'], 'c1-2': ['credential'],
  'c2-0': ['westward-party'], 'c3-0': ['alliance-result'], 'c3-1': ['alliance-result'],
  'c4-0': ['market-information'], 'c4-1': ['market-information'], 'c4-2': ['market-information'],
  'c7-0': ['envoy-farewell', 'westward-party', 'monks'],
  'c7-1': ['golden-figures', 'monks', 'buddhist-tower'], 'c7-2': ['buddhist-tower'],
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
