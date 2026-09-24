import os from 'node:os'
import path from 'node:path'
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { realpathPreservingMissingTail } from '../communications/providers/protected-path-guard'

type HardRailRunContext = {
  agentId: string
}

type HardRailDenial = {
  reason: string
}

// Why: the shell expands `$HOME`, `${HOME}`, `~` and `~user` before the command
// runs, so a rail that only matches the literal `~/` text is bypassed by any of
// the other spellings. Expand them all (anywhere in the string) before matching.
function expandHomeReferences(value: string): string {
  const home = os.homedir()
  return value
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, () => home)
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

// Why: a protected path can sit anywhere in a Bash command (`cat a; cat <path>`,
// `--file=<path>`), and a symlink can point at it under an innocent name. Every
// absolute path is checked both as written and with symlinks resolved.
function candidatePaths(raw: string): string[] {
  const candidates = new Set<string>()
  for (const [token] of expandHomeReferences(raw).matchAll(ABSOLUTE_PATH_TOKEN)) {
    candidates.add(path.normalize(token).replace(/\\/g, '/'))
    candidates.add(realpathPreservingMissingTail(token).replace(/\\/g, '/'))
  }
  return [...candidates]
}

// Both spellings of a protected location: as written under $HOME, and with
// symlinks resolved (e.g. a dotfiles-managed ~/.claude).
function protectedForms(literal: string): string[] {
  const real = realpathPreservingMissingTail(literal).replace(/\\/g, '/')
  const trailing = literal.endsWith('/') ? '/' : ''
  return [...new Set([literal, `${real.replace(/\/$/, '')}${trailing}`])]
}

function collectStrings(value: unknown, strings: string[] = []): string[] {
  if (typeof value === 'string') {
    strings.push(value)
    return strings
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, strings)
    }
    return strings
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectStrings(item, strings)
    }
  }
  return strings
}

