import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import {
  STALE_TEMP_MIN_AGE_MS,
  sweepStaleTempFiles,
  uniqueTmpPath,
  writeFileAtomic
} from './safe-json-file'

const { failures } = vi.hoisted(() => ({
  failures: { write: null as string | null, rename: null as string | null }
}))

// Why a pass-through mock: the failures under test (ENOSPC midway through a
// write, EXDEV/EPERM on rename) cannot be produced reliably on a real disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const fail = (code: string): never => {
    throw Object.assign(new Error(`${code}: injected`), { code })
  }
  const mocked = {
    ...actual,
    writeFileSync: ((file: Parameters<typeof actual.writeFileSync>[0], ...rest: unknown[]) => {
      if (failures.write && String(file).endsWith('.tmp')) {
        // Partial write: the temp exists with some bytes before the error.
        actual.writeFileSync(file, '{"partial":')
        fail(failures.write)
      }
      return (actual.writeFileSync as (...args: unknown[]) => void)(file, ...rest)
    }) as typeof actual.writeFileSync,
    renameSync: ((from: string, to: string) => {
      if (failures.rename) {
        fail(failures.rename)
      }
      actual.renameSync(from, to)
    }) as typeof actual.renameSync
  }
  return { ...mocked, default: mocked }
})

let dir = ''
let target = ''

function tmpLeftovers(): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'))
}

function makeTemp(name: string, ageMs: number): void {
  const file = path.join(dir, name)
  writeFileSync(file, 'residue')
  const when = (Date.now() - ageMs) / 1000
  utimesSync(file, when, when)
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dobius-temp-hygiene-'))
  target = path.join(dir, 'data.json')
  failures.write = null
  failures.rename = null
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('writeFileAtomic failure cleanup', () => {
  it('a write that throws midway leaves the primary intact and no temp', () => {
    writeFileSync(target, '{"good":true}')
    failures.write = 'ENOSPC'
    expect(() => writeFileAtomic(target, '{"next":true}')).toThrow('ENOSPC')
    expect(readFileSync(target, 'utf-8')).toBe('{"good":true}')
    expect(tmpLeftovers()).toEqual([])
  })

  it('a rename that throws leaves the primary intact and no temp', () => {
    writeFileSync(target, '{"good":true}')
    failures.rename = 'EPERM'
    expect(() => writeFileAtomic(target, '{"next":true}')).toThrow('EPERM')
    expect(readFileSync(target, 'utf-8')).toBe('{"good":true}')
    expect(tmpLeftovers()).toEqual([])
  })
})

describe('sweepStaleTempFiles', () => {
  const RE = /^data\.json\.(\d+)\.[\da-f]+\.tmp$/
  const OLD = STALE_TEMP_MIN_AGE_MS + 60_000

  it('removes old residue from this process and from dead processes', () => {
    const own = path.basename(uniqueTmpPath(target))
    // Why 2^31-2: far above any real pid, so `kill(pid, 0)` reports ESRCH.
    const dead = 'data.json.2147483646.abcdef.tmp'
    makeTemp(own, OLD)
    makeTemp(dead, OLD)
    expect(sweepStaleTempFiles(dir, RE).sort()).toEqual([dead, own].sort())
    expect(tmpLeftovers()).toEqual([])
  })

  it("keeps another live writer's temp even when it is old", () => {
    const live = `data.json.${process.ppid}.abcdef.tmp`
    makeTemp(live, OLD)
    expect(sweepStaleTempFiles(dir, RE)).toEqual([])
    expect(tmpLeftovers()).toEqual([live])
  })

  it('keeps a young temp that may still be mid-write', () => {
    const young = path.basename(uniqueTmpPath(target))
    makeTemp(young, 1_000)
    expect(sweepStaleTempFiles(dir, RE)).toEqual([])
    expect(tmpLeftovers()).toEqual([young])
  })

  it('never touches files that do not match the owned pattern', () => {
    makeTemp('other.json.1.abc.tmp', OLD)
    makeTemp('data.json', OLD)
    expect(sweepStaleTempFiles(dir, RE)).toEqual([])
    expect(readdirSync(dir).sort()).toEqual(['data.json', 'other.json.1.abc.tmp'])
  })

  it('treats a missing directory as nothing to sweep', () => {
    expect(sweepStaleTempFiles(path.join(dir, 'absent'), RE)).toEqual([])
  })
})
