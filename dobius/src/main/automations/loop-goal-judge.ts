import { spawn as nodeSpawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import {
  LOOP_JUDGE_TIMEOUT_MS,
  buildJudgePrompt,
  parseJudgeVerdict
} from '../../shared/automation-loop-judge'
import { resolveClaudeCommand } from '../codex-cli/command'

export type GoalJudgeResult = {
  verdict: 'met' | 'not-met' | null
  error: string | null
}

/** Asks a separate, throwaway agent session whether a loop's goal is met. */
export type LoopGoalJudge = (input: {
  goal: string
  transcript: readonly string[]
}) => Promise<GoalJudgeResult>

const MAX_OUTPUT_CHARS = 64 * 1024

/**
 * Why each flag: `-p` is a one-shot session that exits after one answer;
 * `--tools ""` removes every built-in tool and `--strict-mcp-config` (with no
 * config) every MCP server, so the judge can read nothing and change nothing;
 * plan mode is a second read-only guard; `--setting-sources project` run from
 * the temp dir loads no user hooks; nothing is saved as a resumable session.
 */
export const GOAL_JUDGE_ARGS: readonly string[] = [
  '-p',
  '--output-format',
  'text',
  '--model',
  'sonnet',
  '--tools',
  '',
  '--strict-mcp-config',
  '--permission-mode',
  'plan',
  '--setting-sources',
  'project',
  '--disable-slash-commands',
  '--no-session-persistence'
]

type SpawnLike = typeof nodeSpawn

export type ClaudeGoalJudgeDeps = {
  spawn?: SpawnLike
  resolveCommand?: () => string
  timeoutMs?: number
  cwd?: string
}

/** Raw answer of one locked-down judge run: its stdout, or why there is none. */
export type JudgeRunResult = { output: string | null; error: string | null }

/**
 * The judge is its own child process with no terminal attached: it gets the
 * prompt on stdin and answers on stdout. It never sees or writes to a board
 * console, and it is killed when it outlives the timeout. Shared by loop goal
 * judging and the Board goal card's drift check.
 */
export function runLockedDownJudge(
  prompt: string,
  deps: ClaudeGoalJudgeDeps = {}
): Promise<JudgeRunResult> {
  const spawn = deps.spawn ?? nodeSpawn
  const timeoutMs = deps.timeoutMs ?? LOOP_JUDGE_TIMEOUT_MS
  return new Promise<JudgeRunResult>((resolve) => {
    let settled = false
    let stdout = ''
    const finish = (result: JudgeRunResult): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
    }
    let child: ReturnType<SpawnLike>
    try {
      const command = (deps.resolveCommand ?? (() => resolveClaudeCommand()))()
      child = spawn(command, [...GOAL_JUDGE_ARGS], {
        cwd: deps.cwd ?? tmpdir(),
        env: { ...process.env, DOBIUS_LOOP_JUDGE: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
        shell: false,
        windowsHide: true
      })
    } catch (error) {
      resolve({ output: null, error: `Judge could not start: ${messageOf(error)}` })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        output: null,
        error: `Judge timed out after ${Math.round(timeoutMs / 1000)}s.`
      })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_OUTPUT_CHARS)
    })
    child.on('error', (error) =>
      finish({ output: null, error: `Judge could not start: ${messageOf(error)}` })
    )
    child.on('close', (code) => {
      finish(
        code === 0
          ? { output: stdout, error: null }
          : { output: null, error: `Judge exited with code ${code}.` }
      )
    })
    child.stdin?.on('error', () => {
      // The judge exiting early closes stdin; its exit code reports the failure.
    })
    child.stdin?.end(prompt)
  })
}

export function createClaudeGoalJudge(deps: ClaudeGoalJudgeDeps = {}): LoopGoalJudge {
  return async ({ goal, transcript }) => {
    const { output, error } = await runLockedDownJudge(buildJudgePrompt(goal, transcript), deps)
    if (output === null) {
      return { verdict: null, error }
    }
    const verdict = parseJudgeVerdict(output)
    return verdict
      ? { verdict, error: null }
      : { verdict: null, error: 'Judge gave no clear answer.' }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
