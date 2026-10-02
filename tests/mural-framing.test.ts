import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { fitMuralView, interpolateMuralViews, toMuralCamera, zoomMuralView } from '../viewer/src/mural/framing.ts'
import type { MuralView, NormalizedRect } from '../viewer/src/mural/framing.ts'

// Subject bounds checked against viewer/public/yuezhi/murals/full.jpg (1080×895).
// They deliberately cover visible people/buildings rather than the empty central hills.
const sourceImage = { width: 1080, height: 895 }
const mural = { muralWidth: 18 * sourceImage.width / sourceImage.height, muralHeight: 18 }
function pixels(x: number, y: number, width: number, height: number): NormalizedRect {
  return { x: x / sourceImage.width, y: y / sourceImage.height, width: width / sourceImage.width, height: height / sourceImage.height }
}
const subjects = {
  palace: pixels(700, 40, 360, 310),
  farewell: pixels(400, 630, 540, 240),
  envoys: pixels(15, 275, 155, 140),
  gate: pixels(15, 15, 230, 180),
}
const desktopStages = [
  { viewportWidth: 880, viewportHeight: 500 },
  { viewportWidth: 900, viewportHeight: 530 },
  { viewportWidth: 1380, viewportHeight: 760 },
  { viewportWidth: 660, viewportHeight: 610 },
]
function cameraFor(view: MuralView, viewport: typeof desktopStages[number]): PerspectiveCamera {
  const state = toMuralCamera(view, { ...mural, fovDegrees: 43 })
  const camera = new PerspectiveCamera(43, viewport.viewportWidth / viewport.viewportHeight, .1, 150)
  camera.position.set(state.targetX, state.targetY, state.z)
  camera.lookAt(state.targetX, state.targetY, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}
function project(point: [number, number], camera: PerspectiveCamera): Vector3 {
  return new Vector3((point[0] - .5) * mural.muralWidth, (.5 - point[1]) * mural.muralHeight, 0).project(camera)
}
function corners(rect: NormalizedRect): [number, number][] {
  return [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
}
function expectInsideImage(view: NormalizedRect): void {
  expect(view.x).toBeGreaterThanOrEqual(-1e-9)
  expect(view.y).toBeGreaterThanOrEqual(-1e-9)
  expect(view.x + view.width).toBeLessThanOrEqual(1 + 1e-9)
  expect(view.y + view.height).toBeLessThanOrEqual(1 + 1e-9)
}

describe('original mural framing', () => {
  it.each(desktopStages)('shows the whole painting without distortion at $viewportWidth×$viewportHeight', viewport => {
    const view = fitMuralView({ ...mural, ...viewport, mode: 'overview' })
    const camera = cameraFor(view, viewport)
    for (const point of corners({ x: 0, y: 0, width: 1, height: 1 })) {
      const ndc = project(point, camera)
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-9)
    }
    // Exactly one pair of mural edges touches the stage: no arbitrary zoom-out.
    const topLeft = project([0, 0], camera)
    expect(Math.max(Math.abs(topLeft.x), Math.abs(topLeft.y))).toBeCloseTo(1, 10)
    // The same image-space displacement has the same world-to-pixel scale in x/y.
    const origin = project([.5, .5], camera)
    const xPoint = project([.5 + 1 / sourceImage.width, .5], camera)
    const yPoint = project([.5, .5 + 1 / sourceImage.height], camera)
    expect((xPoint.x - origin.x) * viewport.viewportWidth).toBeCloseTo((origin.y - yPoint.y) * viewport.viewportHeight, 10)
  })

  it.each(desktopStages)('keeps real mural subjects visible and all detail rays on the painting at $viewportWidth×$viewportHeight', viewport => {
    for (const focus of Object.values(subjects)) {
      const view = fitMuralView({ ...mural, ...viewport, focus, mode: 'detail' })
      expect(view.focusContained).toBe(true)
      expectInsideImage(view)
      const camera = cameraFor(view, viewport)
      for (const point of corners(focus)) {
        const ndc = project(point, camera)
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-9)
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-9)
      }
      // Intersect each viewport corner's actual perspective ray with z=0.
      for (const [x, y] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const ray = new Vector3(x, y, .5).unproject(camera).sub(camera.position)
        const hit = camera.position.clone().addScaledVector(ray, -camera.position.z / ray.z)
        expect(Math.abs(hit.x)).toBeLessThanOrEqual(mural.muralWidth / 2 + 1e-8)
        expect(Math.abs(hit.y)).toBeLessThanOrEqual(mural.muralHeight / 2 + 1e-8)
      }
    }
  })

  it('exposes the unavoidable contain/cover conflict instead of revealing blank image edges', () => {
    const view = fitMuralView({ ...mural, viewportWidth: 1380, viewportHeight: 500, mode: 'detail', focus: pixels(15, 0, 230, 895) })
    expect(view.focusContained).toBe(false)
    expectInsideImage(view)
    const overview = fitMuralView({ ...mural, viewportWidth: 1380, viewportHeight: 500, mode: 'overview' })
    expect(overview.focusContained).toBe(true)
    expect(overview.x).toBeLessThan(0)
  })

  it('clamps subjects near every image edge without omitting their focus', () => {
    const viewport = desktopStages[0]!
    for (const focus of [pixels(0, 0, 100, 80), pixels(980, 0, 100, 80), pixels(0, 815, 100, 80), pixels(980, 815, 100, 80)]) {
      const view = fitMuralView({ ...mural, ...viewport, focus, mode: 'detail' })
      expect(view.focusContained).toBe(true)
      expectInsideImage(view)
      for (const factor of [.97, 1.03, 10]) {
        const zoomed = zoomMuralView(view, factor)
        expect(zoomed.focusContained).toBe(true)
        expectInsideImage(zoomed)
      }
    }
  })

  it('moves through distant details continuously, without out-of-picture rays during a pan and zoom', () => {
    const viewport = desktopStages[1]!
    const from = fitMuralView({ ...mural, ...viewport, mode: 'detail', focus: subjects.palace })
    const to = fitMuralView({ ...mural, ...viewport, mode: 'detail', focus: subjects.envoys })
    expect(interpolateMuralViews(from, to, 0)).toEqual(from)
    expect(interpolateMuralViews(from, to, 1)).toEqual(to)
    let previous = from
    for (let step = 1; step <= 1000; step++) {
      const view = interpolateMuralViews(from, to, step / 1000)
      expectInsideImage(view)
      expect(view.width / view.height).toBeCloseTo(from.aspect, 10)
      // A whole scene transition has no single-frame position or scale jump.
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(view[key] - previous[key])).toBeLessThan(.002)
      previous = view
    }
    const nearStart = interpolateMuralViews(from, to, .0001)
    const nearEnd = interpolateMuralViews(from, to, .9999)
    expect(Math.abs(nearStart.x - from.x)).toBeLessThan(1e-7)
    expect(Math.abs(nearEnd.x - to.x)).toBeLessThan(1e-7)
  })

  it('returns smoothly to a complete overview with intentional frame area', () => {
    const viewport = desktopStages[0]!
    const from = fitMuralView({ ...mural, ...viewport, mode: 'detail', focus: subjects.gate })
    const to = fitMuralView({ ...mural, ...viewport, mode: 'overview' })
    const middle = interpolateMuralViews(from, to, .5)
    expect(middle.mode).toBe('overview')
    expect(middle.width).toBeGreaterThan(from.width)
    expect(middle.width).toBeLessThan(to.width)
    expect(interpolateMuralViews(from, to, 1)).toEqual(to)
    expect(zoomMuralView(to, .97)).toEqual(to)
  })

  it('refits after a desktop resize and rejects interpolation between mismatched stage aspects', () => {
    const oldView = fitMuralView({ ...mural, ...desktopStages[0]!, mode: 'detail', focus: subjects.farewell })
    const resized = fitMuralView({ ...mural, ...desktopStages[3]!, mode: 'detail', focus: subjects.farewell })
    expect(resized.focusContained).toBe(true)
    expectInsideImage(resized)
    expect(() => interpolateMuralViews(oldView, resized, .5)).toThrow(/refit/)
    for (const point of corners(subjects.farewell)) {
      const ndc = project(point, cameraFor(resized, desktopStages[3]!))
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('fails explicitly for invalid source rectangles and zero-sized stages', () => {
    const options = { ...mural, ...desktopStages[0]!, mode: 'detail' as const, focus: subjects.palace }
    expect(() => fitMuralView({ ...options, viewportWidth: 0 })).toThrow(RangeError)
    expect(() => fitMuralView({ ...options, focus: { x: -.01, y: 0, width: .2, height: .2 } })).toThrow(RangeError)
    expect(() => fitMuralView({ ...options, focus: { x: .9, y: .9, width: .2, height: .2 } })).toThrow(RangeError)
    expect(() => fitMuralView({ ...options, focus: { x: 0, y: 0, width: NaN, height: .2 } })).toThrow(RangeError)
    const view = fitMuralView(options)
    expect(() => toMuralCamera(view, { ...mural, fovDegrees: 180 })).toThrow(RangeError)
    expect(() => zoomMuralView(view, 0)).toThrow(RangeError)
  })
})
