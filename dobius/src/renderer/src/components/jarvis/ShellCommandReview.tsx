import { useState } from 'react'
import { Button } from '../ui/button'

export type ShellCommandProposal = {
  id: string
  displayCommand: string
  argv: string[]
  description: string
}

export function isShellCommandProposal(value: unknown): value is ShellCommandProposal {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<ShellCommandProposal>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayCommand === 'string' &&
    Array.isArray(candidate.argv) &&
    candidate.argv.every((token) => typeof token === 'string')
  )
}

/**
 * Review surface for a shell command Adam wants to run.
 *
 * Why the argv is listed one token per line rather than as the joined command:
 * a long argument is the thing worth reading carefully, and on a single wrapped
 * line a path like `/Users/x/Projects` sitting after `rm -rf` is easy to skim
 * past. One line per argument makes the target of the command unmissable.
 *
 * This Run button is the only thing on the machine that can execute a queued
 * command. The agent is never told the id, and main refuses the call from any
 * other window.
 */
export function ShellCommandReview({
  command,
  onDone
}: {
  command: ShellCommandProposal
  onDone: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.jarvis.runApprovedShell(command.id)
    setBusy(false)
    if (result.ok) {
      setOutput(result.output || '(no output)')
      return
    }
    onDone(result.error)
  }

  const discard = async (): Promise<void> => {
    // Once output exists the command has already run and its id is gone from
    // the queue, so discarding is a no-op that would report "nothing was run"
    // about a command that just ran. Close without the false reassurance.
    if (output !== null) {
      onDone('Finished.')
      return
    }
    setBusy(true)
    await window.api.jarvis.discardShellCommand(command.id)
    setBusy(false)
    onDone('Discarded. Nothing was run.')
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 pb-3 pt-10">
        <p className="text-sm">This writes to your machine.</p>
        <p className="mt-1 text-xs text-muted-foreground">{command.description}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <pre className="font-mono text-xs leading-relaxed">
          {command.argv.map((token, index) => (
            <div key={`${index}-${token}`} className={index === 0 ? 'font-semibold' : 'pl-4'}>
              {token}
            </div>
          ))}
        </pre>
        {output === null ? null : (
          <pre className="mt-4 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
            {output}
          </pre>
        )}
      </div>

      <footer className="shrink-0 border-t border-border px-4 py-3">
        <p className="mb-2 text-xs text-muted-foreground">
          Read every line. Nothing runs until you click Run — Adam cannot approve this himself.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void run()} disabled={busy || output !== null}>
            Run
          </Button>
          <Button size="sm" variant="outline" onClick={() => void discard()} disabled={busy}>
            {output === null ? 'Discard' : 'Close'}
          </Button>
        </div>
      </footer>
    </div>
  )
}