function commandTriggersHardRail(toolName: string, input: unknown): HardRailDenial | null {
  if (toolName !== 'Bash' || typeof input !== 'object' || input === null) {
    return null
  }
  const command = (input as { command?: unknown }).command
  if (typeof command !== 'string') {
    return null
  }
  if (isForcePush(command)) {
    return { reason: 'Hard rail: force-pushing is not allowed from agent runs.' }
  }
  if (/\brm\s+(?:-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+(?:--\s+)?\/(?:\*|\s|$)/.test(command)) {
    return { reason: 'Hard rail: recursive root deletes are not allowed from agent runs.' }
  }
  return null
}

const SHELL_SEGMENT_SEPARATOR = /&&|\|\||[;|&\n()`]/

// Why: flags belong to the command in their own shell segment only, so
// `git push && rm -rf dist` must not read rm's `-rf` as a push flag. Global
// options can sit between git and push (`git -C <path> push --force`).
function isForcePush(command: string): boolean {
  for (const segment of command.split(SHELL_SEGMENT_SEPARATOR)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^["']|["']$/g, ''))
    const gitIndex = tokens.findIndex((token) => token === 'git' || token.endsWith('/git'))
    const pushIndex = gitIndex === -1 ? -1 : tokens.indexOf('push', gitIndex + 1)
    if (pushIndex !== -1 && tokens.slice(pushIndex + 1).some(isForcePushArgument)) {
      return true
    }
  }
  return false
}

// `+branch` is refspec-syntax force-push — same rail as --force / -f.
function isForcePushArgument(token: string): boolean {
  return token.startsWith('--force') || /^-[A-Za-z]*f[A-Za-z]*$/.test(token) || /^\+\S/.test(token)
}

// Why: prefix-agnostic on purpose — `/Users/$USER/.claude/...` or a variable
// holding the home dir cannot be expanded here, but the credential file names
// themselves are distinctive enough to deny wherever they appear.
function rawStringMentionsCredential(value: string): boolean {
  return (
    /(^|[\s"'=:/\\])\.env(?:\.[^\s"'`;&|]*)?(?=$|[\s"'`;&|])/i.test(value) ||
    /(^|[\s"'=:/\\])\.credentials\.json(?=$|[\s"'`;&|)])/i.test(value) ||
    /\.claude[/\\]credentials[^\s"'`;&|]*/i.test(value) ||
    /\.dobius[/\\][^\s"'`;&|]*[/\\]token[^\s"'`;&|]*/i.test(value) ||
    /Library[/\\]Keychains(?:[/\\]|\s|$)/i.test(value)
  )
}

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

// Why: for file-editing tools only the TARGET PATH matters — scanning the content
// payload false-denies writing ".env" into a .gitignore or a README that mentions it.
function stringsToInspect(toolName: string, input: unknown): string[] {
  if (FILE_EDIT_TOOLS.includes(toolName) && typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>
    return ['file_path', 'path', 'notebook_path']
      .map((key) => record[key])
      .filter((value): value is string => typeof value === 'string')
  }
  return collectStrings(input)
}

function targetsCredentials(toolName: string, input: unknown): HardRailDenial | null {
  const home = normalizePathLike(os.homedir())
  const credentialPrefixes = [
    `${home}/.claude/.credentials.json`,
    `${home}/.claude/credentials`,
    `${home}/Library/Keychains`
  ].flatMap(protectedForms)
  const dobiusPrefixes = protectedForms(`${home}/.dobius/`)
  for (const raw of stringsToInspect(toolName, input)) {
    if (rawStringMentionsCredential(raw)) {
      return { reason: 'Hard rail: credential material is not available to agents.' }
    }
    const normalized = normalizePathLike(raw)
    const basename = path.basename(normalized)
    if (basename === '.env' || basename.startsWith('.env.')) {
      return { reason: 'Hard rail: credential environment files are not available to agents.' }
    }
    for (const candidate of [normalized, ...candidatePaths(raw)]) {
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

function targetsOtherAgentIdentity(
  context: HardRailRunContext,
  toolName: string,
  input: unknown
): HardRailDenial | null {
  // Why: Bash can cp/cat/rm another agent's files just as well as Write/Edit can —
  // the isolation rail must cover shell commands too.
  if (!FILE_EDIT_TOOLS.includes(toolName) && toolName !== 'Bash') {
    return null
  }
  const agentsRoots = protectedForms(
    `${normalizePathLike(path.join(os.homedir(), '.dobius', 'agents'))}/`
  )
  // Why: inside a Bash command the agents dir appears mid-string (often via ~ or
  // $HOME), so a startsWith check misses it — scan for every reference instead.
  const referencePattern = /\/\.dobius\/agents\/([^/\s"'`;&|]+)/g
  for (const raw of stringsToInspect(toolName, input)) {
    for (const candidate of [normalizePathLike(raw), ...candidatePaths(raw)]) {
      const agentsRoot = agentsRoots.find((root) => candidate.startsWith(root))
      const targetAgentId = agentsRoot ? candidate.slice(agentsRoot.length).split('/')[0] : ''
      if (targetAgentId && targetAgentId !== context.agentId) {
        return { reason: 'Hard rail: agents may not edit another agent identity or memory.' }
      }
    }
    for (const match of expandHomeReferences(raw).matchAll(referencePattern)) {
      const targetAgentId = match[1]
      if (targetAgentId && targetAgentId !== context.agentId) {
        return { reason: 'Hard rail: agents may not edit another agent identity or memory.' }
      }
    }
  }
  return null
}

export function evaluateAgentHardRails(
  context: HardRailRunContext,
  toolName: string,
  input: unknown
): HardRailDenial | null {
  return (
    commandTriggersHardRail(toolName, input) ??
    targetsCredentials(toolName, input) ??
    targetsOtherAgentIdentity(context, toolName, input)
  )
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
            const denial = evaluateAgentHardRails(context, input.tool_name, input.tool_input)
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
