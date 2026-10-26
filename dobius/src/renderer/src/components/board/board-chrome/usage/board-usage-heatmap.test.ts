import { describe, expect, it } from 'vitest'
import { buildUsageHeatmap, heatmapDayKey, heatmapLevel } from './board-usage-heatmap'

// 2026-10-25 is a Sunday.
const ANCHOR = new Date(2026, 9, 25)

describe('heatmapLevel', () => {
  it('is 0 for no activity and steps by quarter of the max', () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(10, 0)).toBe(0)
    expect(heatmapLevel(25, 100)).toBe(1)
    expect(heatmapLevel(26, 100)).toBe(2)
    expect(heatmapLevel(50, 100)).toBe(2)
    expect(heatmapLevel(75, 100)).toBe(3)
    expect(heatmapLevel(100, 100)).toBe(4)
  })
})

describe('buildUsageHeatmap', () => {
  it('produces the requested number of Sunday-first weeks ending with the anchor week', () => {
    const grid = buildUsageHeatmap([], { weeks: 26, anchor: ANCHOR })
    expect(grid.weeks).toHaveLength(26)
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true)
    const last = grid.weeks[25]
    expect(last[0].day).toBe('2026-10-25')
    expect(last[6].day).toBe('2026-10-31')
    expect(new Date(`${grid.weeks[0][0].day}T00:00:00`).getDay()).toBe(0)
  })

  it('places a date in the right week column and weekday row', () => {
    const grid = buildUsageHeatmap([{ day: '2026-10-21', total: 40 }], { weeks: 4, anchor: ANCHOR })
    // 2026-10-21 is a Wednesday in the week before the anchor week.
    const cell = grid.weeks[2][3]
    expect(cell.day).toBe('2026-10-21')
    expect(cell.total).toBe(40)
    expect(cell.level).toBe(4)
    expect(grid.max).toBe(40)
  })

  it('sums duplicate days, zero-fills gaps and blanks days after the anchor', () => {
    const grid = buildUsageHeatmap(
      [
        { day: '2026-10-25', total: 10 },
        { day: '2026-10-25', total: 30 },
        { day: '2026-10-26', total: 999 }
      ],
      { weeks: 1, anchor: ANCHOR }
    )
    const [sunday, monday, tuesday] = grid.weeks[0]
    expect(sunday).toMatchObject({ total: 40, level: 4, future: false })
    expect(monday).toMatchObject({ total: 0, level: 0, future: true })
    expect(tuesday).toMatchObject({ total: 0, level: 0, future: true })
    expect(grid.max).toBe(40)
  })

  it('scales levels against the busiest visible day', () => {
    const grid = buildUsageHeatmap(
      [
        { day: '2026-10-19', total: 100 },
        { day: '2026-10-20', total: 20 },
        { day: '2026-10-21', total: 60 }
      ],
      { weeks: 2, anchor: ANCHOR }
    )
    const week = grid.weeks[0]
    expect(week[1].level).toBe(4)
    expect(week[2].level).toBe(1)
    expect(week[3].level).toBe(3)
  })

  it('formats local day keys', () => {
    expect(heatmapDayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
