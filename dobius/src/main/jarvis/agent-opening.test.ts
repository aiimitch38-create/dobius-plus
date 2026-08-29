import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOpeningLine } from './agent-context'

function history(entries: { dir: string; mtimeSeconds: number; output?: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), 'open-'))
  for (const entry of entries) {
    mkdirSync(join(root, entry.dir), { recursive: true })
    const log = join(root, entry.dir, 'output.log')
    writeFileSync(log, entry.output ?? 'work')
    utimesSync(log, entry.mtimeSeconds, entry.mtimeSeconds)
  }
  return root
}

const NOW = 10_000_000

describe('buildOpeningLine', () => {
  // What this suite is really guarding: the first version rotated six greetings
  // in front of ONE fixed sentence, so every call the user ever heard was
  // "<greeting>. Last thing I saw was <project>, just now." The tests passed —
  // they asserted the template. These assert that different machine states
  // produce different KINDS of sentence instead.

  it('leads with the failure when the last run broke', () => {
    const root = history([
      { dir: 'id::%2Ftmp%2Fpocket-cologne@@a', mtimeSeconds: (NOW - 300_000) / 1000, output: 'FAIL 3 tests' }
    ])
    const line = buildOpeningLine(root, NOW)
    expect(line).toMatch(/pocket-cologne/)
    expect(line).toMatch(/broke|red|failed/i)
  })

  it('leads with the pass when the last run was green', () => {
    const root = history([
      { dir: 'id::%2Ftmp%2Fdobius@@a', mtimeSeconds: (NOW - 120_000) / 1000, output: '42 passed' }
    ])
    const line = buildOpeningLine(root, NOW)
    expect(line).toMatch(/clean|green|passed/i)
  })

  it('counts the terminals when several are live', () => {
    const root = history([
      { dir: 'id::%2Ftmp%2Fone@@a', mtimeSeconds: (NOW - 60_000) / 1000 },
      { dir: 'id::%2Ftmp%2Ftwo@@b', mtimeSeconds: (NOW - 120_000) / 1000 },
      { dir: 'id::%2Ftmp%2Fthree@@c', mtimeSeconds: (NOW - 180_000) / 1000 }
    ])
    expect(buildOpeningLine(root, NOW)).toMatch(/3/)
  })

  it('says the machine is idle when there is no history', () => {
    expect(buildOpeningLine('/nope/missing', NOW)).toMatch(/quiet|idle|nothing/i)
  })

  it('does not use the old one-shape template', () => {
    const root = history([{ dir: 'id::%2Ftmp%2Fx@@a', mtimeSeconds: (NOW - 60_000) / 1000 }])
    expect(buildOpeningLine(root, NOW)).not.toMatch(/Last thing I saw was/)
  })

  it('produces different shapes for different situations, not just different first words', () => {
    const failed = buildOpeningLine(
      history([{ dir: 'id::%2Ftmp%2Fa@@a', mtimeSeconds: (NOW - 60_000) / 1000, output: 'error' }]),
      NOW
    )
    const passed = buildOpeningLine(
      history([{ dir: 'id::%2Ftmp%2Fa@@a', mtimeSeconds: (NOW - 60_000) / 1000, output: 'passed' }]),
      NOW
    )
    const idle = buildOpeningLine('/nope/missing', NOW)
    expect(new Set([failed, passed, idle]).size).toBe(3)
  })
})
