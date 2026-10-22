import type { ChildProcess } from 'node:child_process'

/** Retire only the held gateway child; never signal a profile, shell or process-name pattern. */
export function stopAdamChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', finish)
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      resolve()
    }, 5_000)
    timer.unref()
    if (child.exitCode !== null || child.signalCode !== null) {
      finish()
    } else {
      child.kill('SIGTERM')
    }
  })
}
