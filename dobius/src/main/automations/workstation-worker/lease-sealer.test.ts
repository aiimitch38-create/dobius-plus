import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync as fsWriteSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { openDurableLeaseSealer } from './lease-sealer'
import { writeAndPublishKey } from './lease-sealer-key-file'

const temporaryRoots: string[] = []
const TEST_TOKEN = 'lease-token-fixture-'.padEnd(48, 'x')

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('durable workstation lease sealer', () => {
  it('loops through short writes and publishes only the complete verified key', () => {
    const stateDirectory = fixtureDirectory()
    const temporaryPath = join(stateDirectory, '.candidate-key.tmp')
    const keyPath = join(stateDirectory, 'lease-sealer.key')
    const key = randomBytes(32)
    let writeCalls = 0

    writeAndPublishKey(temporaryPath, keyPath, key, (fd, buffer, offset, length, position) => {
      writeCalls += 1
      return fsWriteSync(fd, buffer, offset, Math.min(length, 5), position)
    })

    expect(writeCalls).toBeGreaterThan(1)
    expect(readFileSync(keyPath)).toEqual(key)
    expect(existsSync(temporaryPath)).toBe(false)
  })

  it('refuses zero-progress short writes and cleans up without publishing a key', () => {
    const stateDirectory = fixtureDirectory()
    const temporaryPath = join(stateDirectory, '.candidate-key.tmp')
    const keyPath = join(stateDirectory, 'lease-sealer.key')
    const key = randomBytes(32)
    let writeCalls = 0

    expect(() =>
      writeAndPublishKey(temporaryPath, keyPath, key, (fd, buffer, offset, length, position) => {
        writeCalls += 1
        if (writeCalls > 1) {
          return 0
        }
        return fsWriteSync(fd, buffer, offset, Math.min(length, 7), position)
      })
    ).toThrow(/no valid progress/)

    expect(writeCalls).toBe(2)
    expect(existsSync(keyPath)).toBe(false)
    expect(existsSync(temporaryPath)).toBe(false)
  })

  it('preserves a pre-existing exclusive temp file and the open error', () => {
    const stateDirectory = fixtureDirectory()
    const temporaryPath = join(stateDirectory, '.candidate-key.tmp')
    const keyPath = join(stateDirectory, 'lease-sealer.key')
    const contents = Buffer.from('another initializer owns this temporary file')
    writeFileSync(temporaryPath, contents, { mode: 0o600 })

    expect(() => writeAndPublishKey(temporaryPath, keyPath, randomBytes(32))).toThrow()

    expect(readFileSync(temporaryPath)).toEqual(contents)
    expect(existsSync(keyPath)).toBe(false)
  })

  it('verifies temporary key contents before publishing', () => {
    const stateDirectory = fixtureDirectory()
    const temporaryPath = join(stateDirectory, '.candidate-key.tmp')
    const keyPath = join(stateDirectory, 'lease-sealer.key')
    const key = randomBytes(32)

    expect(() =>
      writeAndPublishKey(temporaryPath, keyPath, key, (fd, buffer, offset, length, position) => {
        const written = fsWriteSync(fd, buffer, offset, length, position)
        fsWriteSync(fd, Buffer.from([buffer[offset]! ^ 0xff]), 0, 1, 0)
        return written
      })
    ).toThrow(/temporary verification failed/)

    expect(existsSync(keyPath)).toBe(false)
    expect(existsSync(temporaryPath)).toBe(false)
  })

  it('initializes one key concurrently in two processes and shares the resulting identity', async () => {
    const stateDirectory = fixtureDirectory()
    const journalPath = join(stateDirectory, 'attempt.json')
    const modulePath = transpileSealerFixture(stateDirectory)
    const script = `const {openDurableLeaseSealer}=require(process.argv[1]); const s=openDurableLeaseSealer({stateDirectory:process.argv[2],journalPath:process.argv[3]}); process.stdout.write(s.seal(process.env.FIXTURE_TOKEN));`
    const results = await Promise.all([
      runNodeFixture(script, [modulePath, stateDirectory, journalPath]),
      runNodeFixture(script, [modulePath, stateDirectory, journalPath])
    ])
    const sealer = openDurableLeaseSealer({ stateDirectory, journalPath })
    expect(results).toHaveLength(2)
    for (const sealed of results) {
      expect(sealed).toMatch(/^sealed:v1:/)
      expect(sealer.unseal(sealed)).toBe(TEST_TOKEN)
    }
    const key = readFileSync(join(stateDirectory, 'lease-sealer.key'))
    expect(key).toHaveLength(32)
    expect(statSync(join(stateDirectory, 'lease-sealer.key')).mode & 0o777).toBe(0o600)
  })

  it('decrypts a persisted lease after a fresh sealer instance is created', () => {
    const stateDirectory = fixtureDirectory()
    const journalPath = join(stateDirectory, 'attempt.json')
    const first = openDurableLeaseSealer({ stateDirectory, journalPath })
    const persisted = first.seal(TEST_TOKEN)
    writeFileSync(journalPath, JSON.stringify({ lease: { token: persisted } }), { mode: 0o600 })
    const restarted = openDurableLeaseSealer({ stateDirectory, journalPath })
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { lease: { token: string } }
    expect(restarted.unseal(journal.lease.token)).toBe(TEST_TOKEN)
  })

  it('rejects authenticated-data tampering and unsupported versions', () => {
    const sealer = openFixtureSealer()
    const sealed = sealer.seal(TEST_TOKEN)
    const payload = Buffer.from(sealed.slice('sealed:v1:'.length), 'base64url')
    payload[15] = payload[15]! ^ 1
    expect(() => sealer.unseal(`sealed:v1:${payload.toString('base64url')}`)).toThrow(
      /authentication failed/
    )
    expect(() => sealer.unseal(sealed.replace('sealed:v1:', 'sealed:v2:'))).toThrow(
      /unsupported format or version/
    )
    expect(() => sealer.unseal(`sealed:v1:${'A'.repeat(10_000)}`)).toThrow(/size bounds/)
  })

  it('rejects symlink, FIFO, non-private, and malformed key files without blocking', () => {
    const symlinkState = fixtureDirectory()
    const symlinkKey = join(symlinkState, 'lease-sealer.key')
    const externalKey = join(symlinkState, 'external-key')
    writeFileSync(externalKey, randomBytes(32), { mode: 0o600 })
    symlinkSync(externalKey, symlinkKey)
    expect(() =>
      openDurableLeaseSealer({
        stateDirectory: symlinkState,
        journalPath: join(symlinkState, 'attempt.json')
      })
    ).toThrow()

    const fifoState = fixtureDirectory()
    execFileSync('mkfifo', [join(fifoState, 'lease-sealer.key')])
    expect(() =>
      openDurableLeaseSealer({
        stateDirectory: fifoState,
        journalPath: join(fifoState, 'attempt.json')
      })
    ).toThrow(/regular/)

    const broadState = fixtureDirectory()
    chmodSync(broadState, 0o750)
    expect(() =>
      openDurableLeaseSealer({
        stateDirectory: broadState,
        journalPath: join(broadState, 'attempt.json')
      })
    ).toThrow(/0700/)

    const corruptState = fixtureDirectory()
    writeFileSync(join(corruptState, 'lease-sealer.key'), randomBytes(31), { mode: 0o600 })
    expect(() =>
      openDurableLeaseSealer({
        stateDirectory: corruptState,
        journalPath: join(corruptState, 'attempt.json')
      })
    ).toThrow(/32 bytes/)

    const broadKeyState = fixtureDirectory()
    writeFileSync(join(broadKeyState, 'lease-sealer.key'), randomBytes(32), { mode: 0o644 })
    expect(() =>
      openDurableLeaseSealer({
        stateDirectory: broadKeyState,
        journalPath: join(broadKeyState, 'attempt.json')
      })
    ).toThrow(/mode 0600/)
  })

  it('refuses missing-key rotation when a journal exists and preserves the journal byte-for-byte', () => {
    const stateDirectory = fixtureDirectory()
    const journalPath = join(stateDirectory, 'attempt.json')
    const journalContents = '{"lease":{"token":"sealed:v1:old-value"}}\n'
    writeFileSync(journalPath, journalContents, { mode: 0o600 })
    expect(() => openDurableLeaseSealer({ stateDirectory, journalPath })).toThrow(/journal exists/)
    expect(readFileSync(journalPath, 'utf8')).toBe(journalContents)
    expect(existsSync(join(stateDirectory, 'lease-sealer.key'))).toBe(false)
  })

  it('detects an in-process key replacement and rejects a replaced restart key by authentication', () => {
    const stateDirectory = fixtureDirectory()
    const journalPath = join(stateDirectory, 'attempt.json')
    const sealer = openDurableLeaseSealer({ stateDirectory, journalPath })
    const sealed = sealer.seal(TEST_TOKEN)
    writeFileSync(journalPath, sealed, { mode: 0o600 })
    const keyPath = join(stateDirectory, 'lease-sealer.key')
    renameSync(keyPath, `${keyPath}.old`)
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 })
    expect(() => sealer.seal(TEST_TOKEN)).toThrow(/identity changed/)
    const restarted = openDurableLeaseSealer({ stateDirectory, journalPath })
    expect(() => restarted.unseal(sealed)).toThrow(/authentication failed/)
    expect(readFileSync(journalPath, 'utf8')).toBe(sealed)
  })
})

