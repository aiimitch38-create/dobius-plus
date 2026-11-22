import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIVE_METER_MAX_SLICE_SEC, LiveVoiceMeter, estimateLiveUsd, localDayKey } from './live-voice-meter'

let dir = ''
let file = ''
let now = 0
const clock = (): number => now

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'live-meter-'))
  file = join(dir, 'live-voice-meter.json')
  now = new Date(2026, 10, 22, 10, 0, 0).getTime()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('LiveVoiceMeter', () => {
  it('counts active and standby seconds at their own rates', () => {
    const meter = new LiveVoiceMeter(file, clock)
    meter.start()
    now += 60_000
    meter.accrue()
    meter.setStandby(true)
    now += 100_000
    meter.stop()
    const status = meter.status(15)
    expect(status.activeSec).toBe(60)
    expect(status.standbySec).toBe(100)
    expect(status.usdToday).toBeCloseTo(0.05 + (100 / 60) * 0.02, 6)
  })

  it('saves the day total and reads it back after a restart', () => {
    const meter = new LiveVoiceMeter(file, clock)
    meter.start()
    now += 90_000
    meter.stop()
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.days[localDayKey(now)].activeSec).toBe(90)
    expect(new LiveVoiceMeter(file, clock).status(15).activeSec).toBe(90)
  })

  it('starts a fresh total on a new day', () => {
    const meter = new LiveVoiceMeter(file, clock)
    meter.start()
    now += 60_000
    meter.stop()
    now += 24 * 60 * 60 * 1000
    expect(meter.status(15).usdToday).toBe(0)
  })

  it('flags near-cap at 80 percent and over-cap at 100 percent', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, days: { [localDayKey(now)]: { activeSec: 60 * 16, standbySec: 0 } } })
    )
    const meter = new LiveVoiceMeter(file, clock)
    expect(meter.status(1)).toMatchObject({ nearCap: true, overCap: false })
    meter.start()
    for (let i = 0; i < 5; i += 1) {
      now += 60_000
      meter.accrue()
    }
    expect(meter.status(1)).toMatchObject({ overCap: true })
  })

  it('never bills a long sleep as one slice', () => {
    const meter = new LiveVoiceMeter(file, clock)
    meter.start()
    now += 3 * 60 * 60 * 1000
    meter.stop()
    expect(meter.status(15).activeSec).toBe(LIVE_METER_MAX_SLICE_SEC)
  })

  it('treats a damaged file as zero', () => {
    writeFileSync(file, '{not json')
    expect(new LiveVoiceMeter(file, clock).status(15).usdToday).toBe(0)
  })

  it('estimates per the published per-minute prices', () => {
    expect(estimateLiveUsd({ activeSec: 120 * 60, standbySec: 360 * 60 })).toBeCloseTo(13.2, 6)
  })
})
