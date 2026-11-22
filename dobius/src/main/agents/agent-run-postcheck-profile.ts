// The macOS sandbox profile a postcheck runs under. Pure text building; every
// path handed in must already be resolved by the caller.
//
// Rule order matters: in a sandbox profile the LAST matching rule wins, so
// every deny that must hold sits after every allow. The move-blocking rules
// (deny unlink + create on a protected path and on each folder above it)
// follow the approach of Anthropic's open-source sandbox-runtime
// (src/sandbox/macos-sandbox-utils.ts, Apache-2.0); no code is copied.

import path from 'node:path'

// System services a compiler, test runner or git needs to start. Nothing here
// reaches the keychain, the network or another app. No POSIX shared memory or
// semaphores: node, vitest and git run without them.
const MACH_SERVICES = [
  'com.apple.system.opendirectoryd.libinfo',
  'com.apple.system.opendirectoryd.membership',
  'com.apple.system.notification_center',
  'com.apple.system.logger',
  'com.apple.logd',
  'com.apple.diagnosticd',
  'com.apple.cfprefsd.daemon',
  'com.apple.cfprefsd.agent',
  'com.apple.FSEvents'
]

// Files that run OUTSIDE any sandbox later: Claude project settings, hooks and
// MCP servers (loaded by the retry), git hooks and config, husky hooks. Same
// names the agent's own sandbox policy protects (agent-sandbox-policy.ts),
// matched anywhere so a tree holding one cannot be built elsewhere and moved in.
const PROTECTED_WRITE_PATTERNS = [
  String.raw`/\.claude(/|$)`,
  String.raw`/\.mcp\.json$`,
  String.raw`/\.git/hooks(/|$)`,
  String.raw`/\.git/config$`,
  String.raw`/\.husky(/|$)`
]
// A `.git` folder may not be moved away (and so replaced by one with hooks).
const UNMOVABLE_PATTERNS = [String.raw`/\.git$`]
const DOT_ENV_PATTERN = String.raw`/\.env[^/]*$`

function sbString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function sbRegex(pattern: string): string {
  return `(regex #"${pattern.replaceAll('"', '\\"')}")`
}

/** Every folder above `target`, nearest first, down to but not including `/`. */
export function ancestorDirs(target: string): string[] {
  const ancestors: string[] = []
  let current = path.dirname(target)
  while (current !== path.dirname(current)) {
    ancestors.push(current)
    current = path.dirname(current)
  }
  return ancestors
}

export function buildPostcheckSandboxProfile(args: {
  /** Real path of the run folder: the only project folder the check may write. */
  cwd: string
  /** Real path of the check's own fresh temp folder. */
  tempDir: string
  /** Sign-in folders and files, in every spelling (as written and resolved). */
  secretPaths: readonly string[]
  /** Resolved targets of `.env*` symlinks found in the run folder. */
  envLinkTargets: readonly string[]
}): string {
  const secretFilters = [
    ...[...args.secretPaths, ...args.envLinkTargets].map((secret) => `(subpath ${sbString(secret)})`),
    sbRegex(DOT_ENV_PATTERN)
  ].join(' ')
  // Renaming a folder above a secret would move the secret to a readable path.
  const guardedDirs = [
    ...new Set([
      args.cwd,
      ...ancestorDirs(args.cwd),
      ...[...args.secretPaths, ...args.envLinkTargets].flatMap(ancestorDirs)
    ])
  ]
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec*)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow file-ioctl)',
    `(allow mach-lookup ${MACH_SERVICES.map((name) => `(global-name ${sbString(name)})`).join(' ')})`,
    '(allow file-read*)',
    `(deny file-read* ${secretFilters})`,
    `(allow file-write* (subpath ${sbString(args.cwd)}) (subpath ${sbString(args.tempDir)}))`,
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper"))',
    // From here on: denies only.
    `(deny file-write* ${PROTECTED_WRITE_PATTERNS.map(sbRegex).join(' ')})`,
    `(deny file-write-unlink ${UNMOVABLE_PATTERNS.map(sbRegex).join(' ')})`,
    // A secret may not be written, deleted, renamed or hard-linked either.
    `(deny file-write* ${secretFilters})`,
    `(deny file-write-unlink file-write-create ${guardedDirs.map((dir) => `(literal ${sbString(dir)})`).join(' ')})`,
    // Already denied by default; stated so nobody "fixes" a failing check by allowing it.
    '(deny network*)'
  ].join('\n')
}
