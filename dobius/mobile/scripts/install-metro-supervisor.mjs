#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

if (process.platform !== 'darwin') {
  throw new Error('This automatic Metro service uses macOS launchd.')
}
const label = 'com.verlosolutions.dobius.metro'
const support = path.join(homedir(), 'Library/Application Support/dobius-mobile')
const agents = path.join(homedir(), 'Library/LaunchAgents')
const script = path.join(support, 'metro-supervisor.mjs')
const plist = path.join(agents, `${label}.plist`)
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
mkdirSync(support, { recursive: true })
mkdirSync(agents, { recursive: true })
copyFileSync(path.join(import.meta.dirname, 'metro-supervisor.mjs'), script)
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(script)}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(`${path.dirname(process.execPath)}:/Users/bayou/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>StandardOutPath</key><string>${escape(path.join(support, 'supervisor.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(support, 'supervisor.log'))}</string>
</dict></plist>
`)
execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'inherit' })
const domain = `gui/${process.getuid()}`
try { execFileSync('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }) }
catch {
  execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' })
}
console.log(`Installed ${label}; waits for Storage and keeps Metro available on port 8081.`)
