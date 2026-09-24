import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeJsonFile, uniqueTmpPath, writeJsonFileAtomic } from './safe-json-file'

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

let dir = ''
let target = ''

function makeFile(): SafeJsonFile<string[]> {
  return new SafeJsonFile<string[]>({
    filePath: () => target,
    parse: (raw) =>
      Array.isArray(raw) && raw.every((entry) => typeof entry === 'string') ? raw : undefined,
    fallback: () => [],
    label: '[test] list.json'
  })
}

function quarantineCopies(): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('list.json.unreadable-'))
}

function tmpLeftovers(): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'))
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dobius-safe-json-'))
  target = path.join(dir, 'list.json')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  chmodSync(dir, 0o755)
  if (existsSync(target)) {
    chmodSync(target, 0o644)
  }
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('SafeJsonFile unreadable originals', () => {
  const cases: {
    name: string
    bytes: string
    mode?: number
    detail: string
    quarantined: boolean
  }[] = [
    { name: 'malformed JSON', bytes: '{not json', detail: 'invalid JSON', quarantined: true },
    {
      name: 'partial / truncated write',
      bytes: '["alpha", "be',
      detail: 'invalid JSON',
      quarantined: true
    },
    {
      name: 'wrong top-level shape',
      bytes: '{"a":1}',
      detail: 'unexpected JSON shape',
      quarantined: true
    },
    // Why: an EACCES file can't be copied either; quarantine is best-effort there.
    { name: 'EACCES on read', bytes: '["kept"]', mode: 0o000, detail: 'EACCES', quarantined: false }
  ]

  it.each(cases)('$name: never writes the original on load or save', (testCase) => {
    if (testCase.mode !== undefined && isRoot) {
      return
    }
    writeFileSync(target, testCase.bytes, 'utf-8')
    if (testCase.mode !== undefined) {
      chmodSync(target, testCase.mode)
    }
    const file = makeFile()

    expect(file.get()).toEqual([])
    expect(file.getStatus()).toEqual({ status: 'unreadable', detail: testCase.detail })
    expect(file.set(['new'])).toBe(false)
    // Session-only value survives in memory while the file stays unreadable.
    expect(file.get()).toEqual(['new'])

    chmodSync(target, 0o644)
    expect(readFileSync(target, 'utf-8')).toBe(testCase.bytes)
    expect(tmpLeftovers()).toEqual([])
    const copies = quarantineCopies()
    expect(copies).toHaveLength(testCase.quarantined ? 1 : 0)
    if (testCase.quarantined) {
      expect(readFileSync(path.join(dir, copies[0]), 'utf-8')).toBe(testCase.bytes)
    }
  })

  it('creates the quarantine copy only once for the same bad file', () => {
    writeFileSync(target, '{broken', 'utf-8')
    const file = makeFile()
    for (let i = 0; i < 5; i += 1) {
      file.get()
      file.set(['x'])
    }
    expect(quarantineCopies()).toHaveLength(1)
  })

  it('recovers without restart once the file is repaired', () => {
    writeFileSync(target, '{broken', 'utf-8')
    const file = makeFile()
    expect(file.get()).toEqual([])

    writeFileSync(target, '["repaired"]', 'utf-8')
    expect(file.get()).toEqual(['repaired'])
    expect(file.getStatus().status).toBe('ok')
    expect(file.set(['repaired', 'next'])).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual(['repaired', 'next'])
  })

  it('refuses a save derived from the session copy when the file was just repaired', () => {
    writeFileSync(target, '{broken', 'utf-8')
    const file = makeFile()
    const sessionValue = [...file.get(), 'session-only']

    writeFileSync(target, '["repaired"]', 'utf-8')
    expect(file.set(sessionValue)).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe('["repaired"]')
    expect(file.get()).toEqual(['repaired'])
  })
})

describe('SafeJsonFile missing and ok files', () => {
  it('missing file returns the first-run default and creates nothing on load', () => {
    const file = makeFile()
    expect(file.get()).toEqual([])
    expect(file.getStatus().status).toBe('missing')
    expect(readdirSync(dir)).toEqual([])
    expect(file.set(['first'])).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual(['first'])
  })

  it('EACCES on write keeps the original intact and leaves no temp file', () => {
    if (isRoot) {
      return
    }
    writeFileSync(target, '["original"]', 'utf-8')
    const file = makeFile()
    expect(file.get()).toEqual(['original'])
    chmodSync(dir, 0o555)

    expect(file.set(['changed'])).toBe(false)
    chmodSync(dir, 0o755)
    expect(readFileSync(target, 'utf-8')).toBe('["original"]')
    expect(tmpLeftovers()).toEqual([])
  })

  it('rename failure removes the temp file and rethrows', () => {
    const dirTarget = path.join(dir, 'occupied')
    mkdirSync(path.join(dirTarget, 'child'), { recursive: true })

    expect(() => writeJsonFileAtomic(dirTarget, ['x'])).toThrow()
    expect(readdirSync(dir).sort()).toEqual(['occupied'])
  })

  it('two writers use unique temp names and leave one valid file', () => {
    const first = uniqueTmpPath(target)
    const second = uniqueTmpPath(target)
    expect(first).not.toBe(second)
    expect(first).toContain(`.${process.pid}.`)

    const writerA = makeFile()
    const writerB = makeFile()
    writerA.get()
    writerB.get()
    expect(writerA.set(['a'])).toBe(true)
    expect(writerB.set(['b'])).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual(['b'])
    expect(tmpLeftovers()).toEqual([])
  })
})
