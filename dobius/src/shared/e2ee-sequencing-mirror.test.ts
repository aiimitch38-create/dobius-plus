import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: the Expo app cannot import src/shared, so it carries a copy of the
// frame-sequencing code. A drift would make phone and desktop disagree on the
// nonce layout and every v2 session would fail.
function code(path: string): string {
  return readFileSync(join(__dirname, path), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

describe('mobile e2ee-sequencing mirror', () => {
  it('matches src/shared/e2ee-sequencing.ts apart from comments', () => {
    expect(code('../../mobile/src/transport/e2ee-sequencing.ts')).toBe(code('./e2ee-sequencing.ts'))
  })
})
