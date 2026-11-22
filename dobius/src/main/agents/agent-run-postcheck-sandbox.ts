// Runs a postcheck inside the macOS sandbox (`sandbox-exec`, deny by default).
// Why: the check executes files the agent just wrote (a test file is enough),
// so it must gain nothing the agent's own sandbox does not give: no network,
// no unix sockets, no writes outside the run folder and a fresh temp folder,
// no reads of sign-in files. If the sandbox cannot be applied the check does
// not run at all.

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentRunPostcheck } from '../../shared/agent-run-loop'
import type { AutomationPrecheckResult } from '../../shared/automations-types'
import { runAutomationPrecheck } from '../automations/precheck-runner'
import { getUserDataRoot } from '../storage/user-data-root'
import { buildPostcheckEnv } from './agent-run-postcheck-env'

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const PROBE_TIMEOUT_MS = 5000

// Folders and files under home that hold sign-in material or app secrets.
const HOME_SECRET_PATHS = [
  '.ssh',
  '.aws',
  '.config',
  '.gnupg',
  '.docker',
  '.kube',
  '.claude',
  '.claude.json',
  '.codex',
  '.dobius',
  '.netrc',
  '.npmrc',
  '.git-credentials',
  'Library/Keychains',
  'Library/Cookies',
  'Library/Messages'
]

// System services a compiler, test runner or git needs to start. Nothing here
// reaches the keychain, the network or another app.
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

export type SandboxedPostcheck =
  | { ok: true; result: AutomationPrecheckResult }
  | { ok: false; reason: string }

function sbString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// The sandbox matches real paths, so `/tmp` must become `/private/tmp`.
function realPath(target: string): string {
  return existsSync(target) ? realpathSync(target) : path.resolve(target)
}

/** All paths must already be real (symlink-free) absolute paths. */
export function buildPostcheckSandboxProfile(args: {
  cwd: string
  tempDir: string
  homeDir: string
  userDataDir: string
}): string {
  const secrets = [
    ...HOME_SECRET_PATHS.map((entry) => path.join(args.homeDir, entry)),
    args.userDataDir
  ]
  // A run folder that lives inside a denied folder (an agent's own workspace
  // under ~/.dobius) stays readable. Not when it CONTAINS one: a run folder of
  // home must not re-open every secret under it.
  const cwdHoldsSecrets = secrets.some((secret) => isWithin(secret, args.cwd))
  const dotEnv = String.raw`(deny file-read* (regex #"/\.env[^/]*$"))`
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec*)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow file-ioctl)',
    '(allow ipc-posix-shm-read*)',
    '(allow ipc-posix-sem)',
    `(allow mach-lookup ${MACH_SERVICES.map((name) => `(global-name ${sbString(name)})`).join(' ')})`,
    '(allow file-read*)',
    `(deny file-read* ${secrets.map((secret) => `(subpath ${sbString(secret)})`).join(' ')})`,
    ...(cwdHoldsSecrets ? [] : [`(allow file-read* (subpath ${sbString(args.cwd)}))`]),
    dotEnv,
    `(allow file-write* (subpath ${sbString(args.cwd)}) (subpath ${sbString(args.tempDir)}))`,
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper"))',
    // Already denied by default; stated so nobody "fixes" a failing check by allowing it.
    '(deny network*)'
  ].join('\n')
}

function probeSandbox(profile: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      SANDBOX_EXEC,
      ['-p', profile, '/usr/bin/true'],
      { timeout: PROBE_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        resolve(error ? stderr.trim() || error.message : null)
      }
    )
  })
}

/**
 * Runs the check sandboxed in `cwd`. `ok: false` means the sandbox could not
 * be set up and the check did NOT run; the caller must not fall back to
 * running it unsandboxed.
 */
export async function runSandboxedPostcheck(args: {
  postcheck: AgentRunPostcheck
  cwd: string
}): Promise<SandboxedPostcheck> {
  if (process.platform !== 'darwin' || !existsSync(SANDBOX_EXEC)) {
    return { ok: false, reason: 'no sandbox is available on this system' }
  }
  let tempDir: string
  let profile: string
  try {
    tempDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dobius-postcheck-')))
    profile = buildPostcheckSandboxProfile({
      cwd: realPath(args.cwd),
      tempDir,
      homeDir: realPath(os.homedir()),
      userDataDir: realPath(getUserDataRoot())
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  try {
    const probeFailure = await probeSandbox(profile)
    if (probeFailure !== null) {
      return { ok: false, reason: `the sandbox did not start (${probeFailure})` }
    }
    const result = await runAutomationPrecheck({
      precheck: {
        command: `${SANDBOX_EXEC} -p ${shellQuote(profile)} /bin/sh -c ${shellQuote(args.postcheck.command)}`,
        timeoutSeconds: args.postcheck.timeoutSeconds
      },
      target: {
        type: 'local',
        cwd: args.cwd,
        env: {
          ...buildPostcheckEnv(process.env),
          TMPDIR: tempDir,
          // npm writes its cache and logs under home by default, which is denied.
          npm_config_cache: path.join(tempDir, 'npm-cache'),
          npm_config_update_notifier: 'false'
        }
      }
    })
    // Records and retry prompts show the command that was asked for, not the wrapper.
    return { ok: true, result: { ...result, command: args.postcheck.command } }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch (error) {
      console.error(
        '[agents] could not remove the postcheck temp folder:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
