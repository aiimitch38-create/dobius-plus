import { describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { isCommandGroup, normalizeCommandPositionals, parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { formatKitchenStatus, KITCHEN_HANDLERS } from './kitchen'

const STATUS = { enabled: true, crewRunning: true, cooking: 2, waiting: 1, maxCooks: 3, maxMinutes: 45 }

describe('kitchen CLI', () => {
  it('has a handler for every kitchen spec, and only status', () => {
    const specs = COMMAND_SPECS.filter((spec) => spec.path[0] === 'kitchen')
    expect(specs.map((spec) => spec.path.join(' '))).toEqual(Object.keys(KITCHEN_HANDLERS))
    expect(Object.keys(KITCHEN_HANDLERS)).toEqual(['kitchen status'])
    expect(isCommandGroup(['kitchen'])).toBe(true)
  })

  it('status reads kitchen.status and prints on/off, cooks and the cap', async () => {
    const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(['kitchen', 'status']))
    validateCommandAndFlags(COMMAND_SPECS, parsed)
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line))
    const call = vi.fn(async () => ({ id: 'r', ok: true, result: STATUS }))
    await KITCHEN_HANDLERS['kitchen status']({
      flags: parsed.flags,
      client: { call },
      cwd: '/',
      json: false
    } as unknown as HandlerContext)
    expect(call).toHaveBeenCalledWith('kitchen.status')
    expect(logged.join('\n')).toBe(formatKitchenStatus(STATUS))
  })

  it('says when it is off, and when the crew is paused', () => {
    expect(formatKitchenStatus(STATUS)).toBe(
      'Kitchen is on.\nCooks running: 2 of 3.\nCards waiting for a cook: 1.\nTime cap per card: 45 minutes.'
    )
    expect(formatKitchenStatus({ ...STATUS, enabled: false })).toMatch(/^Kitchen is off\./)
    expect(formatKitchenStatus({ ...STATUS, crewRunning: false })).toContain('The crew is paused')
  })
})