it.skipIf(process.platform !== 'win32')('refuses Windows without an ACL ownership proof', () => {
  expect(() =>
    openDurableLeaseSealer({
      stateDirectory: 'C:\\state',
      journalPath: 'C:\\state\\attempt.json'
    })
  ).toThrow(/unsupported/)
})

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'dobius-lease-sealer-'))
  chmodSync(directory, 0o700)
  const canonical = realpathSync(directory)
  temporaryRoots.push(canonical)
  return canonical
}

function openFixtureSealer() {
  const stateDirectory = fixtureDirectory()
  return openDurableLeaseSealer({
    stateDirectory,
    journalPath: join(stateDirectory, 'attempt.json')
  })
}

function transpileSealerFixture(directory: string) {
  const source = readFileSync(new URL('./lease-sealer.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const keySource = readFileSync(new URL('./lease-sealer-key-file.ts', import.meta.url), 'utf8')
  const keyOutput = ts.transpileModule(keySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const modulePath = join(directory, 'lease-sealer-fixture.cjs')
  writeFileSync(join(directory, 'lease-sealer-key-file.js'), keyOutput, { mode: 0o600 })
  writeFileSync(modulePath, output, { mode: 0o600 })
  return modulePath
}

async function runNodeFixture(script: string, args: string[]) {
  const child = spawn(process.execPath, ['-e', script, ...args], {
    env: { PATH: process.env.PATH, FIXTURE_TOKEN: TEST_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  const errors: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
  const [code] = (await once(child, 'close')) as [number | null]
  if (code !== 0) {
    throw new Error(`Sealer subprocess exited ${code}: ${Buffer.concat(errors).toString('utf8')}`)
  }
  return Buffer.concat(chunks).toString('utf8')
}
