// open_project_terminal / open_project_merge_recovery_terminal: both end with
// "hand the user a real shell at a real path". Dobius's own in-app terminal
// tabs are created through the running DobiusRuntimeService instance, which
// this feature has no handle to from a plain RPC method — so these open the
// OS's native terminal application instead. Real, working, just a different
// terminal surface than Dobius's own tabs (documented in the workstation
// report so the coordinator can swap this for an in-app tab later if wanted).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

export async function openNativeTerminalAt(path: string): Promise<void> {
  if (!existsSync(path)) {
    throw new Error(`Cannot open a terminal at a path that doesn't exist: ${path}`)
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', 'Terminal', path])
    return
  }
  if (process.platform === 'win32') {
    await execFileAsync('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', `cd /d "${path}"`])
    return
  }
  await execFileAsync('x-terminal-emulator', ['--working-directory', path]).catch(async () => {
    // Why: x-terminal-emulator is a Debian/Ubuntu convention, not universal —
    // fall back to a plain terminal binary rather than failing outright on
    // other Linux distros.
    await execFileAsync('xterm', ['-e', `cd "${path}" && exec $SHELL`])
  })
}
