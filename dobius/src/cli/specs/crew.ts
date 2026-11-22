import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const PAUSE_NOTE =
  'Pause crew is the same switch as the Agents page. While it is on, nothing autonomous starts: agent runs, heartbeats, Asana auto mode, build dispatches and iMessage commands. A run started by hand on the Agents page still works.'

export const CREW_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['crew', 'status'],
    summary: 'Show whether the agent crew is paused',
    usage: 'dobius crew status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      PAUSE_NOTE,
      'If the crew control file cannot be read, the crew counts as paused and the problem is shown.'
    ],
    examples: ['dobius crew status', 'dobius crew status --json']
  },
  {
    path: ['crew', 'pause'],
    summary: 'Pause the whole agent crew',
    usage: 'dobius crew pause [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [PAUSE_NOTE, 'Runs already going keep going; use `dobius crew stop <runId>` to end one.'],
    examples: ['dobius crew pause']
  },
  {
    path: ['crew', 'resume'],
    summary: 'Let the agent crew run again',
    usage: 'dobius crew resume [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [PAUSE_NOTE, 'Resume is refused while the crew control file cannot be read.'],
    examples: ['dobius crew resume']
  },
  {
    path: ['crew', 'decisions'],
    summary: 'List agent requests waiting for your answer',
    usage: 'dobius crew decisions [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['These are the same cards the Agents page shows when an agent asks to use a tool.'],
    examples: ['dobius crew decisions', 'dobius crew decisions --json']
  },
  {
    path: ['crew', 'decide'],
    summary: 'Answer a waiting agent request',
    usage: 'dobius crew decide <id> --choice <approve|deny|respond> [--note <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'choice', 'note'],
    positionalArgs: ['id'],
    notes: [
      'approve lets the agent use the tool once. deny refuses it. respond refuses it and sends your note to the agent, so --note is required.',
      'Always allow, bypass run and approve-with-edits are only in the app.'
    ],
    examples: [
      'dobius crew decide 7c1e... --choice approve',
      'dobius crew decide 7c1e... --choice respond --note "Use the staging database instead"'
    ]
  },
  {
    path: ['crew', 'drafts'],
    summary: 'List Asana comments agents drafted for your review',
    usage: 'dobius crew drafts [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius crew drafts', 'dobius crew drafts --json']
  },
  {
    path: ['crew', 'draft', 'approve'],
    summary: 'Approve a drafted comment and post it to Asana',
    usage: 'dobius crew draft approve <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: ['This posts the comment to Asana right away. Only pending drafts can be approved.'],
    examples: ['dobius crew draft approve 3b9a...']
  },
  {
    path: ['crew', 'draft', 'discard'],
    summary: 'Throw away a drafted comment without posting it',
    usage: 'dobius crew draft discard <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['dobius crew draft discard 3b9a...']
  },
  {
    path: ['crew', 'briefing'],
    summary: 'Show the crew briefing (recent agent updates)',
    usage: 'dobius crew briefing [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius crew briefing', 'dobius crew briefing --json']
  },
  {
    path: ['crew', 'briefing', 'dismiss'],
    summary: 'Clear every item from the crew briefing',
    usage: 'dobius crew briefing dismiss [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Same as Dismiss on the Agents page: it clears all current items, not one.'],
    examples: ['dobius crew briefing dismiss']
  },
  {
    path: ['crew', 'stop'],
    summary: 'Stop one agent run',
    usage: 'dobius crew stop <runId> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run-id'],
    positionalArgs: ['run-id'],
    notes: ['Find run ids with `dobius agents runs`. Its waiting requests are denied.'],
    examples: ['dobius crew stop 9d2f...', 'dobius crew stop --run-id 9d2f... --json']
  }
]
