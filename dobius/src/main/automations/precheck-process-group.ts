// Making sure nothing a check started is still running once the check is over.

const GROUP_EXIT_POLL_MS = 50
const GROUP_EXIT_WAIT_MS = 2000

function groupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    // EPERM = it exists but is not ours to signal; only "no such process" is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Force-kills whatever is left of the check's process group and waits, for a
 * bounded time, until it is gone. Returns true when something is STILL alive.
 * A process that left the group (its own session) is not covered here.
 */
export async function stopProcessGroup(pid: number | undefined): Promise<boolean> {
  if (!pid || process.platform === 'win32' || !groupIsAlive(pid)) {
    return false
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      console.warn('[precheck] could not stop the check process group:', (error as Error).message)
    }
  }
  const deadline = Date.now() + GROUP_EXIT_WAIT_MS
  while (Date.now() < deadline) {
    if (!groupIsAlive(pid)) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, GROUP_EXIT_POLL_MS))
  }
  return groupIsAlive(pid)
}
