#!/usr/bin/env node
import { copyFile, mkdir, chmod, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('This LaunchAgent installer requires macOS.')
const label = 'com.verlosolutions.dobius.laya-terminal-watcher'
const directory = join(homedir(), 'Library', 'Application Support', 'dobius-terminal')
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const sourceDir = dirname(fileURLToPath(import.meta.url))
const node = process.execPath
await mkdir(directory, { recursive: true, mode: 0o700 })
await mkdir(dirname(plistPath), { recursive: true })
for (const name of ['laya-terminal-watcher.mjs', 'terminal-infrastructure-policy.mjs']) {
  const destination = join(directory, name)
  await copyFile(join(sourceDir, name), destination)
  await chmod(destination, 0o600)
}
const log = join(directory, 'laya-terminal-watcher.log')
const xml = (value) => value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
await writeFile(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(join(directory, 'laya-terminal-watcher.mjs'))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
<key>EnvironmentVariables</key><dict><key>DOBIUS_TERMINAL_STATE_DIR</key><string>${xml(directory)}</string><key>PATH</key><string>${xml(dirname(node))}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`, { mode: 0o600 })
execFileSync('/usr/bin/plutil', ['-lint', plistPath], { stdio: 'inherit' })
try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }) } catch {}
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { stdio: 'inherit' })
console.log(`Installed ${label}; log: ${log}`)
