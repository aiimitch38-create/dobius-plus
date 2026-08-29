import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { classifyShellCommand } from './shell-tool'

const run = promisify(execFile)

const READ_ONLY = [
  ['ls', '-la'],
  ['cat', '/etc/hosts'],
  ['head', '-n', '5', 'file.txt'],
  ['tail', '-n', '20', 'file.log'],
  ['wc', '-l', 'file.txt'],
  ['df', '-h'],
  ['du', '-sh', '.'],
  ['ps', 'aux'],
  ['vm_stat'],
  ['sw_vers'],
  ['uptime'],
  ['date'],
  ['echo', 'hello'],
  ['which', 'node'],
  ['pgrep', 'Dobius'],
  ['grep', 'needle', 'haystack.txt'],
  ['find', '.', '-name', '*.ts'],
  ['networksetup', '-getinfo', 'Wi-Fi'],
  ['system_profiler', 'SPHardwareDataType']
]

const DENIED = [
  ['sudo', 'ls'],
  ['su', '-'],
  ['dd', 'if=/dev/zero', 'of=/dev/disk0'],
  ['mkfs', '/dev/disk0'],
  ['mkfs.ext4', '/dev/disk0'],
  ['diskutil', 'eraseDisk', 'JHFS+', 'x', 'disk0'],
  ['shutdown', '-h', 'now'],
  ['reboot'],
  ['halt'],
  ['killall', 'Finder'],
  ['launchctl', 'unload', '-w', '/Library/LaunchDaemons/x.plist'],
  ['csrutil', 'disable'],
  ['spctl', '--master-disable'],
  ['security', 'dump-keychain'],
  ['chown', '-R', 'root', '/Users']
]

describe('classifyShellCommand — classification table', () => {
  it.each(READ_ONLY)('reports %s as read-only', (...argv) => {
    expect(classifyShellCommand(argv)).toEqual({ verdict: 'read-only' })
  })

  it.each(DENIED)('denies %s outright', (...argv) => {
    expect(classifyShellCommand(argv).verdict).toBe('denied')
  })

  it('routes an unknown binary to the approval window', () => {
    expect(classifyShellCommand(['mv', 'a', 'b'])).toEqual({ verdict: 'writing' })
    expect(classifyShellCommand(['open', '-a', 'Safari'])).toEqual({ verdict: 'writing' })
  })

  it('treats osascript as writing, never read-only', () => {
    expect(classifyShellCommand(['osascript', '-e', 'get volume settings'])).toEqual({
      verdict: 'writing'
    })
    expect(
      classifyShellCommand(['osascript', '-e', 'do shell script "id" with administrator privileges'])
    ).toEqual({ verdict: 'writing' })
  })

  it('refuses an empty command', () => {
    expect(classifyShellCommand([]).verdict).toBe('denied')
    expect(classifyShellCommand(['   ']).verdict).toBe('denied')
  })

  it('denies chmod -R only against a system root', () => {
    expect(classifyShellCommand(['chmod', '-R', '777', '/']).verdict).toBe('denied')
    expect(classifyShellCommand(['chmod', '--recursive', '777', '/usr']).verdict).toBe('denied')
    // A recursive chmod inside a project is a normal write: approval, not denial.
    expect(classifyShellCommand(['chmod', '-R', '755', '/Users/x/project'])).toEqual({
      verdict: 'writing'
    })
  })

  it('does not grant the allowlist to a binary reached by path', () => {
    expect(classifyShellCommand(['/tmp/evil/ls', '-la'])).toEqual({ verdict: 'writing' })
    expect(classifyShellCommand(['./ls'])).toEqual({ verdict: 'writing' })
  })

  it('still denies a denied binary reached by path', () => {
    expect(classifyShellCommand(['/usr/bin/sudo', 'ls']).verdict).toBe('denied')
  })
})

