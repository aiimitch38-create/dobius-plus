import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAdamHermesRuntime, adamHermesEnvironment } from './adam-hermes-runtime'

const directories: string[] = []
afterEach(() => {
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  vi.unstubAllEnvs()
})
function fixture(platform: NodeJS.Platform = 'darwin') {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'hermes-runtime-')))
  directories.push(home)
  const root = join(home, '.hermes', 'hermes-agent')
  const profileHome = join(home, '.hermes', 'profiles', 'adam')
  const python =
    platform === 'win32'
      ? join(root, 'venv', 'Scripts', 'python.exe')
      : join(root, 'venv', 'bin', 'python')
  for (const file of [
    python,
    join(root, 'tui_gateway', 'entry.py'),
    join(profileHome, 'config.yaml')
  ]) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '')
  }
  return { home, root, profileHome, python }
}
describe('Adam Hermes runtime discovery', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'uses the existing Adam profile on %s',
    async (platform) => {
      const { home, ...runtime } = fixture(platform)
      expect(await resolveAdamHermesRuntime({ home, platform, env: {} })).toEqual(runtime)
    }
  )
  it('preserves the venv executable path when Python is a symlink', async () => {
    const { home, python, ...runtime } = fixture()
    const target = join(home, 'python-real')
    writeFileSync(target, '')
    rmSync(python)
    symlinkSync(target, python)
    expect(await resolveAdamHermesRuntime({ home, env: {} })).toEqual({ ...runtime, python })
  })
  it('returns unavailable without an existing configured Adam profile', async () => {
    const { home, profileHome } = fixture()
    rmSync(join(profileHome, 'config.yaml'))
    expect(await resolveAdamHermesRuntime({ home, env: {} })).toBeNull()
  })
  it('removes inherited terminal/session/voice settings without exporting credentials', () => {
    vi.stubEnv('HERMES_HOME', '/wrong-profile')
    vi.stubEnv('HERMES_TUI_SIDECAR_URL', 'https://unwanted-sidecar')
    vi.stubEnv('HERMES_SESSION_ID', 'unrelated-tui')
    vi.stubEnv('HERMES_IGNORE_RULES', '1')
    vi.stubEnv('PYTHONPATH', '/unrelated-python')
    vi.stubEnv('DOBIUS_RUNTIME_SCOPE', 'agent')
    const { home: _home, ...runtime } = fixture()
    const env = adamHermesEnvironment(runtime)
    expect(env.HERMES_HOME).toBe(runtime.profileHome)
    expect(env.HERMES_PYTHON_SRC_ROOT).toBe(runtime.root)
    for (const key of [
      'HERMES_SESSION_ID',
      'HERMES_TUI_SIDECAR_URL',
      'HERMES_IGNORE_RULES',
      'PYTHONPATH',
      // ADAM is never scoped down to a worker's reduced command line.
      'DOBIUS_RUNTIME_SCOPE'
    ]) {
      expect(env[key]).toBeUndefined()
    }
  })
  it('follows the published release command instead of an obsolete source checkout', async () => {
    const { home, python, profileHome } = fixture()
    const launcher = join(home, '.local', 'bin', 'hermes')
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '')
    const args = ['-I', '-c', 'installation-bound bootstrap']
    const readCommand = vi.fn(async () => [python, ...args])
    expect(await resolveAdamHermesRuntime({ home, env: {}, readCommand })).toEqual({
      python,
      args,
      root: home,
      profileHome
    })
    expect(readCommand).toHaveBeenCalledWith(launcher, profileHome)
  })
})
