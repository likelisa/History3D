/** Original-image coordinates: x/y start at the top left, with 1 at the far edge. */
export type NormalizedRect = { x: number; y: number; width: number; height: number }

export type MuralView = NormalizedRect & {
  mode: 'overview' | 'detail'
  /** Width / height in normalized image coordinates, not in world units. */
  aspect: number
  focus: NormalizedRect
  /** False when a detail viewport cannot contain the entire requested region. */
  focusContained: boolean
}

export type FramingOptions = {
  mode: MuralView['mode']
  focus?: NormalizedRect
  viewportWidth: number
  viewportHeight: number
  muralWidth: number
  muralHeight: number
}

const EPSILON = 1e-9
const fullMural: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 }

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`)
}

function validateFocus(rect: NormalizedRect): void {
  positive(rect.width, 'focus.width')
  positive(rect.height, 'focus.height')
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > 1 + EPSILON || rect.y + rect.height > 1 + EPSILON) {
    throw new RangeError('focus must lie inside the original mural')
  }
}

function contains(view: NormalizedRect, focus: NormalizedRect): boolean {
  return view.x <= focus.x + EPSILON && view.y <= focus.y + EPSILON &&
    view.x + view.width >= focus.x + focus.width - EPSILON &&
    view.y + view.height >= focus.y + focus.height - EPSILON
}

function clampCenter(center: number, size: number): number {
  return Math.min(1 - size / 2, Math.max(size / 2, center))
}

function createView(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  mode: MuralView['mode'],
  aspect: number,
  focus: NormalizedRect,
): MuralView {
  const rect = { x: centerX - width / 2, y: centerY - height / 2, width, height }
  return { ...rect, mode, aspect, focus: { ...focus }, focusContained: contains(rect, focus) }
}

/**
 * Overview contains the entire painting and allows an intentional frame around it.
 * Detail fills the viewport with painting, clamps all four edges inside the image,
 * and contains the focus whenever its shape fits. A very tall focus in a wide stage
 * cannot both fit and avoid background; focusContained exposes that conflict.
 */
export function fitMuralView(options: FramingOptions): MuralView {
  const { viewportWidth, viewportHeight, muralWidth, muralHeight, mode } = options
  positive(viewportWidth, 'viewportWidth')
  positive(viewportHeight, 'viewportHeight')
  positive(muralWidth, 'muralWidth')
  positive(muralHeight, 'muralHeight')
  const focus = options.focus ?? fullMural
  validateFocus(focus)
  const aspect = (viewportWidth / viewportHeight) / (muralWidth / muralHeight)
  if (mode === 'overview') {
    return createView(.5, .5, Math.max(1, aspect), Math.max(1, 1 / aspect), mode, aspect, focus)
  }
  const maxHeight = Math.min(1, 1 / aspect)
  const height = Math.min(maxHeight, Math.max(focus.height, focus.width / aspect))
  const width = height * aspect
  return createView(
    clampCenter(focus.x + focus.width / 2, width),
    clampCenter(focus.y + focus.height / 2, height),
    width,
    height,
    mode,
    aspect,
    focus,
  )
}

/**
 * All detail rectangle edges move continuously inside the mural's convex boundary.
 * Overview/detail transitions smoothly expose the overview frame; zero background
 * is guaranteed for detail-to-detail travel only. Refit both endpoints on resize.
 */
export function interpolateMuralViews(from: MuralView, to: MuralView, progress: number): MuralView {
  if (!Number.isFinite(progress)) throw new RangeError('progress must be finite')
  if (Math.abs(from.aspect - to.aspect) > EPSILON) {
    throw new RangeError('refit both views to the same viewport before interpolating')
  }
  const bounded = Math.min(1, Math.max(0, progress))
  if (bounded === 0) return { ...from, focus: { ...from.focus } }
  if (bounded === 1) return { ...to, focus: { ...to.focus } }
  const t = bounded * bounded * (3 - 2 * bounded)
  const lerp = (a: number, b: number) => a + (b - a) * t
  const rect = {
    x: lerp(from.x, to.x), y: lerp(from.y, to.y),
    width: lerp(from.width, to.width), height: lerp(from.height, to.height),
  }
  return {
    ...rect,
    mode: from.mode === 'detail' && to.mode === 'detail' ? 'detail' : 'overview',
    aspect: to.aspect,
    focus: { ...to.focus },
    focusContained: contains(rect, to.focus),
  }
}

/** Small pushes/pulls retain the declared subject and keep detail edges on the image. */
export function zoomMuralView(view: MuralView, factor: number): MuralView {
  positive(factor, 'factor')
  const maxHeight = view.mode === 'detail' ? Math.min(1, 1 / view.aspect) : Infinity
  const minimumHeight = view.mode === 'overview'
    ? Math.max(1, 1 / view.aspect)
    : view.focusContained ? Math.max(view.focus.height, view.focus.width / view.aspect) : 0
  const height = Math.min(maxHeight, Math.max(minimumHeight, view.height * factor))
  const width = height * view.aspect
  let centerX = view.x + view.width / 2
  let centerY = view.y + view.height / 2
  if (view.focusContained && view.mode === 'detail') {
    // Center movement caused by edge clamping must not crop an off-center subject.
    centerX = Math.min(view.focus.x + width / 2, Math.max(view.focus.x + view.focus.width - width / 2, centerX))
    centerY = Math.min(view.focus.y + height / 2, Math.max(view.focus.y + view.focus.height - height / 2, centerY))
  }
  if (view.mode === 'detail') {
    centerX = clampCenter(centerX, width)
    centerY = clampCenter(centerY, height)
  }
  return createView(centerX, centerY, width, height, view.mode, view.aspect, view.focus)
}

/** Perspective camera must sit at (targetX,targetY,z) and look at (targetX,targetY,0). */
export function toMuralCamera(
  view: NormalizedRect,
  options: { muralWidth: number; muralHeight: number; fovDegrees: number },
): { targetX: number; targetY: number; z: number } {
  positive(options.muralWidth, 'muralWidth')
  positive(options.muralHeight, 'muralHeight')
  if (!Number.isFinite(options.fovDegrees) || options.fovDegrees <= 0 || options.fovDegrees >= 180) {
    throw new RangeError('fovDegrees must lie between 0 and 180')
  }
  positive(view.width, 'view.width')
  positive(view.height, 'view.height')
  return {
    targetX: (view.x + view.width / 2 - .5) * options.muralWidth,
    targetY: (.5 - view.y - view.height / 2) * options.muralHeight,
    z: view.height * options.muralHeight / (2 * Math.tan(options.fovDegrees * Math.PI / 360)),
  }
}