describe('classifyShellCommand — argument scan', () => {
  it.each([['-delete'], ['-exec'], ['-execdir'], ['-ok'], ['-okdir'], ['-fprint'], ['-fls']])(
    'escalates find %s to the approval window',
    (predicate) => {
      expect(classifyShellCommand(['find', '.', '-name', 'x', predicate, 'rm', '{}', ';'])).toEqual(
        { verdict: 'writing' }
      )
    }
  )

  it('leaves find -o (the OR operator) read-only', () => {
    expect(classifyShellCommand(['find', '.', '-name', 'a', '-o', '-name', 'b'])).toEqual({
      verdict: 'read-only'
    })
  })

  it('escalates anything invoking xargs', () => {
    expect(classifyShellCommand(['find', '.', '-print0', 'xargs', 'rm'])).toEqual({
      verdict: 'writing'
    })
    expect(classifyShellCommand(['grep', '-l', 'x', '.', '/usr/bin/xargs'])).toEqual({
      verdict: 'writing'
    })
  })

  it.each([['-o'], ['-O'], ['--output'], ['--output-file']])(
    'escalates an output-file flag %s on a read-only binary',
    (flag) => {
      expect(classifyShellCommand(['grep', flag, 'out.txt', 'needle'])).toEqual({
        verdict: 'writing'
      })
      expect(classifyShellCommand(['tail', flag, 'out.txt', 'in.log'])).toEqual({
        verdict: 'writing'
      })
      expect(classifyShellCommand(['cat', flag, 'out.txt'])).toEqual({ verdict: 'writing' })
    }
  )

  it('escalates --output=<file> written as one token', () => {
    expect(classifyShellCommand(['grep', '--output=/tmp/x', 'needle'])).toEqual({
      verdict: 'writing'
    })
  })
})

describe('classifyShellCommand — the plugin directory (invariant B)', () => {
  const pluginDir = '/Users/x/Library/Application Support/dobius-plus/adam-plugins'

  it('denies a write into the resolved plugin directory', () => {
    expect(
      classifyShellCommand(['cp', '/tmp/evil.mjs', `${pluginDir}/evil.mjs`], { pluginDir }).verdict
    ).toBe('denied')
  })

  it('denies a path that reaches the plugin directory the long way round', () => {
    const roundabout = `/Users/x/Library/Application Support/dobius-plus/../dobius-plus/adam-plugins/e.mjs`
    expect(classifyShellCommand(['mv', '/tmp/e.mjs', roundabout], { pluginDir }).verdict).toBe(
      'denied'
    )
  })

  it('denies the plugin folder by segment even with no pluginDir configured', () => {
    expect(classifyShellCommand(['cat', '/somewhere/adam-plugins/x.mjs']).verdict).toBe('denied')
  })

  it('denies even a read of the plugin folder, so it cannot be probed', () => {
    expect(classifyShellCommand(['ls', pluginDir], { pluginDir }).verdict).toBe('denied')
  })

  it('denies a path that reaches the plugin folder through a symlink', () => {
    // The hole this closes: `cp x.mjs /tmp/notes/x.mjs` reads as harmless in the
    // approval window, so a human approves it, and it lands in the plugin folder
    // anyway because /tmp/notes is a link. Lexical checks alone cannot see this.
    const base = mkdtempSync(join(tmpdir(), 'shelltool-plugins-'))
    const realPluginDir = join(base, 'adam-plugins')
    mkdirSync(realPluginDir)
    const decoy = join(base, 'notes')
    symlinkSync(realPluginDir, decoy)

    expect(
      classifyShellCommand(['cp', '/tmp/x.mjs', join(decoy, 'x.mjs')], {
        pluginDir: realPluginDir
      }).verdict
    ).toBe('denied')
  })

  it('leaves a sibling folder alone', () => {
    expect(
      classifyShellCommand(['ls', '/Users/x/Library/Application Support/dobius-plus'], {
        pluginDir
      })
    ).toEqual({ verdict: 'read-only' })
  })
})

describe('shell metacharacters are inert under execFile', () => {
  it('classifies a redirect as read-only and writes no file when run', async () => {
    const target = join(mkdtempSync(join(tmpdir(), 'shelltool-')), 'pwned')
    const argv = ['echo', 'hello', '>', target]

    expect(classifyShellCommand(argv)).toEqual({ verdict: 'read-only' })

    const [binary, ...args] = argv
    const { stdout } = await run(binary, args)
    // The operators arrived at echo as literal arguments, so they were printed.
    expect(stdout.trim()).toBe(`hello > ${target}`)
    expect(existsSync(target)).toBe(false)
  })

  it('does not chain a second command through ; or &&', async () => {
    const target = join(mkdtempSync(join(tmpdir(), 'shelltool-')), 'chained')
    const argv = ['echo', 'a', ';', 'touch', target, '&&', 'touch', target]

    expect(classifyShellCommand(argv)).toEqual({ verdict: 'read-only' })

    const [binary, ...args] = argv
    await run(binary, args)
    expect(existsSync(target)).toBe(false)
  })
})
