import { execFile } from 'child_process';
import path from 'path';

const EXEC_TIMEOUT = 10_000;
// Per-commit description cap for the Git panel payload (polled every refresh).
const MAX_BODY_CHARS = 4000;
const HASH_RE = /^[a-f0-9]{4,40}$/;

let ghAvailableCache = null;

/**
 * Validate and resolve a project directory path.
 */
function validateDir(dir) {
  if (!dir || typeof dir !== 'string') return null;
  const resolved = path.resolve(dir);
  if (resolved !== path.normalize(dir)) return null;
  return resolved;
}

/**
 * Run a command and return stdout as a string.
 */
function run(cmd, args, cwd, maxBuffer = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: EXEC_TIMEOUT, maxBuffer }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

/**
 * Get git status: branch, ahead/behind, file counts, isRepo flag.
 */
export async function getGitStatus(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return { isRepo: false };
  try {
    const [branchOut, statusOut, aheadBehindOut, gitDirOut, commonDirOut, remotesOut, hasCommitsOut] = await Promise.all([
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir),
      run('git', ['status', '--porcelain'], dir),
      run('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], dir).catch(() => ''),
      run('git', ['rev-parse', '--git-dir'], dir).catch(() => ''),
      run('git', ['rev-parse', '--git-common-dir'], dir).catch(() => ''),
      run('git', ['remote'], dir).catch(() => ''),
      // Virgin-repo guard: a freshly-`git init`'d repo with no commits also
      // makes `rev-parse --abbrev-ref HEAD` return the literal "HEAD" in some
      // Git versions — same as detached HEAD. Probing for an actual commit
      // disambiguates the two.
      run('git', ['rev-parse', '--verify', 'HEAD'], dir).catch(() => ''),
    ]);

    const lines = statusOut.trim().split('\n').filter(Boolean);
    let staged = 0, modified = 0, untracked = 0;
    for (const line of lines) {
      const x = line[0], y = line[1];
      if (x === '?' && y === '?') { untracked++; continue; }
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') modified++;
    }

    // Worktree detection: a linked worktree's --git-dir is .git/worktrees/<name>
    // inside the main repo, while --git-common-dir always resolves to the main
    // .git. When the two differ, we're inside a linked worktree.
    const gitDir = gitDirOut.trim();
    const commonDir = commonDirOut.trim();
    const isWorktree = !!(gitDir && commonDir && gitDir !== commonDir);

    // Detached HEAD: `git rev-parse --abbrev-ref HEAD` returns the literal
    // "HEAD" when not on a branch. But the same string comes back for a
    // virgin repo (no commits yet), so gate on a successful HEAD resolve.
    const rawBranch = branchOut.trim();
    const hasCommits = hasCommitsOut.trim().length > 0;
    const detached = rawBranch === 'HEAD' && hasCommits;
    const emptyRepo = rawBranch === 'HEAD' && !hasCommits;

    // ahead/behind only have meaning when (a) we resolved a count AND (b) we're
    // on a tracking branch. On detached HEAD or no-upstream there's no
    // comparison to make — surface null so the UI shows "—" rather than a
    // misleading "0 / 0 in sync" for a detached checkout that's miles off.
    let ahead = null, behind = null;
    if (!detached && !emptyRepo && aheadBehindOut.trim()) {
      const [a, b] = aheadBehindOut.trim().split(/\s+/).map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) { ahead = a; behind = b; }
    }

    // Fork detection: the canonical GitHub fork setup keeps your fork as `origin`
    // and the original repo as a separate `upstream` remote. When both exist we
    // treat the checkout as a fork so the top bar can label it distinctly from a
    // plain branch. (Offline/fast — no network or `gh` dependency.)
    const remotes = remotesOut.split('\n').map((r) => r.trim()).filter(Boolean);
    const isFork = remotes.includes('origin') && remotes.includes('upstream');

    return {
      isRepo: true,
      // Give detached / empty-repo a human-readable branch label so existing
      // consumers (GitSidePanel, GitStatusBar) that render status.branch
      // directly don't show a blank field. The detached/emptyRepo flags
      // remain available for callers that want to style the label specially.
      branch: detached ? 'detached' : (emptyRepo ? 'no commits' : rawBranch),
      detached,
      emptyRepo,
      ahead,
      behind,
      staged,
      modified,
      untracked,
      isWorktree,
      isFork,
    };
  } catch {
    return { isRepo: false };
  }
}

