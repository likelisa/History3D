export interface BenchWindow {
  second: number
  frames: number
  fps: number
}

export interface BenchReport {
  storyId: string
  schemaVersion: string
  contentRevision: number
  sceneRevision: number
  loadMs: number
  sinceNavigationMs: number
  durationSeconds: number
  windowCount: number
  windowsAtOrAbove30Fps: number
  ratioAtOrAbove30Fps: number
  averageFps: number
  minWindowFps: number
  windows: BenchWindow[]
  measuredAt: string
  userAgent: string
}

/**
 * 按 1 秒窗口采样帧率。目标口径：ready 后的移动体验中，
 * 至少 80% 的一秒窗口平均帧率达到 30 FPS。
 */
export class BenchRecorder {
  private readonly windows: BenchWindow[] = []
  private windowFrames = 0
  private windowElapsed = 0

  constructor(
    readonly durationSeconds: number,
    private readonly loadMs: number,
  ) {}

  get elapsedSeconds(): number {
    return this.windows.length + this.windowElapsed
  }

  get finished(): boolean {
    return this.elapsedSeconds >= this.durationSeconds
  }

  sample(deltaSeconds: number): void {
    this.windowFrames += 1
    this.windowElapsed += deltaSeconds
    if (this.windowElapsed >= 1) {
      this.windows.push({
        second: this.windows.length + 1,
        frames: this.windowFrames,
        fps: this.windowFrames / this.windowElapsed,
      })
      this.windowFrames = 0
      this.windowElapsed = 0
    }
  }

  report(meta: {
    storyId: string
    schemaVersion: string
    contentRevision: number
    sceneRevision: number
  }): BenchReport {
    const fpsValues = this.windows.map((item) => item.fps)
    const atOrAbove = fpsValues.filter((fps) => fps >= 30).length
    const average = fpsValues.length
      ? fpsValues.reduce((sum, fps) => sum + fps, 0) / fpsValues.length
      : 0
    return {
      ...meta,
      loadMs: Number(this.loadMs.toFixed(1)),
      sinceNavigationMs: Number(performance.now().toFixed(1)),
      durationSeconds: this.durationSeconds,
      windowCount: fpsValues.length,
      windowsAtOrAbove30Fps: atOrAbove,
      ratioAtOrAbove30Fps: fpsValues.length ? Number((atOrAbove / fpsValues.length).toFixed(4)) : 0,
      averageFps: Number(average.toFixed(2)),
      minWindowFps: fpsValues.length ? Number(Math.min(...fpsValues).toFixed(2)) : 0,
      windows: this.windows,
      measuredAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    }
  }
}
