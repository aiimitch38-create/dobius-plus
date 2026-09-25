// Why: signal 0 probes existence without delivering anything. ESRCH is the
// only proof of death; EPERM (someone else's live process) and any other
// error count as alive so work is never retired on a guess.
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
