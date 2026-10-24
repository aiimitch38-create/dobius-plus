// Starter skills offered as one-click templates, plus the SKILL.md writer the
// create/duplicate flows share. Pure. Starter text is Dobius's own wording and
// stays English: it is instructions for an agent, not UI copy.

export type SkillStarter = {
  id: string
  /** Folder and frontmatter name. */
  name: string
  title: string
  description: string
  body: string
}

/** YAML-safe scalar: plain when it can be, otherwise double-quoted. */
export function yamlScalar(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat && /^[A-Za-z0-9][^:#"'\\]*$/.test(flat) && !/\s$/.test(flat)) {
    return flat
  }
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Turns free text into a valid skill name (lowercase, digits, single hyphens, <= 64). */
export function toSkillName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

export function buildSkillMarkdown(args: {
  name: string
  description: string
  body: string
}): string {
  const body = args.body.trim()
  return `---\nname: ${yamlScalar(args.name)}\ndescription: ${yamlScalar(args.description)}\n---\n\n${body}\n`
}

/** Name for a copy that does not collide with names already in use. */
export function duplicateSkillName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = toSkillName(name) || 'skill'
  for (let i = 1; i < 1000; i += 1) {
    const suffix = i === 1 ? '-copy' : `-copy-${i}`
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!used.has(candidate)) {
      return candidate
    }
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`
}

/** Rewrites the frontmatter name of a SKILL.md, adding frontmatter if missing. */
export function renameSkillMarkdown(content: string, name: string): string {
  const normalized = content.replace(/\r\n?/g, '\n')
  if (normalized.startsWith('---\n')) {
    const end = normalized.indexOf('\n---', 4)
    if (end !== -1) {
      const head = normalized.slice(4, end)
      const nextHead = /^name\s*:.*$/m.test(head)
        ? head.replace(/^name\s*:.*$/m, `name: ${yamlScalar(name)}`)
        : `name: ${yamlScalar(name)}\n${head}`
      return `---\n${nextHead}${normalized.slice(end)}`
    }
  }
  return `---\nname: ${yamlScalar(name)}\n---\n\n${normalized}`
}

const starter = (
  id: string,
  title: string,
  description: string,
  steps: readonly string[]
): SkillStarter => ({
  id,
  name: id,
  title,
  description,
  body: `# ${title}\n\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n`
})

