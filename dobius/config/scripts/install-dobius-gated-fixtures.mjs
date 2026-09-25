// Fixture builders for the gated-installer tests (BUILD-043/044). Every run
// sets DOBIUS_INSTALL_DEST inside a temp root (never /Applications) and a temp
// HOME, so the script never quits, kills, relaunches or registers the real app.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'

export const repoRoot = path.resolve(import.meta.dirname, '../../..')
export const gatedScript = path.join(repoRoot, 'scripts', 'install-dobius-gated.sh')

const roots = []

export function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'dobius-gated-install-'))
  roots.push(root)
  mkdirSync(path.join(root, 'home'))
  mkdirSync(path.join(root, 'Applications'))
  return root
}

export function makeBundle(
  bundlePath,
  { version = '2.0.0', bundleVersion = null, asar = 'v1', withAsar = true } = {}
) {
  mkdirSync(path.join(bundlePath, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(path.join(bundlePath, 'Contents', 'Resources'), { recursive: true })
  const versionKey =
    version === null ? '' : `<key>CFBundleShortVersionString</key><string>${version}</string>\n`
  const bundleVersionKey =
    bundleVersion === null ? '' : `<key>CFBundleVersion</key><string>${bundleVersion}</string>\n`
  writeFileSync(
    path.join(bundlePath, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>FixtureApp</string>
<key>CFBundleIdentifier</key><string>com.example.dobius-installer-fixture</string>
${versionKey}${bundleVersionKey}</dict></plist>
`
  )
  // A real Mach-O (universal) binary so the arch validation runs for real.
  copyFileSync('/bin/echo', path.join(bundlePath, 'Contents', 'MacOS', 'FixtureApp'))
  chmodSync(path.join(bundlePath, 'Contents', 'MacOS', 'FixtureApp'), 0o755)
  if (withAsar) {
    writeFileSync(path.join(bundlePath, 'Contents', 'Resources', 'app.asar'), asar)
  }
  return bundlePath
}

export function envFor(root, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(root, 'home'),
    USER: 'fixture',
    DOBIUS_INSTALL_DEST: path.join(root, 'Applications', 'Dobius+.app'),
    DOBIUS_INSTALL_LOCK: path.join(root, 'install.lock'),
    DOBIUS_INSTALL_LOCK_WAIT: '30',
    DOBIUS_INSTALL_BACKUP_DIR: path.join(root, 'backups'),
    DOBIUS_INSTALL_HISTORY_LOG: path.join(root, 'history.log'),
    ...extra
  }
}

export function runGated(root, args, extraEnv) {
  const env = envFor(root, extraEnv)
  expect(env.DOBIUS_INSTALL_DEST.startsWith(root)).toBe(true)
  return spawnSync('/bin/bash', [gatedScript, ...args], { env, encoding: 'utf8' })
}

export function runGatedAsync(root, args, extraEnv) {
  const env = envFor(root, extraEnv)
  expect(env.DOBIUS_INSTALL_DEST.startsWith(root)).toBe(true)
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [gatedScript, ...args], {
      env,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

export const dest = (root) => path.join(root, 'Applications', 'Dobius+.app')
export const asarOf = (bundle) =>
  readFileSync(path.join(bundle, 'Contents', 'Resources', 'app.asar'), 'utf8')
export const stageOf = (root) => path.join(root, 'Applications', 'Dobius+.new.app')

export function cleanupRoots() {
  for (const root of roots.splice(0)) {
    // A uchg flag from the rename-failure case would block cleanup.
    spawnSync('chflags', ['-R', 'nouchg', root])
    chmodSync(root, 0o755)
    spawnSync('chmod', ['-R', 'u+rwX', root])
    rmSync(root, { recursive: true, force: true })
  }
}

export function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com'
    }
  }).trim()
}

// A real git repo whose build output sits in an ignored dist/, like dobius/.
export function makeRepo(root) {
  const repo = path.join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(repo, '.gitignore'), 'dist/\n')
  writeFileSync(path.join(repo, 'src.txt'), 'committed\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'fixture')
  return repo
}

export const provenanceOf = (bundle) =>
  JSON.parse(
    readFileSync(path.join(bundle, 'Contents', 'Resources', 'INSTALL-PROVENANCE.json'), 'utf8')
  )
export const distBundle = (root, options) =>
  makeBundle(path.join(root, 'repo', 'dist', 'mac-arm64', 'Dobius+.app'), options)
