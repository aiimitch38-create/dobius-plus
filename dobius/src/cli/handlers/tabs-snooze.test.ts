import { beforeEach, describe, expect, it, vi } from 'vitest'

const printResultMock = vi.hoisted(() => vi.fn())
vi.mock('../format', () => ({ printResult: printResultMock }))

import { TABS_SNOOZE_HANDLERS, formatSnoozedTabs, parseSnoozeUntil } from './tabs-snooze'

const NOW = new Date(2026, 10, 22, 10, 0, 0).getTime()
const callMock = vi.fn()
const run = (command: string, flags: Record<string, string | boolean>) =>
  TABS_SNOOZE_HANDLERS[command]({
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false } as never,
    cwd: '/repo/wt-1',
    json: true
  })

describe('parseSnoozeUntil', () => {
  it('reads durations, clock times, ISO times and manual', () => {
    expect(parseSnoozeUntil('30m', NOW)).toBe(NOW + 30 * 60_000)
    expect(parseSnoozeUntil('2h', NOW)).toBe(NOW + 2 * 3_600_000)
    expect(parseSnoozeUntil('09:30', NOW)).toBe(new Date(2026, 10, 23, 9, 30).getTime())
    expect(parseSnoozeUntil('14:00', NOW)).toBe(new Date(2026, 10, 22, 14, 0).getTime())
    expect(parseSnoozeUntil('manual', NOW)).toBeNull()
    expect(parseSnoozeUntil('2026-11-23T09:00:00Z', NOW)).toBe(Date.parse('2026-11-23T09:00:00Z'))
  })

  it('refuses the past, more than a year, and nonsense', () => {
    expect(() => parseSnoozeUntil('2020-01-01T00:00:00Z', NOW)).toThrow(/future/)
    expect(() => parseSnoozeUntil('400d', NOW)).toThrow(/within a year/)
    expect(() => parseSnoozeUntil('soonish', NOW)).toThrow(/--until must be like/)
    expect(() => parseSnoozeUntil('25:00', NOW)).toThrow(/24-hour/)
  })
})

describe('tabs snooze commands', () => {
  beforeEach(() => {
    printResultMock.mockReset()
    callMock.mockReset().mockResolvedValue({ result: { tabs: [] } })
  })

  it('snooze sends tab, until and --force', async () => {
    await run('tabs snooze', { tab: 'tab-1', until: 'manual', force: true })
    expect(callMock).toHaveBeenCalledWith('tabs.snooze', { tab: 'tab-1', until: null, force: true })
  })

  it('snooze needs --until', async () => {
    await expect(run('tabs snooze', { tab: 'tab-1' })).rejects.toThrow(/--until/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('unsnooze and snoozed call their methods', async () => {
    await run('tabs unsnooze', { tab: 'tab-1' })
    await run('tabs snoozed', {})
    expect(callMock.mock.calls).toEqual([
      ['tabs.unsnooze', { tab: 'tab-1' }],
      ['tabs.snoozed', {}]
    ])
  })

  it('formats snoozed rows', () => {
    expect(
      formatSnoozedTabs([
        { worktreeId: 'wt-1', tabId: 'tab-1', title: 'Fix', until: null, ready: false, returning: false },
        { worktreeId: 'wt-1', tabId: 'tab-2', title: 'Back', until: 1, ready: true, returning: true }
      ])
    ).toBe('tab-1  manual  wt-1  Fix\ntab-2  coming back  wt-1  Back')
  })
})
