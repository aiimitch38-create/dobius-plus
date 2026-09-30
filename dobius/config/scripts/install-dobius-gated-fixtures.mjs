// Fixture builders for the gated-installer tests (BUILD-043/044). Every run
// sets DOBIUS_INSTALL_DEST inside a temp root (never /Applications) and a temp
// HOME, so the script never quits, kills, relaunches or registers the real app.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
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

// BUILD-045 (#101): everything scripts/bundle-manifest.py requires of a
// packaged app, so a fixture bundle is complete unless a test omits a piece.
const ASAR_ENTRIES = [
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'out/web/web-index.html',
  'out/cli/index.js'
]
const RELAY_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64'
]
export const MANIFEST_DISK_FILES = [
  'Contents/Resources/app.asar.unpacked/out/cli/index.js',
  'Contents/Resources/app.asar.unpacked/out/package.json',
  'Contents/Resources/app.asar.unpacked/out/main/daemon-entry.js',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/_CodeSignature/CodeResources',
  ...RELAY_PLATFORMS.flatMap((platform) => [
    `Contents/Resources/relay/${platform}/relay.js`,
    `Contents/Resources/relay/${platform}/.version`
  ])
]
export const MANIFEST_EXECUTABLES = [
  'Contents/Resources/bin/dobius',
  'Contents/Resources/Dobius+ Computer Use.app/Contents/MacOS/dobius-computer-use-macos'
]
const FIXTURE_TAG_ENTRY = 'fixture-tag'

// A real asar archive (the @electron/asar header layout): 8-byte size pickle,
// header pickle holding the JSON file tree, then file data. The fixture's tag
// ('v1', 'v2', …) is stored as its own entry so tests can tell bundles apart.
export function fixtureAsar(tag, { omit = [] } = {}) {
  const root = { files: {} }
  const chunks = []
  let offset = 0
  const add = (entryPath, content) => {
    const parts = entryPath.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} }
      node = node.files[part]
    }
    const data = Buffer.from(content)
    node.files[parts.at(-1)] = { size: data.length, offset: String(offset) }
    chunks.push(data)
    offset += data.length
  }
  add(FIXTURE_TAG_ENTRY, tag)
  for (const entry of ASAR_ENTRIES.filter((e) => !omit.includes(e))) {
    add(entry, `// ${entry}\n`)
  }
  const json = Buffer.from(JSON.stringify(root))
  const padded = Math.ceil(json.length / 4) * 4
  const headerPickle = Buffer.alloc(8 + padded)
  headerPickle.writeUInt32LE(4 + padded, 0)
  headerPickle.writeUInt32LE(json.length, 4)
  json.copy(headerPickle, 8)
  const sizePickle = Buffer.alloc(8)
  sizePickle.writeUInt32LE(4, 0)
  sizePickle.writeUInt32LE(headerPickle.length, 4)
  return Buffer.concat([sizePickle, headerPickle, ...chunks])
}

function readAsarTag(asarPath) {
  const archive = readFileSync(asarPath)
  const headerSize = archive.readUInt32LE(4)
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString('utf8'))
  const entry = header.files[FIXTURE_TAG_ENTRY]
  const start = 8 + headerSize + Number(entry.offset)
  return archive.subarray(start, start + entry.size).toString('utf8')
}

// Shell command printing the tag of a fixture asar (for recorder shims).
export const asarTagCommand = (asarPath) =>
  `python3 -c 'import json,struct,sys;d=open(sys.argv[1],"rb").read();h=struct.unpack("<I",d[4:8])[0];e=json.loads(d[16:16+struct.unpack("<I",d[12:16])[0]])["files"]["${FIXTURE_TAG_ENTRY}"];s=8+h+int(e["offset"]);sys.stdout.write(d[s:s+e["size"]].decode())' "${asarPath}"`

export function makeBundle(
  bundlePath,
  {
    version = '2.0.0',
    bundleVersion = null,
    asar = 'v1',
    withAsar = true,
    omit = [],
    signed = false
  } = {}
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
    writeFileSync(
      path.join(bundlePath, 'Contents', 'Resources', 'app.asar'),
      fixtureAsar(asar, { omit })
    )
  }
  for (const rel of [...MANIFEST_DISK_FILES, ...MANIFEST_EXECUTABLES]) {
    if (omit.includes(rel)) {
      continue
    }
    mkdirSync(path.dirname(path.join(bundlePath, rel)), { recursive: true })
    writeFileSync(path.join(bundlePath, rel), `fixture ${rel}\n`)
    if (MANIFEST_EXECUTABLES.includes(rel)) {
      chmodSync(path.join(bundlePath, rel), 0o755)
    }
  }
  // Like the real framework: the top-level entry and Versions/Current are symlinks.
  const framework = path.join(bundlePath, 'Contents', 'Frameworks', 'Electron Framework.framework')
  if (existsSync(path.join(framework, 'Versions', 'A'))) {
    symlinkSync('A', path.join(framework, 'Versions', 'Current'))
    symlinkSync('Versions/Current/Electron Framework', path.join(framework, 'Electron Framework'))
  }
  if (signed) {
    signBundle(bundlePath)
  }
  return bundlePath
}

