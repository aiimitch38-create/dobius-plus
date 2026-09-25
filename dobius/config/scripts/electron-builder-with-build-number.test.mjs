import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allocateBuildNumber } from './electron-builder-with-build-number.mjs'

const roots = []
function counterIn() {
  const root = mkdtempSync(path.join(tmpdir(), 'dobius-build-number-'))
  roots.push(root)
  return path.join(root, 'build-number')
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('build number allocation (BUILD-044)', () => {
  it('gives two consecutive builds increasing build numbers and records the last one', () => {
    const counterFile = counterIn()

    const first = allocateBuildNumber({ counterFile })
    const second = allocateBuildNumber({ counterFile })

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(readFileSync(counterFile, 'utf8')).toBe('2\n')
    expect(existsSync(`${counterFile}.lock`)).toBe(false)
  })

  it('continues from an existing counter', () => {
    const counterFile = counterIn()
    writeFileSync(counterFile, '41\n')

    expect(allocateBuildNumber({ counterFile })).toBe(42)
  })

  it('refuses a corrupt counter instead of restarting and reusing numbers', () => {
    const counterFile = counterIn()
    writeFileSync(counterFile, 'garbage')

    expect(() => allocateBuildNumber({ counterFile })).toThrow('is not a positive integer')
    expect(readFileSync(counterFile, 'utf8')).toBe('garbage')
    expect(existsSync(`${counterFile}.lock`)).toBe(false)
  })

  it('waits on a held lock and reports it instead of breaking it', () => {
    const counterFile = counterIn()
    writeFileSync(counterFile, '7\n')
    mkdirSync(`${counterFile}.lock`)

    expect(() => allocateBuildNumber({ counterFile, lockWaitMs: 200 })).toThrow('is held')
    expect(readFileSync(counterFile, 'utf8')).toBe('7\n')
    expect(existsSync(`${counterFile}.lock`)).toBe(true)
  })

  it('hands the number to electron-builder through DOBIUS_BUILD_NUMBER', () => {
    const counterFile = counterIn()
    writeFileSync(counterFile, '9\n')
    // A stand-in electron-builder first on PATH that prints what it received.
    const shimDir = path.join(path.dirname(counterFile), 'bin')
    mkdirSync(shimDir)
    writeFileSync(
      path.join(shimDir, 'electron-builder'),
      '#!/bin/sh\necho "number=$DOBIUS_BUILD_NUMBER args=$*"\nexit 3\n',
      { mode: 0o755 }
    )

    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, 'electron-builder-with-build-number.mjs'), '--dir'],
      {
        encoding: 'utf8',
        env: {
          PATH: `${shimDir}:${process.env.PATH}`,
          DOBIUS_BUILD_NUMBER_FILE: counterFile
        }
      }
    )

    expect(result.stdout).toContain('number=10 args=--dir')
    // electron-builder's own exit code is passed through.
    expect(result.status).toBe(3)
    expect(readFileSync(counterFile, 'utf8')).toBe('10\n')
  })
})
