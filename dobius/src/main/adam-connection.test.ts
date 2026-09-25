import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_ADAM_ENDPOINT } from '../shared/constants'
import {
  adamProjectDirectory,
  resolveAdamEndpoint,
  resolveAdamToken,
  setAdamEndpointSettingReader
} from './adam-connection'

const ENV_KEYS = [
  'ADAM_SERVICE_URL',
  'ADAM_SERVICE_TOKEN',
  'ADAM_SERVICE_TOKEN_PATH',
  'DOBIUS_ADAM_TOKEN_PATH',
  'DOBIUS_ADAM_PROJECT_DIR'
]
const FAKE_TOKEN = 'fake-token-not-real'
let savedEnv: Record<string, string | undefined> = {}
let tempRoot = ''

function makeAdamDir(token?: string): string {
  const dir = join(tempRoot, 'ADAM')
  mkdirSync(join(dir, 'service', 'data'), { recursive: true })
  if (token !== undefined) {
    writeFileSync(join(dir, 'service', 'data', 'service-token'), token)
  }
  process.env.DOBIUS_ADAM_PROJECT_DIR = dir
  return dir
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  tempRoot = mkdtempSync(join(tmpdir(), 'adam-connection-'))
  setAdamEndpointSettingReader(() => undefined)
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  setAdamEndpointSettingReader(() => undefined)
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('adamProjectDirectory (#118)', () => {
  it('defaults under the given home and honors the configured location', () => {
    expect(adamProjectDirectory('/home/alt')).toBe(join('/home/alt', 'dobius', 'projects', 'ADAM'))
    expect(adamProjectDirectory()).toBe(join(homedir(), 'dobius', 'projects', 'ADAM'))
    process.env.DOBIUS_ADAM_PROJECT_DIR = '/opt/adam'
    expect(adamProjectDirectory('/home/alt')).toBe('/opt/adam')
  })
})

describe('resolveAdamEndpoint (#81)', () => {
  it('follows env, then the live Settings reader, then the default', () => {
    expect(resolveAdamEndpoint()).toBe(DEFAULT_ADAM_ENDPOINT)
    let setting = 'http://adam.one:9000//'
    setAdamEndpointSettingReader(() => setting)
    expect(resolveAdamEndpoint()).toBe('http://adam.one:9000')
    setting = 'http://adam.two:9000'
    expect(resolveAdamEndpoint()).toBe('http://adam.two:9000')
    expect(resolveAdamEndpoint('http://explicit.test')).toBe('http://explicit.test')
    setting = '   '
    expect(resolveAdamEndpoint()).toBe(DEFAULT_ADAM_ENDPOINT)
    process.env.ADAM_SERVICE_URL = 'http://env.test/'
    expect(resolveAdamEndpoint('http://explicit.test')).toBe('http://env.test')
  })
})

describe('resolveAdamToken (#81, #118)', () => {
  it('reports not-installed without touching disk when the ADAM folder is missing', async () => {
    process.env.DOBIUS_ADAM_PROJECT_DIR = join(tempRoot, 'nowhere')
    await expect(resolveAdamToken()).resolves.toEqual({
      token: undefined,
      state: 'not-installed',
      detail: 'ADAM folder not found'
    })
  })

  it('reports no-token when ADAM is installed but the token file is missing or empty', async () => {
    const dir = makeAdamDir()
    await expect(resolveAdamToken()).resolves.toEqual({
      token: undefined,
      state: 'no-token',
      detail: 'token file ENOENT'
    })
    writeFileSync(join(dir, 'service', 'data', 'service-token'), '  \n')
    await expect(resolveAdamToken()).resolves.toMatchObject({ state: 'no-token', detail: 'token file is empty' })
  })

  it('re-reads the token every call so an install or rotation applies without restart', async () => {
    process.env.DOBIUS_ADAM_PROJECT_DIR = join(tempRoot, 'ADAM')
    await expect(resolveAdamToken()).resolves.toMatchObject({ state: 'not-installed' })
    const dir = makeAdamDir(`${FAKE_TOKEN}-1\n`)
    await expect(resolveAdamToken()).resolves.toEqual({ token: `${FAKE_TOKEN}-1` })
    writeFileSync(join(dir, 'service', 'data', 'service-token'), `${FAKE_TOKEN}-2\n`)
    await expect(resolveAdamToken()).resolves.toEqual({ token: `${FAKE_TOKEN}-2` })
  })

  it('applies one precedence: env token, then explicit path, then legacy path, then ADAM folder', async () => {
    makeAdamDir('from-folder')
    const legacy = join(tempRoot, 'legacy-token')
    const explicit = join(tempRoot, 'explicit-token')
    writeFileSync(legacy, 'from-legacy')
    writeFileSync(explicit, 'from-explicit')
    await expect(resolveAdamToken()).resolves.toEqual({ token: 'from-folder' })
    process.env.DOBIUS_ADAM_TOKEN_PATH = legacy
    await expect(resolveAdamToken()).resolves.toEqual({ token: 'from-legacy' })
    process.env.ADAM_SERVICE_TOKEN_PATH = explicit
    await expect(resolveAdamToken()).resolves.toEqual({ token: 'from-explicit' })
    process.env.ADAM_SERVICE_TOKEN = 'from-env'
    await expect(resolveAdamToken()).resolves.toEqual({ token: 'from-env' })
  })

  it('an explicit token path works even without an ADAM folder on this machine', async () => {
    process.env.DOBIUS_ADAM_PROJECT_DIR = join(tempRoot, 'nowhere')
    process.env.ADAM_SERVICE_TOKEN_PATH = join(tempRoot, 'explicit-token')
    writeFileSync(process.env.ADAM_SERVICE_TOKEN_PATH, FAKE_TOKEN)
    await expect(resolveAdamToken()).resolves.toEqual({ token: FAKE_TOKEN })
  })
})
