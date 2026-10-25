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
  },
  {
    path: ['board', 'open-tile'],
    summary: 'Open a web tile (private session) on the worktree Board for an agent to drive',
    usage:
      'dobius board open-tile --url <http(s) url> [--title <text>] [--as <agentId>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'title', 'as', 'worktree'],
    notes: [
      '--worktree defaults to active (the worktree enclosing the current directory).',
      '--as names the agent the tile is for (defaults to $DOBIUS_AGENT_ID); ids match ^[a-z0-9][a-z0-9_-]{0,63}$.',
      'The tile browses in the private in-memory session. Returns once the tile page is operable; drive it with the browser commands and --page <browserPageId>.'
    ],
    examples: [
      'dobius board open-tile --url https://example.com --title "Docs" --as adam --json',
      'dobius click --page web-tile:<cardId> --text "Sign in"'
    ]
  },
  {
    path: ['board', 'agent-control'],
    summary: 'Pause or stop an agent driving Board tiles (resume, take over, approve and deny are Board-only)',
    usage: 'dobius board agent-control --agent <agentId> --action pause|stop [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent', 'action'],
    notes: [
      'Only the human can resume, take over, approve or deny, from the Board window. An agent may only pause or stop itself here.',
      'pause and stop deny every pending gate for the agent; stop also drops its tile claims.'
    ],
    examples: ['dobius board agent-control --agent adam --action stop --json']
  }
]
