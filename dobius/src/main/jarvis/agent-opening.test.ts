import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOpeningLine, formatOpeningSection, getLastOpening } from './agent-context'

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
    // Hedged on purpose: the classifier is a substring heuristic, so the
    // opener observes ("looks like", "seeing failures") rather than asserts.
    expect(line).toMatch(/wrong|failures|error/i)
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

describe('opening evidence (the "what broke?" fix)', () => {
  // Guards against transcript conv_7801m191...: the agent opened with
  // "Something broke in pocket-cologne-next", could not say what broke, then
  // attributed its own opening to the user.

  it('records the line, project and matched marker after a failure opening', () => {
    const root = history([
      { dir: 'id::%2Ftmp%2Fpocket-cologne@@a', mtimeSeconds: (NOW - 300_000) / 1000, output: 'FAIL 3 tests' }
    ])
    const line = buildOpeningLine(root, NOW)
    const record = getLastOpening()
    expect(record?.line).toBe(line)
    expect(record?.project).toBe('pocket-cologne')
    expect(record?.marker).toBe('fail')
  })

  it('always states the attribution rule, even with no record', () => {
    const section = formatOpeningSection(null, NOW)
    expect(section).toMatch(/YOUR opening line/)
    expect(section).toMatch(/never/i)
  })

  it('includes the line and evidence while the record is fresh', () => {
    const record = { line: 'Looks like x broke.', project: 'x', marker: 'error', at: NOW }
    const section = formatOpeningSection(record, NOW + 60_000)
    expect(section).toContain('Looks like x broke.')
    expect(section).toContain('"error"')
  })

  it('drops stale specifics but keeps the rule', () => {
    const record = { line: 'old line', project: 'x', marker: 'error', at: NOW }
    const section = formatOpeningSection(record, NOW + 10 * 60_000)
    expect(section).not.toContain('old line')
    expect(section).toMatch(/YOUR opening line/)
  })
})
