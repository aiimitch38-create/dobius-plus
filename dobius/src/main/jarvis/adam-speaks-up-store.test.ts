import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBriefDayStore, createVerifiedHandleStore } from './adam-speaks-up-store'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adam-speaks-up-'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('createBriefDayStore', () => {
  it('saves the day so a restarted app sees it', () => {
    const file = join(dir, 'adam-morning-brief.json')
    expect(createBriefDayStore(() => file).setLastRunDate('2026-11-23')).toBe(true)
    expect(createBriefDayStore(() => file).lastRunDate()).toBe('2026-11-23')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lastRunDate: '2026-11-23' })
  })

  it('keeps the old day when the claim cannot be saved, so a later tick retries', () => {
    const folder = join(dir, 'locked')
    mkdirSync(folder)
    const store = createBriefDayStore(() => join(folder, 'adam-morning-brief.json'))
    expect(store.setLastRunDate('2026-11-22')).toBe(true)
    chmodSync(folder, 0o500)
    try {
      expect(store.setLastRunDate('2026-11-23')).toBe(false)
      expect(store.lastRunDate()).toBe('2026-11-22')
    } finally {
      chmodSync(folder, 0o700)
    }
    expect(store.setLastRunDate('2026-11-23')).toBe(true)
    expect(createBriefDayStore(() => join(folder, 'adam-morning-brief.json')).lastRunDate()).toBe(
      '2026-11-23'
    )
  })
})

describe('createVerifiedHandleStore', () => {
  it('saves and clears the verified handle', () => {
    const file = join(dir, 'adam-brief-handle.json')
    const store = createVerifiedHandleStore(() => file)
    expect(store.setVerifiedHandle('+15551234567')).toBe(true)
    expect(createVerifiedHandleStore(() => file).verifiedHandle()).toBe('+15551234567')
    expect(store.setVerifiedHandle(null)).toBe(true)
    expect(createVerifiedHandleStore(() => file).verifiedHandle()).toBeNull()
  })
})