export const SKILL_STARTERS: readonly SkillStarter[] = [
  starter(
    'commit',
    'Commit',
    'Stage and commit the current work with a clear message. Use when the user asks to commit, save progress, or check in changes.',
    [
      'Run `git status` and `git diff` to see exactly what changed.',
      'Stage only the files that belong to this change; never stage secrets, build output or unrelated edits.',
      'Write a subject line under 72 characters in the imperative mood, then a short body explaining why.',
      'Commit without skipping hooks. If a hook fails, fix the cause and commit again.',
      'Report the commit hash and the files it includes.'
    ]
  ),
  starter(
    'pr-description',
    'PR description',
    'Draft a pull request title and description from the branch diff. Use when opening or updating a pull request.',
    [
      'Compare the branch to its base with `git log` and `git diff` to collect every change.',
      'Write a one-line title that names the user-visible outcome.',
      'Add a Summary section with two to four bullets on what changed and why.',
      'Add a Testing section listing the commands that were run and their results.',
      'Call out risks, migrations or follow-ups in their own short section.'
    ]
  ),
  starter(
    'changelog',
    'Changelog',
    'Write changelog entries for recent commits grouped by type. Use before a release or when asked what changed.',
    [
      'List commits since the last tag or release with `git log --oneline`.',
      'Group them under Added, Changed, Fixed and Removed; skip pure chores.',
      'Rewrite each entry in plain language a user would understand.',
      'Prepend the entries under a new version heading in CHANGELOG.md without touching older sections.'
    ]
  ),
  starter(
    'test-first',
    'Test first',
    'Implement a change by writing a failing test first, then the code that makes it pass. Use for bug fixes and small features.',
    [
      'Restate the expected behavior in one sentence.',
      'Write the smallest test that captures it and run it to confirm it fails for the right reason.',
      'Write the minimum code to make the test pass.',
      'Run the full related test suite, then refactor while it stays green.',
      'Report the test name and the before and after results.'
    ]
  ),
  starter(
    'bug-hunt',
    'Bug hunt',
    'Find the root cause of a reported bug before changing code. Use when something is broken, flaky or throwing errors.',
    [
      'Reproduce the bug and write down the exact steps and output.',
      'Form two or three hypotheses and rank them by likelihood.',
      'Test each hypothesis with logs, a debugger or a focused test until one is confirmed.',
      'Fix the root cause, not the symptom, and add a regression test.',
      'Explain the cause, the fix and how it was verified.'
    ]
  ),
  starter(
    'refactor-plan',
    'Refactor plan',
    'Plan a refactor as small, safe steps before editing. Use when code is hard to change or a module has grown too large.',
    [
      'Read the code and its tests; note what callers depend on.',
      'Describe the target shape in a few sentences.',
      'Break the work into steps that each keep the build and tests green.',
      'List risks and how each step will be verified.',
      'Stop and share the plan before making changes.'
    ]
  ),
  starter(
    'api-docs',
    'API docs',
    'Document public functions, endpoints or modules from the source. Use when an API lacks docs or the docs are out of date.',
    [
      'Find the public surface: exported functions, routes or commands.',
      'For each one, record inputs, outputs, errors and one short example taken from real usage.',
      'Check every claim against the code; do not guess behavior.',
      'Write the docs next to the code or in the docs folder, matching the existing style.'
    ]
  ),
  starter(
    'standup',
    'Standup',
    'Summarize recent work as a short standup update. Use when asked what was done, what is next, or for a status report.',
    [
      'Read commits, merged pull requests and open branches from the last working day.',
      'Write three short sections: Done, Next, Blocked.',
      'Keep each item to one line with a link or hash where it helps.',
      'Leave out anything that cannot be traced to a real change.'
    ]
  ),
  starter(
    'explain',
    'Explain',
    'Explain how a piece of code works in plain language. Use when the user asks how something works or wants a walkthrough.',
    [
      'Locate the entry point and trace the main path through the code.',
      'Describe what happens step by step, citing file and line for each step.',
      'Define any term a newcomer might not know the first time it appears.',
      'End with a two-sentence summary and any surprising behavior found.'
    ]
  ),
  starter(
    'perf-pass',
    'Perf pass',
    'Measure and improve the performance of a slow path. Use when something is slow, janky or uses too much memory.',
    [
      'Measure first: record a baseline with a profiler, benchmark or timing logs.',
      'Find the top one or two hotspots in the measurement, not by guesswork.',
      'Change one thing at a time and measure again after each change.',
      'Keep only changes that clearly help, and report before and after numbers.'
    ]
  ),
  starter(
    'deps-audit',
    'Deps audit',
    'Review project dependencies for outdated, unused or vulnerable packages. Use before a release or when asked to clean up dependencies.',
    [
      'List direct dependencies and their installed and latest versions.',
      'Run the package manager audit and note any known vulnerabilities.',
      'Search the code for imports to find packages that are no longer used.',
      'Propose upgrades and removals grouped by risk; do not change lockfiles without approval.'
    ]
  ),
  starter(
    'readme-refresh',
    'README refresh',
    'Bring the README up to date with how the project actually works today. Use when setup steps or features have changed.',
    [
      'Read the current README and compare it with the scripts, config and code.',
      'Fix install and run steps so they work on a clean checkout; run them to check.',
      'Update the feature list and remove anything that no longer exists.',
      'Keep the existing tone and structure; show the diff before saving.'
    ]
  )
]

export function starterSkillMarkdown(item: SkillStarter): string {
  return buildSkillMarkdown(item)
}
