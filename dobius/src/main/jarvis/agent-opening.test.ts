import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildOpeningLine } from './agent-context'

function historyWith(dir: string, mtimeSeconds: number): string {
  const root = mkdtempSync(join(tmpdir(), 'open-'))
  mkdirSync(join(root, dir), { recursive: true })
  const log = join(root, dir, 'output.log')
  writeFileSync(log, 'work')
  utimesSync(log, mtimeSeconds, mtimeSeconds)
  return root
}

describe('buildOpeningLine', () => {
  it('names the most recent project and how long ago', () => {
    const now = 10_000_000
    const root = historyWith('id::%2Ftmp%2Fpocket-cologne@@a', (now - 300_000) / 1000)
    expect(buildOpeningLine(root, now, ['Hey.'])).toBe(
      'Hey. Last thing I saw was pocket-cologne, 5 minutes ago.'
    )
  })

  it('says so when there is no history', () => {
    expect(buildOpeningLine('/nope/missing', 0, ['Hey.'])).toBe(
      'Hey. Nothing running that I can see.'
    )
  })

  it('rotates the greeting over time so openings are not identical', () => {
    const root = historyWith('id::%2Ftmp%2Fx@@a', 1_000)
    const a = buildOpeningLine(root, 0, ['One.', 'Two.'])
    const b = buildOpeningLine(root, 60_000, ['One.', 'Two.'])
    expect(a).not.toBe(b)
  })
})
