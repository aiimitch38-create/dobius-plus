import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allocateBuildNumber, collectSourceState } from './electron-builder-with-build-number.mjs'

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
      '#!/bin/sh\necho "number=$DOBIUS_BUILD_NUMBER args=$*"\ncat "$DOBIUS_BUILD_PROVENANCE_FILE"\necho "record=$DOBIUS_BUILD_PROVENANCE_FILE"\nexit 3\n',
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
    // The build-time source record electron-builder seals into the bundle (F1).
    const json = result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1)
    const record = JSON.parse(json)
    expect(record).toMatchObject({ buildNumber: 10 })
    expect(Object.keys(record)).toEqual(
      expect.arrayContaining(['repo', 'branch', 'commit', 'dirty', 'diffDigest', 'tag', 'builtAt'])
    )
    // The temp record is removed once electron-builder is done.
    const recordPath = result.stdout.match(/record=(.*)/)[1]
    expect(existsSync(recordPath)).toBe(false)
    // electron-builder's own exit code is passed through.
    expect(result.status).toBe(3)
    expect(readFileSync(counterFile, 'utf8')).toBe('10\n')
  })

  it('collects branch, commit, dirty and digest of a checkout at build time (F1)', () => {
    const root = path.dirname(counterIn())
    const repo = path.join(root, 'repo')
    mkdirSync(repo)
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: root,
          GIT_AUTHOR_NAME: 'f',
          GIT_AUTHOR_EMAIL: 'f@example.com',
          GIT_COMMITTER_NAME: 'f',
          GIT_COMMITTER_EMAIL: 'f@example.com'
        }
      }).trim()
    git('init', '-q', '-b', 'build-lane')
    writeFileSync(path.join(repo, 'a.txt'), 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'x')

    const clean = collectSourceState(repo)
    expect(clean).toMatchObject({
      branch: 'build-lane',
      commit: git('rev-parse', '--short', 'HEAD'),
      dirty: false,
      diffDigest: null,
      tag: null
    })

    writeFileSync(path.join(repo, 'a.txt'), 'two\n')
    const dirty = collectSourceState(repo)
    expect(dirty.dirty).toBe(true)
    expect(dirty.diffDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
