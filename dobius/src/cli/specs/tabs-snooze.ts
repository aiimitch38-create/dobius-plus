import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const UNTIL_NOTE =
  '--until takes 30m, 2h or 1d from now, a clock time like 14:30 (the next one), an ISO date and time (2026-11-23T09:00), or manual (wait until brought back). At most a year ahead.'

// Why `tabs` (plural): `dobius tab ...` already means tabs of the embedded browser.
export const TABS_SNOOZE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['tabs', 'snooze'],
    summary: 'Snooze a terminal tab: close it now (its terminal stops) and bring it back later',
    usage: 'dobius tabs snooze --tab <tabId> --until <time> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tab', 'until', 'force'],
    notes: [
      '--tab takes a terminal tab id ($DOBIUS_TAB_ID in a tab, or the tabId column of `dobius board list`).',
      UNTIL_NOTE,
      'Same as Snooze on the tab: its agent conversation is saved and resumes when it comes back. A tab with split panes is refused.',
      'A tab whose agent is working is refused (tab_agent_working) unless you pass --force, which stops its current turn. Nothing pops up on screen.',
      'Needs the Dobius+ window open.'
    ],
    examples: ['dobius tabs snooze --tab "$DOBIUS_TAB_ID" --until 2h --json', 'dobius tabs snooze --tab tab_abc --until manual']
  },
  {
    path: ['tabs', 'unsnooze'],
    summary: 'Bring a snoozed tab back now',
    usage: 'dobius tabs unsnooze --tab <tabId> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tab', 'worktree'],
    notes: [
      'It comes back exactly like a snooze whose time is up: its workspace window reopens it and resumes its conversation once. If that window is not open yet, it comes back when it opens.',
      'Refused with tab_snooze_returning when it is already coming back (it is never resumed twice), and with crew_paused while Pause crew is on and the tab would resume an agent.',
      '--worktree is needed only when two snoozed tabs share an id.'
    ],
    examples: ['dobius tabs unsnooze --tab tab_abc --json']
  },
  {
    path: ['tabs', 'snoozed'],
    summary: 'List snoozed tabs and when each comes back',
    usage: 'dobius tabs snoozed [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Without --worktree, lists snoozed tabs of every workspace (at most 100 exist).',
      'Text columns: tab id, when it comes back (or ready / coming back / manual), workspace, title. Read-only.'
    ],
    examples: ['dobius tabs snoozed --json']
  }
]
