import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPrivateCloudWorkerCapacityReader } from './cloud-worker-private-capacity'

const directories: string[] = []
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'private-worker-capacity-')))
  chmodSync(base, 0o700)
  directories.push(base)
  const file = join(base, 'worker-capacity.json')
  const receipt = {
    schemaVersion: 1,
    deviceId: 'vps',
    sample: {
      freeBytes: 1000,
      externalReservedBytes: 200,
      safetyBytes: 100,
      sampledAt: 100_000
    }
  }
  const save = () => writeFileSync(file, JSON.stringify(receipt), { mode: 0o600 })
  return {
    base,
    file,
    receipt,
    save,
    read: createPrivateCloudWorkerCapacityReader(base, 'vps', () => 100_000)
  }
}
describe('trusted private capacity admission', () => {
  it('does not invent zero external reservations when telemetry is missing', () => {
    const f = fixture()
    expect(() => f.read('vps')).toThrow()
    f.save()
    expect(f.read('vps')).toEqual(f.receipt.sample)
    expect(() => f.read('laptop')).toThrow('another device')
  })
  it('rejects stale, future and wrong-device capacity receipts', () => {
    const f = fixture()
    for (const time of [94_999, 100_001]) {
      f.receipt.sample.sampledAt = time
      f.save()
      expect(() => f.read('vps')).toThrow('stale')
    }
    f.receipt.sample.sampledAt = 100_000
    f.receipt.deviceId = 'other'
    f.save()
    expect(() => f.read('vps')).toThrow('misbound')
  })
  it('rejects nonprivate files and symlink substitutions', () => {
    const f = fixture()
    f.save()
    chmodSync(f.file, 0o644)
    expect(() => f.read('vps')).toThrow()
    rmSync(f.file)
    const other = join(f.base, 'other.json')
    writeFileSync(other, JSON.stringify(f.receipt), { mode: 0o600 })
    symlinkSync(other, f.file)
    expect(() => f.read('vps')).toThrow()
  })
})
