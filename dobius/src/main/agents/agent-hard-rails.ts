import os from 'node:os'
import path from 'node:path'
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import {
  comparablePath,
  realpathPreservingMissingTail
} from '../communications/providers/protected-path-guard'
import {
  GIT_CONFIG_WRITE_REASON,
  isForcePush,
  isUnverifiablePush,
  SHELL_SEGMENT_SEPARATOR,
  UNVERIFIABLE_PUSH_REASON,
  writesPushRewritingGitConfig
} from './agent-hard-rails-git'
import {
  buildsUnresolvableShellPath,
  UNRESOLVABLE_SHELL_PATH_REASON
} from './agent-hard-rails-shell'
import { rawStringMentionsCredential, stringsToInspect } from './agent-hard-rails-inputs'
import { shellCInnerCommands, stripLiteralHeredocs } from './agent-hard-rails-shell-text'

type HardRailRunContext = {
  agentId: string
  // The tool call's working directory (from the SDK hook input) when known.
  cwd?: string
}

type HardRailDenial = {
  reason: string
}

// Why: the shell expands `$HOME`, `${HOME}`, `~`, `~user` and `$USER` before the
// command runs, so a rail that only matches the literal `~/` text is bypassed by
// any of the other spellings. Expand them all (anywhere in the string) before matching.
function expandHomeReferences(value: string): string {
  const home = os.homedir()
  return value
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, () => home)
    .replace(/\$\{(?:USER|LOGNAME)\}|\$(?:USER|LOGNAME)(?![A-Za-z0-9_])/g, () =>
      path.basename(home)
    )
    .replace(
      /(^|[\s"'=:(`])~([A-Za-z0-9._-]*)(?=[/\\\s"'`;&|)]|$)/g,
      (_match, lead: string, user: string) =>
        `${lead}${user ? path.join(path.dirname(home), user) : home}`
    )
}

function normalizePathLike(value: string): string {
  return path.normalize(expandHomeReferences(value)).replace(/\\/g, '/')
}

const ABSOLUTE_PATH_TOKEN = /(?<![^\s"'=:(`<>])\/[^\s"'`;&|<>()]+/g

// Why: symlink resolution costs filesystem calls on the Electron main thread;
// past this many tokens only the lexical checks run (credential names are still
// denied by rawStringMentionsCredential).
const MAX_RESOLVED_PATH_TOKENS = 64

type InspectedString = {
  // Top-level input key the string came from ('' when the input is not an object).
  field: string
  raw: string
  // Home references expanded; for Bash also quotes/backslashes removed the way
  // the shell would (`~/.dobius/"agents"/x` reaches `agents`).
  expanded: string
  // Comparable (case-folded where the filesystem is) path spellings to check.
  candidates: string[]
}

// Why: a protected path can sit anywhere in a Bash command (`cat a; cat <path>`,
// `--file=<path>`), and a symlink can point at it under an innocent name. Every
// absolute path is checked both as written and with symlinks resolved. Computed
// once per tool call and shared by every rail.
function inspectStrings(toolName: string, input: unknown): InspectedString[] {
  let resolveBudget = MAX_RESOLVED_PATH_TOKENS
  return stringsToInspect(toolName, input).map(({ field, raw: original }) => {
    // Why (r2 F3): a literal commit/PR heredoc body is message text, not paths.
    const raw =
      toolName === 'Bash' && field === 'command' ? stripLiteralHeredocs(original) : original
    const unquoted = toolName === 'Bash' ? raw.replace(/["'\\]/g, '') : raw
    const expanded = expandHomeReferences(unquoted)
    const candidates = new Set([comparablePath(normalizePathLike(raw))])
    for (const [token] of expanded.matchAll(ABSOLUTE_PATH_TOKEN)) {
      candidates.add(comparablePath(path.normalize(token).replace(/\\/g, '/')))
      if (resolveBudget > 0) {
        resolveBudget -= 1
        candidates.add(comparablePath(realpathPreservingMissingTail(token).replace(/\\/g, '/')))
      }
    }
    return { field, raw, expanded, candidates: [...candidates] }
  })
}

// Both spellings of a protected location: as written under $HOME, and with
// symlinks resolved (e.g. a dotfiles-managed ~/.claude), in comparable form.
function protectedForms(literal: string): string[] {
  const real = realpathPreservingMissingTail(literal).replace(/\\/g, '/')
  const trailing = literal.endsWith('/') ? '/' : ''
  return [...new Set([literal, `${real.replace(/\/$/, '')}${trailing}`])].map(comparablePath)
}

function commandTriggersHardRail(toolName: string, input: unknown): HardRailDenial | null {
  if (toolName !== 'Bash' || typeof input !== 'object' || input === null) {
    return null
  }
  const rawCommand = (input as { command?: unknown }).command
  if (typeof rawCommand !== 'string') {
    return null
  }
  const command = stripLiteralHeredocs(rawCommand)
  if (isForcePush(command)) {
    return { reason: 'Hard rail: force-pushing is not allowed from agent runs.' }
  }
  if (isUnverifiablePush(command)) {
    return { reason: UNVERIFIABLE_PUSH_REASON }
  }
  if (writesPushRewritingGitConfig(command)) {
    return { reason: GIT_CONFIG_WRITE_REASON }
  }
  if (/\brm\s+(?:-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+(?:--\s+)?\/(?:\*|\s|$)/.test(command)) {
    return { reason: 'Hard rail: recursive root deletes are not allowed from agent runs.' }
  }
  return null
}

function targetsCredentials(inspected: InspectedString[]): HardRailDenial | null {
  const home = normalizePathLike(os.homedir())
  const credentialPrefixes = [
    `${home}/.claude/.credentials.json`,
    `${home}/.claude/credentials`,
    `${home}/Library/Keychains`
  ].flatMap(protectedForms)
  const dobiusPrefixes = protectedForms(`${home}/.dobius/`)
  for (const { raw, expanded, candidates } of inspected) {
    if (rawStringMentionsCredential(raw) || rawStringMentionsCredential(expanded)) {
      return { reason: 'Hard rail: credential material is not available to agents.' }
    }
    const basename = path.basename(normalizePathLike(raw))
    if (basename === '.env' || basename.startsWith('.env.')) {
      return { reason: 'Hard rail: credential environment files are not available to agents.' }
    }
    for (const candidate of candidates) {
      if (credentialPrefixes.some((prefix) => candidate.startsWith(prefix))) {
        return { reason: 'Hard rail: credential material is not available to agents.' }
      }
      if (
        dobiusPrefixes.some((prefix) => candidate.startsWith(prefix)) &&
        /\/token[^/]*$/i.test(candidate)
      ) {
        return { reason: 'Hard rail: credential material is not available to agents.' }
      }
    }
  }
  return null
}

const IDENTITY_DENIAL: HardRailDenial = {
  reason: 'Hard rail: agents may not read or edit another agent identity or memory.'
}

// Input fields that name a location, per tool. Content payloads and Grep's
// regex `pattern` are not locations and are left out (a search for the text
// ".dobius/agents" in a repo is fine).
const IDENTITY_FIELDS: Record<string, readonly string[]> = {
  Bash: ['command'],
  Write: ['file_path', 'path', 'notebook_path'],
  Edit: ['file_path', 'path', 'notebook_path'],
  MultiEdit: ['file_path', 'path', 'notebook_path'],
  NotebookEdit: ['file_path', 'path', 'notebook_path'],
  Read: ['file_path'],
  NotebookRead: ['notebook_path'],
  Glob: ['path', 'pattern'],
  Grep: ['path', 'glob']
}

// Tools that act on a whole directory tree: pointing them at the agents folder
// (or at ~/.dobius) reaches every agent, not one.
const DIRECTORY_SCOPED_TOOLS = ['Bash', 'Glob', 'Grep']

const AGENTS_FOLDER_REFERENCE = /\.dobius\/+agents(?=\/|$|[\s;&|`()<>])/i
const DOT_DOT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/

function tokensOf(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

// Why: `..` only matters where it climbs out of an agent folder — inside a path
// that names the agents folder, or after a `cd` into it. `cat ../README.md
// ~/.dobius/agents/<own>/x` must stay allowed.
function climbsOutOfAgentFolder(command: string): boolean {
  let insideAgentsFolder = false
  for (const segment of command.split(SHELL_SEGMENT_SEPARATOR)) {
    const tokens = tokensOf(segment)
    if (tokens.some((token) => DOT_DOT_SEGMENT.test(token) && AGENTS_FOLDER_REFERENCE.test(token))) {
      return true
    }
    if (insideAgentsFolder && tokens.some((token) => DOT_DOT_SEGMENT.test(token))) {
      return true
    }
    if (tokens[0] === 'cd' || tokens[0] === 'pushd') {
      insideAgentsFolder = tokens.slice(1).some((token) => AGENTS_FOLDER_REFERENCE.test(token))
    }
  }
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function targetsOtherAgentIdentity(
  context: HardRailRunContext,
  toolName: string,
  inspected: InspectedString[]
): HardRailDenial | null {
  // Why: Bash, Read, Glob and Grep reach another agent's files just as well as
  // Write/Edit can — the isolation rail must cover every file-touching tool.
  const fields = IDENTITY_FIELDS[toolName]
  if (!fields) {
    return null
  }
  const scopesDirectory = DIRECTORY_SCOPED_TOOLS.includes(toolName)
  const ownId = comparablePath(context.agentId)
  const home = normalizePathLike(os.homedir())
  const agentsRoots = protectedForms(`${home}/.dobius/agents/`)
  // Why: inside a Bash command the agents dir appears mid-string (often via ~ or
  // $HOME), so a startsWith check misses it — scan for every reference instead.
  const referencePattern = /\.dobius\/+agents(?=\/|$|[\s;&|`()<>])(?:\/+([^/\s`;&|()<>]*))?/gi
  // Why: a shell that `cd`s into ~/.dobius or its agents folder (or a Glob/Grep
  // rooted there) reaches every agent through relative paths (`cat other/memory.md`),
  // so a reference that stops at those folders is denied too — only the own id is usable.
  const dobiusRootReference = new RegExp(
    `${escapeRegExp(home)}/+\\.dobius/*(?=$|[\\s;&|\`()<>])`,
    'i'
  )
  const located = inspected.filter((entry) => fields.includes(entry.field))
  // Glob/Grep `path` acts as the working directory for the other fields.
  const searchRootInAgentsFolder =
    toolName !== 'Bash' &&
    located.some((entry) => entry.field === 'path' && AGENTS_FOLDER_REFERENCE.test(entry.expanded))
  for (const { expanded, candidates } of located) {
    for (const candidate of candidates) {
      const agentsRoot = agentsRoots.find((root) => candidate.startsWith(root))
      const targetAgentId = agentsRoot ? candidate.slice(agentsRoot.length).split('/')[0] : ''
      if (targetAgentId && targetAgentId !== ownId) {
        return IDENTITY_DENIAL
      }
    }
    for (const match of expanded.matchAll(referencePattern)) {
      const targetAgentId = comparablePath(match[1] ?? '')
      if (targetAgentId !== ownId && (targetAgentId || scopesDirectory)) {
        return IDENTITY_DENIAL
      }
    }
    if (scopesDirectory && dobiusRootReference.test(expanded)) {
      return IDENTITY_DENIAL
    }
    // Why: from inside the own agent folder, `../other` reaches a sibling agent.
    if (climbsOutOfAgentFolder(expanded)) {
      return IDENTITY_DENIAL
    }
    if (searchRootInAgentsFolder && tokensOf(expanded).some((token) => DOT_DOT_SEGMENT.test(token))) {
      return IDENTITY_DENIAL
    }
  }
  return null
}

const MAX_SHELL_C_DEPTH = 4

export function evaluateAgentHardRails(
  context: HardRailRunContext,
  toolName: string,
  input: unknown,
  depth = 0
): HardRailDenial | null {
  const commandDenial = commandTriggersHardRail(toolName, input)
  if (commandDenial) {
    return commandDenial
  }
  // Why (CX12 F1): `bash -c '<string>'` runs a whole second command the outer
  // scan sees only as quoted text, so every rail runs on it too.
  const command = toolName === 'Bash' ? (input as { command?: unknown }).command : undefined
  const shellC =
    typeof command === 'string' ? shellCInnerCommands(command) : { inner: [], unparsable: false }
  if (shellC.unparsable) {
    return { reason: UNRESOLVABLE_SHELL_PATH_REASON }
  }
  for (const inner of shellC.inner) {
    const innerDenial =
      depth >= MAX_SHELL_C_DEPTH
        ? { reason: UNRESOLVABLE_SHELL_PATH_REASON }
        : evaluateAgentHardRails(context, 'Bash', { command: inner }, depth + 1)
    if (innerDenial) {
      return innerDenial
    }
  }
  const inspected = inspectStrings(toolName, input)
  const pathDenial =
    targetsCredentials(inspected) ?? targetsOtherAgentIdentity(context, toolName, inspected)
  const home = normalizePathLike(os.homedir())
  const buildsUnresolvablePath =
    toolName === 'Bash' &&
    inspected.some(
      ({ field, raw }) =>
        field === 'command' &&
        buildsUnresolvableShellPath(expandHomeReferences(raw), { home, cwd: context.cwd })
    )
  return pathDenial ?? (buildsUnresolvablePath ? { reason: UNRESOLVABLE_SHELL_PATH_REASON } : null)
}

export function buildAgentHardRailHooks(context: HardRailRunContext): {
  PreToolUse: HookCallbackMatcher[]
} {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input): Promise<HookJSONOutput> => {
            if (input.hook_event_name !== 'PreToolUse') {
              return { continue: true }
            }
            const denial = evaluateAgentHardRails(
              { ...context, cwd: input.cwd },
              input.tool_name,
              input.tool_input
            )
            if (!denial) {
              return { continue: true }
            }
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: denial.reason
              }
            }
          }
        ]
      }
    ]
  }
}
