#!/usr/bin/env node
import { copyFile, mkdir, writeFile, chmod, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('This LaunchAgent installer requires macOS.')
const label = 'com.verlosolutions.dobius.priority'
const directory = join(homedir(), 'Library', 'Application Support', 'dobius-priority')
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const node = process.execPath
const cli = process.env.DOBIUS_PRIORITY_CLI || execFileSync('/usr/bin/which', ['dobius'], { encoding: 'utf8' }).trim()
await access(cli)
await mkdir(directory, { recursive: true, mode: 0o700 })
await mkdir(dirname(plistPath), { recursive: true })
for (const name of ['terminal-priority.mjs', 'terminal-priority-policy.mjs']) {
  await copyFile(join(dirname(fileURLToPath(import.meta.url)), name), join(directory, name))
  await chmod(join(directory, name), 0o600)
}
const xml = (value) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
const log = join(directory, 'priority.log')
await writeFile(log, '', { flag: 'a', mode: 0o600 })
await writeFile(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(directory, 'terminal-priority.mjs'))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>EnvironmentVariables</key><dict><key>DOBIUS_PRIORITY_CLI</key><string>${xml(cli)}</string>
<key>PATH</key><string>${xml(dirname(node))}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`, { mode: 0o600 })
execFileSync('/usr/bin/plutil', ['-lint', plistPath], { stdio: 'inherit' })
// Only this dedicated priority service is reloaded; Metro and Dobius+ are untouched.
try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }) } catch { /* Not loaded yet. */ }
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { stdio: 'inherit' })
console.log(`Installed ${label}; log: ${log}`)
