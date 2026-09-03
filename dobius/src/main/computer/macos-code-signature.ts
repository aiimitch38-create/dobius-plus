import { spawn } from 'node:child_process'
import type { ComputerUseCodeSignatureStatus } from '../../shared/computer-use-permissions-types'

// Why: macOS TCC keys permission grants to the app's code-signing identity.
// Ad-hoc signatures change on every rebuild, so grants are silently dropped;
// surfacing the signature state explains the "permissions keep resetting" loop.
const CODESIGN_BINARY_PATH = '/usr/bin/codesign'
const CODESIGN_TIMEOUT_MS = 5_000

const ADHOC_SIGNATURE_VALUE = 'adhoc'
const TEAM_ID_NOT_SET_VALUE = 'not set'

export const UNKNOWN_MACOS_CODE_SIGNATURE: ComputerUseCodeSignatureStatus = {
  adhoc: false,
  teamId: null,
  unknown: true
}

export function readMacOSHelperCodeSignature(
  helperAppPath: string
): Promise<ComputerUseCodeSignatureStatus> {
  // Why: the signature is diagnostic metadata only — any failure degrades to
  // an unknown state instead of breaking the permission status payload.
  return readMacOSHelperCodeSignatureAsync(helperAppPath).catch(
    () => UNKNOWN_MACOS_CODE_SIGNATURE
  )
}

async function readMacOSHelperCodeSignatureAsync(
  helperAppPath: string
): Promise<ComputerUseCodeSignatureStatus> {
  const output = await runCodesignDescription(helperAppPath)
  return parseMacOSCodeSignatureOutput(output)
}

export function parseMacOSCodeSignatureOutput(output: string): ComputerUseCodeSignatureStatus {
  let signatureValue: string | null = null
  let teamIdValue: string | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    const signatureMatch = /^Signature=(.*)$/.exec(line)
    if (signatureMatch) {
      signatureValue = signatureMatch[1].trim()
      continue
    }
    const teamIdMatch = /^TeamIdentifier=(.*)$/.exec(line)
    if (teamIdMatch) {
      teamIdValue = teamIdMatch[1].trim()
    }
  }

  if (signatureValue === null && teamIdValue === null) {
    return UNKNOWN_MACOS_CODE_SIGNATURE
  }

  return {
    adhoc: signatureValue?.toLowerCase() === ADHOC_SIGNATURE_VALUE,
    teamId:
      teamIdValue && teamIdValue.toLowerCase() !== TEAM_ID_NOT_SET_VALUE ? teamIdValue : null
  }
}

function runCodesignDescription(helperAppPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Why: spawn with an args array — helper paths contain spaces and must
    // never be shell-interpolated.
    const codesign = spawn(CODESIGN_BINARY_PATH, ['-dv', '--verbose=2', helperAppPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const onStdoutData = (chunk: string): void => {
      stdout += chunk
    }
    const onStderrData = (chunk: string): void => {
      stderr += chunk
    }

    const settleResolve = (value: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      codesign.stdout?.off('data', onStdoutData)
      codesign.stderr?.off('data', onStderrData)
      codesign.off('error', onError)
      codesign.off('close', onClose)
      resolve(value)
    }
    const settleReject = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      codesign.stdout?.off('data', onStdoutData)
      codesign.stderr?.off('data', onStderrData)
      codesign.off('error', onError)
      codesign.off('close', onClose)
      reject(error)
    }

    const onError = (): void => {
      settleReject(new Error('codesign could not be launched'))
    }
    // Why: `codesign -dv` writes its description to stderr; combine with
    // stdout so fixture layouts from either stream still parse.
    const onClose = (code: number | null): void => {
      if (code === 0) {
        settleResolve(`${stdout}${stderr}`)
        return
      }
      settleReject(new Error(`codesign exited ${code ?? 'unknown'}`))
    }
    const onTimeout = (): void => {
      codesign.kill()
      settleReject(new Error('codesign timed out'))
    }

    const timeout = setTimeout(onTimeout, CODESIGN_TIMEOUT_MS)
    if (typeof timeout.unref === 'function') {
      timeout.unref()
    }

    codesign.stdout?.setEncoding('utf8')
    codesign.stderr?.setEncoding('utf8')
    codesign.stdout?.on('data', onStdoutData)
    codesign.stderr?.on('data', onStderrData)
    codesign.on('error', onError)
    codesign.on('close', onClose)
  })
}
