// Runs a postcheck inside the macOS sandbox (`sandbox-exec`, deny by default).
// Why: the check executes files the agent just wrote (a test file is enough),
// so it must gain nothing the agent's own sandbox does not give: no network,
// no unix sockets, no writes outside the run folder and a fresh temp folder,
// no reads of sign-in files, no planting of files that run unsandboxed later.
// Whenever that cannot be guaranteed the check does not run at all.

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentRunPostcheck } from '../../shared/agent-run-loop'
import type { AutomationPrecheckResult } from '../../shared/automations-types'
import { runAutomationPrecheck } from '../automations/precheck-runner'
import { getUserDataRoot } from '../storage/user-data-root'
import { buildPostcheckEnv } from './agent-run-postcheck-env'
import {
  findEnvLinkTargets,
  isWithin,
  postcheckSecretPaths,
  resolveThroughExisting
} from './agent-run-postcheck-paths'
import { buildPostcheckSandboxProfile } from './agent-run-postcheck-profile'
import { runtimeKeyRoots } from './agent-sandbox-context'

const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const PROBE_TIMEOUT_MS = 5000

export type SandboxedPostcheck =
  | {
      ok: true
      result: AutomationPrecheckResult
      /** Something the check started is still running and could not be stopped. */
      processesLeft: boolean
    }
  | { ok: false; reason: string }

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** Resolves everything the profile needs, or says why this folder cannot be sandboxed. */
function planSandbox(cwdArg: string, tempDir: string): { profile: string } | { refusal: string } {
  const cwd = resolveThroughExisting(cwdArg)
  const secretPaths = postcheckSecretPaths({
    homeDir: os.homedir(),
    userDataDir: getUserDataRoot(),
    // Why: another Dobius instance's full runtime key must stay unreadable too.
    otherUserDataDirs: runtimeKeyRoots(os.homedir(), getUserDataRoot())
  })
  // The check may write anywhere in the run folder. A run folder that holds a
  // sign-in folder (home itself) or sits inside one cannot be made safe.
  if (secretPaths.some((secret) => isWithin(secret, cwd) || isWithin(cwd, secret))) {
    return { refusal: 'the run folder holds, or is inside, a protected sign-in folder' }
  }
  return {
    profile: buildPostcheckSandboxProfile({
      cwd,
      tempDir,
      secretPaths,
      envLinkTargets: findEnvLinkTargets(cwd)
    })
  }
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
    const plan = planSandbox(args.cwd, tempDir)
    if ('refusal' in plan) {
      rmSync(tempDir, { recursive: true, force: true })
      return { ok: false, reason: plan.refusal }
    }
    profile = plan.profile
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
  let processesLeft = true
  try {
    const probeFailure = await probeSandbox(profile)
    if (probeFailure !== null) {
      processesLeft = false
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
        requireGroupExit: true,
        env: {
          ...buildPostcheckEnv(process.env),
          TMPDIR: tempDir,
          // npm writes its cache and logs under home by default, which is denied.
          npm_config_cache: path.join(tempDir, 'npm-cache'),
          npm_config_update_notifier: 'false'
        }
      }
    })
    // ponytail: only the check's process group is tracked. A process that
    // starts its own session is not found (macOS hides other processes'
    // environments, so it cannot be tagged); it stays inside the sandbox.
    processesLeft = result.processGroupAlive === true
    // Records and retry prompts show the command that was asked for, not the wrapper.
    return { ok: true, result: { ...result, command: args.postcheck.command }, processesLeft }
  } finally {
    // Why not while something is still running: it may be using the folder.
    if (!processesLeft) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch (error) {
        console.error('[agents] could not remove the postcheck temp folder:', errorText(error))
      }
    }
  }
}
