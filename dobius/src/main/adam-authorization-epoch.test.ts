import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAdamAuthorizationEpoch } from './adam-authorization-epoch'

const paths: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of paths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adam-auth-epoch-'))
  paths.push(root)
  vi.stubEnv('ADAM_SERVICE_URL', 'http://127.0.0.1:8999')
  vi.stubEnv('ADAM_SERVICE_TOKEN', '')
  vi.stubEnv('DOBIUS_ADAM_TOKEN_PATH', '')
  vi.stubEnv('DOBIUS_ADAM_PROJECT_DIR', root)
  const file = join(root, 'credential')
  vi.stubEnv('ADAM_SERVICE_TOKEN_PATH', file)
  return { root, file }
}
describe('synchronous opaque ADAM authorization epoch', () => {
  it('detects environment credential and endpoint changes without exposing token bytes', () => {
    fixture()
    vi.stubEnv('ADAM_SERVICE_TOKEN', 'synthetic-credential-A')
    const one = captureAdamAuthorizationEpoch()
    expect(one).toMatch(/^[a-f0-9]{64}$/)
    expect(captureAdamAuthorizationEpoch()).toBe(one)
    vi.stubEnv('ADAM_SERVICE_TOKEN', 'synthetic-credential-B')
    const two = captureAdamAuthorizationEpoch()
    expect(two).not.toBe(one)
    vi.stubEnv('ADAM_SERVICE_URL', 'http://127.0.0.1:8998')
    expect(captureAdamAuthorizationEpoch()).not.toBe(two)
  })

  it('detects private file rotation and rejects missing, public and symlink sources', () => {
    const f = fixture()
    expect(captureAdamAuthorizationEpoch()).toBeNull()
    writeFileSync(f.file, 'synthetic-A\n', { mode: 0o600 })
    const one = captureAdamAuthorizationEpoch()
    expect(one).toMatch(/^[a-f0-9]{64}$/)
    writeFileSync(f.file, 'synthetic-B\n')
    expect(captureAdamAuthorizationEpoch()).not.toBe(one)
    chmodSync(f.file, 0o644)
    expect(captureAdamAuthorizationEpoch()).toBeNull()
    rmSync(f.file)
    const other = join(f.root, 'other')
    writeFileSync(other, 'synthetic-C', { mode: 0o600 })
    symlinkSync(other, f.file)
    expect(captureAdamAuthorizationEpoch()).toBeNull()
  })

  it('uses the same legacy/default precedence and refuses oversized or invalid header bytes', () => {
    const f = fixture()
    vi.stubEnv('ADAM_SERVICE_TOKEN_PATH', '')
    vi.stubEnv('DOBIUS_ADAM_TOKEN_PATH', f.file)
    writeFileSync(f.file, 'synthetic-legacy', { mode: 0o600 })
    expect(captureAdamAuthorizationEpoch()).toMatch(/^[a-f0-9]{64}$/)
    writeFileSync(f.file, 'a'.repeat(16 * 1024 + 1))
    expect(captureAdamAuthorizationEpoch()).toBeNull()
    vi.stubEnv('DOBIUS_ADAM_TOKEN_PATH', '')
    mkdirSync(join(f.root, 'service/data'), { recursive: true })
    writeFileSync(join(f.root, 'service/data/service-token'), 'synthetic-default', { mode: 0o600 })
    expect(captureAdamAuthorizationEpoch()).toMatch(/^[a-f0-9]{64}$/)
    vi.stubEnv('ADAM_SERVICE_TOKEN', 'synthetic\ninvalid')
    expect(captureAdamAuthorizationEpoch()).toBeNull()
  })
})
