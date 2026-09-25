import { describe, expect, it } from 'vitest'
import { getDefaultUserDataPath } from './metadata'

// Why: the CLI must resolve the same userData directory Electron writes to —
// derived from package.json "name" ("dobius-plus"), captured before
// app.setName('Dobius+') runs (see persistence.ts's initDataPath()). A
// mismatch here silently breaks every CLI command that needs the runtime
// metadata file.
describe('getDefaultUserDataPath', () => {
  const homeDir = '/Users/example'

  it('resolves the package-name folder on macOS', () => {
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('darwin', homeDir)).toBe(
        '/Users/example/Library/Application Support/dobius-plus'
      )
    } finally {
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })

  it('resolves the package-name folder on Linux, respecting XDG_CONFIG_HOME', () => {
    const originalXdg = process.env.XDG_CONFIG_HOME
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    delete process.env.XDG_CONFIG_HOME
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('linux', homeDir)).toBe('/Users/example/.config/dobius-plus')
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = originalXdg
      }
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })

  it('resolves the package-name folder on Windows under APPDATA', () => {
    const originalAppData = process.env.APPDATA
    const originalDobius = process.env.DOBIUS_USER_DATA_PATH
    process.env.APPDATA = 'C:\\Users\\example\\AppData\\Roaming'
    delete process.env.DOBIUS_USER_DATA_PATH
    try {
      expect(getDefaultUserDataPath('win32', homeDir)).toBe(
        'C:\\Users\\example\\AppData\\Roaming/dobius-plus'
      )
    } finally {
      if (originalAppData === undefined) {
        delete process.env.APPDATA
      } else {
        process.env.APPDATA = originalAppData
      }
      if (originalDobius === undefined) {
        delete process.env.DOBIUS_USER_DATA_PATH
      } else {
        process.env.DOBIUS_USER_DATA_PATH = originalDobius
      }
    }
  })
})