// BUILD-044B: an ad-hoc signed bundle, so `codesign --verify --deep --strict`
// can prove the installer leaves the seal intact. Every nested code item gets
// a real Mach-O (a copy of /bin/echo) and the framework its Info.plist.
function signBundle(bundlePath) {
  const framework = path.join(bundlePath, 'Contents', 'Frameworks', 'Electron Framework.framework')
  const versionA = path.join(framework, 'Versions', 'A')
  for (const rel of [
    path.join(versionA, 'Electron Framework'),
    ...MANIFEST_EXECUTABLES.map((exe) => path.join(bundlePath, exe))
  ]) {
    copyFileSync('/bin/echo', rel)
    chmodSync(rel, 0o755)
  }
  rmSync(path.join(versionA, '_CodeSignature'), { recursive: true, force: true })
  mkdirSync(path.join(versionA, 'Resources'))
  writeFileSync(
    path.join(versionA, 'Resources', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Electron Framework</string>
<key>CFBundleIdentifier</key><string>com.example.dobius-installer-fixture.framework</string>
<key>CFBundlePackageType</key><string>FMWK</string>
</dict></plist>
`
  )
  symlinkSync('Versions/Current/Resources', path.join(framework, 'Resources'))
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundlePath], { stdio: 'ignore' })
  expect(codesignVerify(bundlePath).status).toBe(0)
}

export const codesignVerify = (bundlePath) =>
  spawnSync('codesign', ['--verify', '--deep', '--strict', bundlePath], { encoding: 'utf8' })

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

export function runGatedAsync(root, args, extraEnv, options = {}) {
  const env = envFor(root, extraEnv)
  expect(env.DOBIUS_INSTALL_DEST.startsWith(root)).toBe(true)
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [gatedScript, ...args], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: options.detached ?? false
    })
    options.onSpawn?.(child)
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stderr }))
  })
}

export const dest = (root) => path.join(root, 'Applications', 'Dobius+.app')
export const asarOf = (bundle) =>
  readAsarTag(path.join(bundle, 'Contents', 'Resources', 'app.asar'))
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

// BUILD-044B: install records live outside the bundles. The installed app's is
// <backups>/INSTALL-PROVENANCE.json, the rollback copy's sits beside it.
export const backupsOf = (root) => path.join(root, 'backups')
export const rollbackOf = (root) => path.join(backupsOf(root), 'Dobius+.previous')
export const currentRecordOf = (root) => path.join(backupsOf(root), 'INSTALL-PROVENANCE.json')
export const rollbackRecordOf = (root) => `${rollbackOf(root)}.INSTALL-PROVENANCE.json`
export const legacyRecordOf = (bundle) =>
  path.join(bundle, 'Contents', 'Resources', 'INSTALL-PROVENANCE.json')

export function bundleIdentityOf(bundle) {
  const result = spawnSync(
    'python3',
    [path.join(repoRoot, 'scripts', 'install-record.py'), 'identity', bundle],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

// The record at recordPath, after checking it belongs to bundle.
export function recordFor(bundle, recordPath) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  expect(record.bundleIdentity).toBe(bundleIdentityOf(bundle))
  return record
}

// The installed app's record: outside the bundle, never inside it.
export function provenanceOf(bundle) {
  expect(existsSync(legacyRecordOf(bundle))).toBe(false)
  return recordFor(bundle, currentRecordOf(path.dirname(path.dirname(bundle))))
}

// Every path, type, mode, symlink target and file content of a bundle, as one
// digest: equal digests mean nothing inside the bundle was added or changed.
export function bundleDigest(bundle) {
  const digest = createHash('sha256')
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const stat = lstatSync(full)
      digest.update(`${path.relative(bundle, full)}\0${stat.mode}\0`)
      if (stat.isSymbolicLink()) {
        digest.update(`link:${readlinkSync(full)}\0`)
      } else if (stat.isDirectory()) {
        walk(full)
      } else {
        digest.update(readFileSync(full))
      }
    }
  }
  walk(bundle)
  return digest.digest('hex')
}
export const distBundle = (root, options) =>
  makeBundle(path.join(root, 'repo', 'dist', 'mac-arm64', 'Dobius+.app'), options)
