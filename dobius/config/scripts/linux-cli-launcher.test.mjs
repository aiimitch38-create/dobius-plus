import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const launcherSource = readFileSync(
  resolve(import.meta.dirname, '../../resources/linux/bin/dobius')
)

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dobius-linux-cli-launcher-'))
  const launcher = join(root, 'app', 'resources', 'bin', 'dobius')
  mkdirSync(dirname(launcher), { recursive: true })
  writeFileSync(launcher, launcherSource, { mode: 0o755 })
  chmodSync(launcher, 0o755)
  const logPath = join(root, 'launch.log')
  return {
    root,
    launcher,
    logPath,
    addCandidate(name) {
      const executable = join(root, 'app', name)
      writeFileSync(
        executable,
        `${[
          '#!/bin/sh',
          'printf "%s\\n" "$(basename "$0")" >> "$DOBIUS_TEST_LAUNCH_LOG"',
          'printf "arg=<%s>\\n" "$@" >> "$DOBIUS_TEST_LAUNCH_LOG"',
          'printf "run-as-node=<%s>\\n" "$ELECTRON_RUN_AS_NODE" >> "$DOBIUS_TEST_LAUNCH_LOG"'
        ].join('\n')}\n`,
        { mode: 0o755 }
      )
      chmodSync(executable, 0o755)
      return executable
    },
    run(args = [], fromSymlink = false) {
      const command = fromSymlink ? join(root, 'path-bin', 'dobius') : launcher
      if (fromSymlink) {
        mkdirSync(dirname(command), { recursive: true })
        symlinkSync(launcher, command)
      }
      return spawnSync('bash', [command, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOBIUS_TEST_LAUNCH_LOG: logPath,
          NODE_OPTIONS: '--max-old-space-size=256',
          NODE_REPL_EXTERNAL_MODULE: 'fixture-module'
        }
      })
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

describe('Linux packaged CLI launcher', () => {
  it.skipIf(process.platform === 'win32')(
    'selects dobius-ide first through the installed symlink and forwards CLI arguments',
    () => {
      const fixture = makeFixture()
      try {
        fixture.addCandidate('dobius-ide')
        fixture.addCandidate('dobius')
        fixture.addCandidate('Dobius+')

        const result = fixture.run(['--help', 'two words'], true)

        expect(result.status).toBe(0)
        expect(readFileSync(fixture.logPath, 'utf8').trim().split('\n')).toEqual([
          'dobius-ide',
          `arg=<${join(fixture.root, 'app', 'resources', 'app.asar.unpacked/out/cli/index.js')}>`,
          'arg=<--help>',
          'arg=<two words>',
          'run-as-node=<1>'
        ])
      } finally {
        fixture.cleanup()
      }
    }
  )

  it.skipIf(process.platform === 'win32').each(['dobius', 'Dobius+'])(
    'keeps the legacy %s executable fallback',
    (candidate) => {
      const fixture = makeFixture()
      try {
        fixture.addCandidate(candidate)

        const result = fixture.run(['--version'])

        expect(result.status).toBe(0)
        expect(readFileSync(fixture.logPath, 'utf8')).toContain(`${candidate}\n`)
        expect(readFileSync(fixture.logPath, 'utf8')).toContain('arg=<--version>')
      } finally {
        fixture.cleanup()
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'rejects executable directories instead of attempting to launch them',
    () => {
      const fixture = makeFixture()
      try {
        for (const candidate of ['dobius-ide', 'dobius', 'Dobius+']) {
          const directory = join(fixture.root, 'app', candidate)
          mkdirSync(directory, { recursive: true, mode: 0o755 })
          chmodSync(directory, 0o755)
        }

        const result = fixture.run(['--help'])

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Unable to locate the Dobius+ executable')
        expect(existsSync(fixture.logPath)).toBe(false)
      } finally {
        fixture.cleanup()
      }
    }
  )
})
