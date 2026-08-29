import { execFile } from 'node:child_process'
import { classifyShellCommand, type ClassifyOptions } from './shell-tool'

/**
 * Matches `runCli` in `agent-context.ts`: long enough for a real command, short
 * enough that a command which never returns (an interactive prompt, `tail -f`)
 * releases the agent's turn instead of hanging it. This timeout is why the
 * classifier needs no string analysis for `tail -f`.
 */
const TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 4_000

export type PendingShellCommand = {
  id: string
  argv: string[]
  /** The command as the user reads it in the review window. */
  displayCommand: string
  description: string
  createdAt: number
}

/** Runs an argv and resolves with its combined output. Never rejects. */
export type ShellRunner = (argv: readonly string[]) => Promise<string>

export type ProposeShellResult =
  | { kind: 'ran'; output: string }
  | { kind: 'queued'; command: PendingShellCommand }
  | { kind: 'denied'; reason: string }

export type RunApprovedResult = { ok: true; output: string } | { ok: false; error: string }

/**
 * Executes an argv with no shell.
 *
 * Copied from `runCli` (`agent-context.ts:78`) including its error handling: a
 * non-zero exit that still printed something is reported as that output, since
 * a failing command's stderr is the useful answer.
 */
export function runArgv(argv: readonly string[]): Promise<string> {
  const [binary, ...args] = argv
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
        if (error && !output) {
          resolve(`(failed: ${error.message})`)
          return
        }
        resolve(output.slice(0, MAX_OUTPUT_CHARS))
      }
    )
  })
}

/**
 * What the AGENT is told about a proposal.
 *
 * Why this exists rather than returning the result object: a queued command's
 * id must never reach the model. The id is the only handle that runs a command,
 * and it travels solely on the payload sent to the review window. Without it,
 * no client tool can be written that executes anything — invariant A is
 * enforced by what the model is not given, not only by a tool we chose to omit.
 */
export function describeForAgent(result: ProposeShellResult): string {
  if (result.kind === 'ran') {
    return result.output || '(no output)'
  }
  if (result.kind === 'denied') {
    return `Refused: ${result.reason}`
  }
  return `That writes to the machine, so it is waiting for approval on screen: ${result.command.displayCommand}. Tell the user to read it and click Run. You cannot approve it yourself.`
}

/**
 * Pending shell commands, in memory only.
 *
 * Deliberately not durable: a command approved on a later launch would be
 * approved without the context that produced it. `SelfEditStore` is in memory
 * for the same reason.
 */
export class ShellCommandStore {
  private readonly pending = new Map<string, PendingShellCommand>()
  private sequence = 0

  constructor(
    private readonly options: ClassifyOptions = {},
    private readonly run: ShellRunner = runArgv,
    private readonly now: () => number = Date.now
  ) {}

  async propose(argv: readonly string[], description = ''): Promise<ProposeShellResult> {
    const verdict = classifyShellCommand(argv, this.options)
    if (verdict.verdict === 'denied') {
      return { kind: 'denied', reason: verdict.reason }
    }
    if (verdict.verdict === 'read-only') {
      return { kind: 'ran', output: await this.run(argv) }
    }
    this.sequence += 1
    const command: PendingShellCommand = {
      id: `shell_${this.sequence}`,
      argv: [...argv],
      displayCommand: argv.join(' '),
      description: description.trim() || 'No description given.',
      createdAt: this.now()
    }
    this.pending.set(command.id, command)
    return { kind: 'queued', command }
  }

  get(id: string): PendingShellCommand | null {
    return this.pending.get(id) ?? null
  }

  pendingCount(): number {
    return this.pending.size
  }

  /**
   * Runs an approved command. The ONLY path to execution for anything that
   * writes, and the only caller is the review window's own button.
   */
  async runApproved(id: string): Promise<RunApprovedResult> {
    const command = this.pending.get(id)
    if (!command) {
      return { ok: false, error: 'That command is no longer waiting for approval.' }
    }
    // Removed before running, not after: an id that stayed in the queue while
    // its command was in flight could be submitted a second time and run twice.
    this.pending.delete(id)
    return { ok: true, output: await this.run(command.argv) }
  }

  discard(id: string): boolean {
    return this.pending.delete(id)
  }
}
