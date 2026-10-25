import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const BOARD_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['board', 'spawn-console'],
    summary: 'Put a worker (or lead) agent console on the worktree Board with a prompt',
    usage:
      'dobius board spawn-console --worktree <selector> --agent <tui-agent> --title <text> --lead <profile> (--prompt-file <path> | --prompt <text>) [--task <id>] [--role worker|lead] [--command-override <cmd>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'worktree',
      'agent',
      'title',
      'prompt',
      'prompt-file',
      'lead',
      'task',
      'role',
      'command-override'
    ],
    notes: [
      'Caps are enforced by Dobius+: at most 4 workers per lead and 6 workers per board. A refused spawn exits non-zero with worker_cap_reached.',
      'The prompt is typed into the agent after it is ready; it never goes on the launch command line. --prompt-file is read by Dobius+ (regular file, at most 64 KB).',
      'The card role becomes worker:<lead> or lead:<lead>; `dobius board consoles` lists them.',
      'Returns a requestId once the Board has been asked to spawn; the console appears a moment later.'
    ],
    examples: [
      'dobius board spawn-console --worktree active --agent codex --title "W1 · task-42" --prompt-file ./briefs/task-42.md --lead lead-acme --task task-42 --json',
      'dobius board spawn-console --worktree active --agent hermes --title "Lead · acme" --lead lead-acme --role lead --command-override "hermes -p lead-acme chat --tui"'
    ]
  },
  {
    path: ['board', 'consoles'],
    summary: 'List the console cards on a worktree Board (tab id, title, role)',
    usage: 'dobius board consoles [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: ['--worktree defaults to active (the worktree enclosing the current directory).'],
    examples: ['dobius board consoles --json', 'dobius board consoles --worktree branch:main']
  }
]
