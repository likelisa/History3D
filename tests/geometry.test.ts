import { describe, expect, it } from 'vitest'

import {
  cameraEyePosition,
  distance3,
  formatMeters,
  grayBoxCenterOffset,
  isBlocked,
  isInsideWalkable,
  normalizeDirection,
  resolveMove,
  sizeTolerance,
  viewDirection,
} from '../contracts/src/geometry.ts'
import type { Blocker } from '../contracts/src/types.ts'

const BOUNDS = { min: [-10, -10] as [number, number], max: [10, 10] as [number, number] }
const RADIUS = 0.3

describe('测距', () => {
  it('3-4-5 固定点得到 5 米', () => {
    expect(distance3([0, 0, 0], [3, 0, 4])).toBe(5)
  })

  it('保留两位小数并带单位', () => {
    expect(formatMeters(distance3([0, 0, 0], [3, 0, 4]))).toBe('5.00 米')
    expect(formatMeters(1.23456)).toBe('1.23 米')
  })

  it('包含垂直分量，不是地面投影距离', () => {
    expect(distance3([0, 0, 0], [0, 3, 4])).toBe(5)
  })
})

describe('相机约定', () => {
  it('相机位置等于脚下位置加上眼高', () => {
    expect(cameraEyePosition([1, 0, 2], 1.7)).toEqual([1, 1.7, 2])
  })

  it('yaw=0 看向 -Z，yaw=π/2 看向 -X', () => {
    const [x0, y0, z0] = viewDirection(0, 0)
    expect(x0).toBeCloseTo(0, 10)
    expect(y0).toBeCloseTo(0, 10)
    expect(z0).toBeCloseTo(-1, 10)

    const [x1, , z1] = viewDirection(Math.PI / 2, 0)
    expect(x1).toBeCloseTo(-1, 10)
    expect(z1).toBeCloseTo(0, 10)
  })

  it('正 pitch 抬头', () => {
    expect(viewDirection(0, Math.PI / 4)[1]).toBeGreaterThan(0)
    expect(viewDirection(0, -Math.PI / 4)[1]).toBeLessThan(0)
  })
})

describe('灰盒原点', () => {
  it('几何中心上移半个高度，使原点落在底部', () => {
    expect(grayBoxCenterOffset([2, 3, 4])).toEqual([0, 1.5, 0])
  })
})

describe('移动与阻挡', () => {
  it('对角方向先归一化，位移长度等于输入长度', () => {
    const result = resolveMove([0, 0], [1, 1], BOUNDS, [], RADIUS)
    expect(result.x).toBeCloseTo(1, 6)
    expect(result.z).toBeCloseTo(1, 6)
  })

  it('边界按角色半径向内收缩', () => {
    const result = resolveMove([0, 0], [100, 0], BOUNDS, [], RADIUS)
    expect(result.x).toBeCloseTo(9.7, 6)
    expect(isInsideWalkable([9.7, 0], BOUNDS, RADIUS)).toBe(true)
    expect(isInsideWalkable([9.8, 0], BOUNDS, RADIUS)).toBe(false)
  })

  it('阻挡矩形按半径扩展后阻止进入', () => {
    const blockers: Blocker[] = [{ id: 'blk', min: [1, 1], max: [2, 2] }]
    const result = resolveMove([-1, 1.5], [4, 0], BOUNDS, blockers, RADIUS)
    expect(result.blocked).toBe(true)
    expect(result.x).toBeLessThanOrEqual(0.7 + 1e-6)
    expect(isBlocked(1.5, 1.5, blockers, RADIUS)).toBe(true)
    expect(isBlocked(0.69, 1.5, blockers, RADIUS)).toBe(false)
  })

  it('被阻挡时沿单轴滑动，而不是整体停住', () => {
    const blockers: Blocker[] = [{ id: 'blk', min: [1, -5], max: [2, 5] }]
    const result = resolveMove([0, 0], [2, 2], BOUNDS, blockers, RADIUS)
    expect(result.blocked).toBe(true)
    expect(result.x).toBeLessThan(0.75)
    expect(result.z).toBeGreaterThan(1.9)
  })

  it('零输入不移动', () => {
    expect(resolveMove([2, 3], [0, 0], BOUNDS, [], RADIUS)).toEqual({
      x: 2,
      z: 3,
      blocked: false,
    })
    expect(normalizeDirection(0, 0)).toEqual([0, 0])
  })
})

describe('尺寸容差', () => {
  it('取 1 厘米与 1% 中的较大值', () => {
    expect(sizeTolerance(0.5)).toBeCloseTo(0.01, 10)
    expect(sizeTolerance(10)).toBeCloseTo(0.1, 10)
  })
})
