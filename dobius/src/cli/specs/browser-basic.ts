import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const BROWSER_BASIC_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['snapshot'],
    summary: 'Capture an accessibility snapshot of the active browser tab',
    usage: 'dobius snapshot [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'as', 'fast']
  },
  {
    path: ['screenshot'],
    summary: 'Capture a viewport screenshot of the active browser tab',
    usage: 'dobius screenshot [--format <png|jpeg>] [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'format', 'worktree', 'as', 'fast']
  },
  {
    path: ['click'],
    summary: 'Click a browser element by ref',
    usage: 'dobius click --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['fill'],
    summary: 'Clear and fill a browser input by ref',
    usage: 'dobius fill --element <ref> --value <text> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'value', 'worktree', 'as', 'fast']
  },
  {
    path: ['type'],
    summary: 'Type text at the current browser focus',
    usage: 'dobius type --input <text> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'input', 'worktree', 'as', 'fast']
  },
  {
    path: ['select'],
    summary: 'Select a dropdown option by ref',
    usage: 'dobius select --element <ref> --value <value> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'value', 'worktree', 'as', 'fast']
  },
  {
    path: ['scroll'],
    summary: 'Scroll the browser viewport',
    usage: 'dobius scroll --direction <up|down> [--amount <pixels>] [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'direction', 'amount', 'worktree', 'as', 'fast']
  },
  {
    path: ['goto'],
    summary: 'Navigate the active browser tab to a URL',
    usage: 'dobius goto --url <url> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree', 'as', 'fast']
  },
  {
    path: ['back'],
    summary: 'Navigate back in browser history',
    usage: 'dobius back [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['reload'],
    summary: 'Reload the active browser tab',
    usage: 'dobius reload [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['eval'],
    summary: 'Evaluate JavaScript in the browser page context',
    usage: 'dobius eval --expression <js> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'expression', 'worktree']
  },
  {
    path: ['wait'],
    summary: 'Wait for element, text, URL, load state, JS condition, or timeout',
    usage:
      'dobius wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <js>] [--state <hidden|visible>] [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'selector',
      'timeout',
      'text',
      'url',
      'load',
      'fn',
      'state',
      'worktree', 'as', 'fast'
    ]
  },
  {
    path: ['check'],
    summary: 'Check a checkbox/radio by ref',
    usage: 'dobius check --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['uncheck'],
    summary: 'Uncheck a checkbox/radio by ref',
    usage: 'dobius uncheck --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['focus'],
    summary: 'Focus a browser element by ref',
    usage: 'dobius focus --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['clear'],
    summary: 'Clear an input element by ref',
    usage: 'dobius clear --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['select-all'],
    summary: 'Select all text in an input by ref',
    usage: 'dobius select-all --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['keypress'],
    summary: 'Press a key (Enter, Tab, Escape, ArrowDown, etc.)',
    usage: 'dobius keypress --key <name> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'worktree', 'as', 'fast']
  },
  {
    path: ['pdf'],
    summary: 'Export the active browser tab as PDF',
    usage: 'dobius pdf [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['full-screenshot'],
    summary: 'Capture a full-page screenshot (beyond viewport)',
    usage: 'dobius full-screenshot [--format <png|jpeg>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'format', 'worktree']
  },
  {
    path: ['hover'],
    summary: 'Hover over a browser element by ref',
    usage: 'dobius hover --element <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'worktree', 'as', 'fast']
  },
  {
    path: ['drag'],
    summary: 'Drag from one element to another',
    usage: 'dobius drag --from <ref> --to <ref> [--worktree <selector>] [--as <agentId>] [--fast] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'from', 'to', 'worktree', 'as', 'fast']
  },
  {
    path: ['upload'],
    summary: 'Upload files to a file input element',
    usage: 'dobius upload --element <ref> --files <path,...> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'element', 'files', 'worktree']
  },
  {
    path: ['tab', 'list'],
    summary: 'List open browser tabs',
    usage: 'dobius tab list [--worktree <selector|all>] [--show-profile] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'show-profile']
  },
  {
    path: ['tab', 'show'],
    summary: 'Show one browser tab by page id',
    usage: 'dobius tab show --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'current'],
    summary: 'Show the current browser tab',
    usage: 'dobius tab current [--worktree <selector|all>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['tab', 'switch'],
    summary: 'Switch the active browser tab',
    usage: 'dobius tab switch (--index <n> | --page <id>) [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'index', 'page', 'worktree', 'focus']
  },
  {
    path: ['tab', 'create'],
    summary: 'Create a new browser tab in the current worktree',
    usage: 'dobius tab create [--url <url>] [--worktree <selector>] [--profile <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'url', 'worktree', 'profile']
  },
  {
    path: ['tab', 'profile', 'list'],
    summary: 'List browser session profiles available to browser tabs',
    usage: 'dobius tab profile list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['tab', 'profile', 'create'],
    summary: 'Create a browser session profile for browser tabs',
    usage: 'dobius tab profile create --label <name> [--scope <isolated|imported>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'label', 'scope']
  },
  {
    path: ['tab', 'profile', 'delete'],
    summary: 'Delete a browser session profile used by browser tabs',
    usage: 'dobius tab profile delete --profile <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile']
  },
  {
    path: ['tab', 'profile', 'set'],
    summary: 'Switch a browser tab to a different browser profile',
    usage: 'dobius tab profile set (--page <id> | --worktree <selector>) --profile <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile', 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'show'],
    summary: 'Show the browser profile bound to a tab',
    usage: 'dobius tab profile show --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'use-default'],
    summary: 'Switch a browser tab back to the default browser profile',
    usage: 'dobius tab profile use-default --page <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'page', 'worktree']
  },
  {
    path: ['tab', 'profile', 'clone'],
    summary: 'Clone a browser tab into a different browser profile',
    usage: 'dobius tab profile clone --profile <id> [--page <id>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'profile', 'page', 'worktree']
  },
  {
    path: ['tab', 'close'],
    summary: 'Close a browser tab',
    usage: 'dobius tab close [--index <n>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'index', 'worktree']
  },
  {
    path: ['exec'],
    summary: 'Run any agent-browser command against the active browser tab',
    usage: 'dobius exec --command "<agent-browser command>" [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'command', 'worktree']
  }
]