/**
 * Get commit log with hash, author, date, subject, and BODY.
 *
 * The body (%b) is the full commit description. It was never fetched, so the
 * Git panel had nothing to show beyond a truncated one-line subject and no
 * amount of UI work could reveal more (Sam: "why can't I click the things in
 * the git side panel and read the full description").
 *
 * A body is multi-line, so a line-per-commit parse no longer works: records
 * need an explicit delimiter. Text markers are NOT safe here, because a body
 * is arbitrary user text that can contain them (a commit describing this very
 * parser would) and that forged a phantom commit, caught by commit-log.test.
 * git's %x00 / %x1f expand to bytes a commit message cannot contain, so the
 * framing is unforgeable.
 *
 * This does NOT violate the null-byte rule in CLAUDE.md: the argument passed
 * to execFile is the four ASCII characters "%x00", not a NUL byte. git expands
 * it in its own OUTPUT, which is only ever parsed, never passed back as an arg.
 */
export async function getCommitLog(projectDir, count = 50) {
  const dir = validateDir(projectDir);
  if (!dir) return [];
  try {
    const n = Math.min(count, 200);
    // NUL is the ONLY framing byte, and every field is NUL-TERMINATED, so a
    // record is just "the next 5 fields". A commit message can legitimately
    // contain \x1f (Codex round 2: a subject with one shifted the body into
    // the wrong field), but it can never contain a NUL, so this framing cannot
    // be forged by any commit content.
    const FIELDS = 5;
    const withBody = ['%H', '%an', '%aI', '%s', '%b'].map((f) => `${f}%x00`).join('');
    // Bodies are unbounded user text, so the 1MB default could now be blown by
    // a single pathological commit and the catch below would blank the whole
    // panel (Codex, Medium). Give the body query room, and if it still fails,
    // fall back to the subject-only query rather than returning nothing: a
    // list without descriptions beats an empty Recent commits section.
    let stdout;
    let fields = FIELDS;
    try {
      stdout = await run('git', ['log', `--max-count=${n}`, `--format=${withBody}`], dir, 16 * 1024 * 1024);
    } catch {
      const subjectOnly = ['%H', '%an', '%aI', '%s'].map((f) => `${f}%x00`).join('');
      stdout = await run('git', ['log', `--max-count=${n}`, `--format=${subjectOnly}`], dir);
      fields = 4;
    }
    // Every field is NUL-terminated, so the trailing split fragment (git's
    // newline between records) is discarded by the group loop below.
    const parts = stdout.split('\0');
    const out = [];
    for (let i = 0; i + fields <= parts.length; i += fields) {
      // git separates records with a newline, which lands at the head of the
      // next record's first field.
      const hash = (parts[i] || '').trim();
      const author = parts[i + 1];
      const date = parts[i + 2];
      const subject = (parts[i + 3] || '').trim();
      // Trailing whitespace only: git always appends a newline to %b, and the
      // panel would render it as dead space. LEADING whitespace is preserved,
      // because a `--cleanup=verbatim` body can indent its first line
      // meaningfully and trimming it silently rewrote the message (Codex Low).
      let body = fields === FIELDS ? (parts[i + 4] || '').replace(/\s+$/, '') : '';
      // Cap what crosses the IPC boundary on every poll. A commit description
      // longer than this is not something the 224px panel can usefully show,
      // and the full text is always available via `git show`.
      if (body.length > MAX_BODY_CHARS) {
        body = `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated, run git show ${hash.slice(0, 7)} for the rest]`;
      }
      if (!HASH_RE.test(hash)) continue; // never emit a half-parsed record
      out.push({ hash, author, date, subject, body });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Get local + remote branches with current indicator.
 */
export async function getBranches(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return { current: '', local: [], remote: [] };
  try {
    const stdout = await run('git', ['branch', '-a', '--no-color'], dir);
    const local = [], remote = [];
    let current = '';
    for (const raw of stdout.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('* ')) {
        current = line.slice(2);
        local.push(current);
      } else if (line.startsWith('remotes/')) {
        if (!line.includes('HEAD ->')) remote.push(line.replace('remotes/', ''));
      } else {
        local.push(line);
      }
    }
    return { current, local, remote };
  } catch {
    return { current: '', local: [], remote: [] };
  }
}

/**
 * Get unified diff for a specific commit hash.
 */
export async function getCommitDiff(projectDir, hash) {
  const dir = validateDir(projectDir);
  if (!dir || !HASH_RE.test(hash)) return '';
  try {
    const stdout = await run('git', ['show', '--format=', '--stat', '--patch', hash], dir);
    // Truncate large diffs at 50K chars
    return stdout.length > 50_000 ? stdout.slice(0, 50_000) + '\n\n[diff truncated at 50K chars]' : stdout;
  } catch {
    return '';
  }
}

/**
 * Check if gh CLI is available (cached).
 */
export async function checkGhAvailable() {
  if (ghAvailableCache !== null) return ghAvailableCache;
  try {
    await run('which', ['gh'], '/');
    ghAvailableCache = true;
  } catch {
    ghAvailableCache = false;
  }
  return ghAvailableCache;
}

/**
 * Get open pull requests via gh CLI.
 */
export async function getPullRequests(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return [];
  try {
    const stdout = await run('gh', [
      'pr', 'list', '--json', 'number,title,state,author,createdAt,headRefName,statusCheckRollup,reviewRequests,url',
      '--limit', '20',
    ], dir);
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

/**
 * Get open issues via gh CLI.
 */
export async function getIssues(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return [];
  try {
    const stdout = await run('gh', [
      'issue', 'list', '--json', 'number,title,state,author,createdAt,labels,assignees,url',
      '--limit', '30',
    ], dir);
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

// Per-PR / per-issue detail fetch (getPrDetails / getIssueDetails) was removed
// in v1.0.47: the detail UI was never wired, so the handlers were dead. The
// Git tab's PR/Issue rows now open on GitHub directly (shell.openExternal).

// ---------------------------------------------------------------------------
// Git tree panel (v1.0.52): commit graph, GitHub remote resolution, branch ops.
// ---------------------------------------------------------------------------

// Strict-enough branch name gate: git's own rules are looser, but every name a
// human actually creates passes this, and it excludes option injection (leading
// '-'), traversal ('..'), refs tricks ('.lock', '@{', trailing '/').
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
export function isSafeBranchName(name) {
  return typeof name === 'string'
    && BRANCH_RE.test(name)
    && !name.includes('..')
    && !name.includes('@{')
    && !name.endsWith('/')
    && !name.endsWith('.lock');
}

/**
 * Parse a git remote URL into a GitHub web base URL. Handles:
 *   https://github.com/owner/repo(.git)
 *   git@github.com:owner/repo(.git)
 *   ssh://git@github.com/owner/repo(.git)
 * Returns { owner, repo, githubUrl } or null for non-GitHub remotes.
 * Exported for unit tests (pure).
 */
export function parseGithubRemote(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/
  );
  if (!m) return null;
  const [, owner, repo] = m;
  return { owner, repo, githubUrl: `https://github.com/${owner}/${repo}` };
}

/**
 * The project's origin remote, resolved to GitHub web links when applicable.
 * Falls back to the FIRST remote when origin is absent.
 */
export async function getRemoteInfo(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return { remoteUrl: '', github: null };
  let remoteUrl = '';
  try {
    remoteUrl = (await run('git', ['remote', 'get-url', 'origin'], dir)).trim();
  } catch {
    try {
      const names = (await run('git', ['remote'], dir)).trim().split('\n').filter(Boolean);
      if (names[0]) remoteUrl = (await run('git', ['remote', 'get-url', names[0]], dir)).trim();
    } catch { /* no remotes at all */ }
  }
  return { remoteUrl, github: parseGithubRemote(remoteUrl) };
}

/**
 * Structured commit graph data for the tree panel: every ref reachable
 * commit (capped), with parent hashes and decorations, topo-ordered so the
 * renderer's lane assignment works row by row.
 */
export async function getCommitGraph(projectDir, count = 150) {
  const dir = validateDir(projectDir);
  if (!dir) return { commits: [], head: '' };
  try {
    // NUL-terminated fields, same unforgeable framing as getCommitLog: text
    // markers were breakable by a commit body containing them, and %b is
    // multi-line so a line-per-commit parse cannot work either.
    const GRAPH_FIELDS = 7;
    const base = ['%H', '%P', '%D', '%an', '%ct', '%s'];
    const format = [...base, '%b'].map((f) => `${f}%x00`).join('');
    const max = Math.min(Math.max(count, 1), 400);
    const logArgs = (fmt) => ['log', '--all', '--topo-order', `--max-count=${max}`, `--format=${fmt}`];
    const headOut = await run('git', ['rev-parse', 'HEAD'], dir).catch(() => '');
    // Same subject-only fallback as getCommitLog: without it a single
    // pathological body blanks the whole Git Tree instead of merely dropping
    // the descriptions (Codex round 5, Medium: the two functions had drifted).
    let stdout;
    let fields = GRAPH_FIELDS;
    try {
      stdout = await run('git', logArgs(format), dir, 16 * 1024 * 1024);
    } catch {
      stdout = await run('git', logArgs(base.map((f) => `${f}%x00`).join('')), dir);
      fields = base.length;
    }
    const parts = stdout.split('\0');
    const commits = [];
    for (let i = 0; i + fields <= parts.length; i += fields) {
      const hash = (parts[i] || '').trim();
      if (!HASH_RE.test(hash)) continue;
      const parents = parts[i + 1];
      const refs = parts[i + 2];
      let body = fields === GRAPH_FIELDS ? (parts[i + 6] || '').replace(/\s+$/, '') : '';
      if (body.length > MAX_BODY_CHARS) {
        body = `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated, run git show ${hash.slice(0, 7)} for the rest]`;
      }
      commits.push({
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        // "HEAD -> main, origin/main, tag: v1.0.51" -> trimmed ref names
        // git separates %D entries with ", " exactly. Splitting on a bare
        // comma broke branch names that legitimately contain one (Codex:
        // "feat/a,b" became two badges linking to two wrong refs).
        refs: refs ? refs.split(', ').map((r) => r.trim()).filter(Boolean) : [],
        author: parts[i + 3],
        time: Number(parts[i + 4]) * 1000 || 0,
        subject: (parts[i + 5] || '').trim(),
        body,
      });
    }
    return { commits, head: headOut.trim() };
  } catch {
    return { commits: [], head: '' };
  }
}

/** Checkout an existing branch. Returns { ok, error? } with git's own message. */
export async function checkoutBranch(projectDir, branch) {
  const dir = validateDir(projectDir);
  if (!dir || !isSafeBranchName(branch)) return { ok: false, error: 'Invalid branch name' };
  try {
    await run('git', ['checkout', branch], dir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message || 'checkout failed').slice(0, 400) };
  }
}

/** Create + switch to a new branch from HEAD. */
export async function createBranch(projectDir, branch) {
  const dir = validateDir(projectDir);
  if (!dir || !isSafeBranchName(branch)) return { ok: false, error: 'Invalid branch name' };
  try {
    await run('git', ['checkout', '-b', branch], dir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message || 'create failed').slice(0, 400) };
  }
}

/** Fetch all remotes (30s timeout: network-bound, unlike the local ops). */
export async function gitFetch(projectDir) {
  const dir = validateDir(projectDir);
  if (!dir) return { ok: false, error: 'Invalid project dir' };
  return new Promise((resolve) => {
    execFile('git', ['fetch', '--all', '--prune'], { cwd: dir, timeout: 30_000, maxBuffer: 1024 * 1024 }, (err) => {
      resolve(err ? { ok: false, error: String(err.stderr || err.message || 'fetch failed').slice(0, 400) } : { ok: true });
    });
  });
}
