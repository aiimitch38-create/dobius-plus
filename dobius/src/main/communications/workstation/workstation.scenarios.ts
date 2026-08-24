/**
 * Scenario fixtures for this feature's 27 RPC methods (21 workstationGit.* +
 * 6 media.* — workstation/rpc-methods.ts), for the verification harness's
 * composable scenario registry. Every step dispatches through the METHOD seam
 * (`via: 'method'`) — the gateway pipeline (trust check + allowlist +
 * dispatcher) is the only seam these method names exist on; the vendored Buzz
 * switch has no case for them. Types/helpers come from '../scenario-contract',
 * never from ../verify/command-scenario (TS6307 under
 * config/tsconfig.node.json — see scenario-contract.ts's doc comment).
 *
 * FIXTURE STRATEGY — everything here is hermetic: git treats a local
 * filesystem path as a valid remote URL, so the remote-ref methods
 * (getRemoteSnapshot/getRemoteDiff/createRemoteBranch/deleteRemoteBranch/
 * mergePullRequest) are exercised FOR REAL against a throwaway bare repo
 * under os.tmpdir() — no network, no GitHub. Fixtures are built lazily inside
 * args builders (the runner invokes them synchronously, one per step, in
 * order) and removed by the LAST step's args builder, which is guaranteed to
 * run because every step executes inside its own try/catch.
 *
 * INTENTIONALLY OMITTED (would fabricate a PASS or bake a harness artifact
 * into the gate):
 * - workstationGit.checkPipelineHotstart — its handler calls
 *   runtime.listMobileSpeechModels(), which the harness's runtime stub does
 *   not implement (stub exposes getRuntimeId only), so it can only ever
 *   ERROR headlessly. A rejection is not this command's by-design behavior,
 *   so expectedError would be dishonest here.
 * - media.pickAndUploadImage / media.pickAndUploadMedia — both open a native
 *   file picker (electron dialog); no headless story exists and the mocked
 *   electron in the harness has no dialog module.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail, isRecord, ok, type ScenarioStep } from '../scenario-contract'

// ---------------------------------------------------------------------
// Temp fixtures (built lazily by args builders, removed by the last step)
// ---------------------------------------------------------------------

type WorkRepoFixture = {
  root: string
  originPath: string
  workReposDir: string
  /** scenario-main's tip at seed time (before the merge step advances it). */
  mainTipSha: string
  /** scenario-main's first commit — the fork point of scenario-pr. */
  rootSha: string
  /** scenario-pr's tip — never moves, so safe as an expectedCommit. */
  prHeadSha: string
}

let listingReposDir: string | null = null
let work: WorkRepoFixture | null = null

function git(cwd: string, args: readonly string[]): void {
  // Inline identity + gpgsign off so commits never depend on (or touch) the
  // machine's global git config.
  execFileSync('git', ['-c', 'user.name=Dobius Scenario', '-c', 'user.email=scenario@invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8'
  })
}

function commitAll(cwd: string, subject: string): string {
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-m', subject])
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
}

/** A one-commit repo plus a plain directory, for listLocalRepositories' filtering. */
function ensureListingFixture(): string {
  if (listingReposDir) {
    return listingReposDir
  }
  const dir = mkdtempSync(join(tmpdir(), 'dobius-ws-listing-'))
  const seeded = join(dir, 'seeded-repo')
  mkdirSync(seeded)
  git(seeded, ['init'])
  writeFileSync(join(seeded, 'listing-file.txt'), 'listed\n')
  commitAll(seeded, 'listing fixture commit')
  mkdirSync(join(dir, 'plain-folder'))
  listingReposDir = dir
  return dir
}

/**
 * A bare "origin" (scenario-main + scenario-pr) and a working clone of it,
 * exercising every local/remote-ref handler over pure filesystem remotes.
 */
function ensureWorkFixture(): WorkRepoFixture {
  if (work) {
    return work
  }
  const root = mkdtempSync(join(tmpdir(), 'dobius-ws-repos-'))
  const originPath = join(root, 'origin.git')
  execFileSync('git', ['-c', 'init.defaultBranch=scenario-main', 'init', '--bare', '--quiet', originPath], {
    cwd: root,
    encoding: 'utf8'
  })
  git(originPath, ['symbolic-ref', 'HEAD', 'refs/heads/scenario-main'])

  const seed = join(root, 'seed')
  git(root, ['clone', '--quiet', originPath, seed])
  writeFileSync(join(seed, 'file-a.txt'), 'alpha\n')
  const rootSha = commitAll(seed, 'scenario commit one')
  writeFileSync(join(seed, 'file-b.txt'), 'beta\n')
  const mainTipSha = commitAll(seed, 'scenario commit two')

  // scenario-pr forks from the first commit and touches a disjoint file, so
  // merging it into scenario-main later is conflict-free by construction.
  git(seed, ['checkout', '--quiet', '-b', 'scenario-pr', rootSha])
  writeFileSync(join(seed, 'pr-file.txt'), 'from pr\n')
  const prHeadSha = commitAll(seed, 'scenario pull request commit')
  git(seed, ['checkout', '--quiet', 'scenario-main'])
  git(seed, ['push', '--quiet', 'origin', 'scenario-main', 'scenario-pr'])

  const workReposDir = join(root, 'work')
  mkdirSync(workReposDir)
  git(workReposDir, ['clone', '--quiet', originPath, 'work-repo'])

  work = { root, originPath, workReposDir, mainTipSha, rootSha, prHeadSha }
  return work
}

function requireWork(): WorkRepoFixture {
  try {
    return ensureWorkFixture()
  } catch (error) {
    throw new Error(`workstation scenario fixture could not be built: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Called from the LAST step's args builder — every earlier fixture use has dispatched by then. */
function removeWorkstationFixtures(): void {
  if (listingReposDir) {
    rmSync(listingReposDir, { recursive: true, force: true })
    listingReposDir = null
  }
  if (work) {
    rmSync(work.root, { recursive: true, force: true })
    work = null
  }
  if (uploadFixtureDir) {
    rmSync(uploadFixtureDir, { recursive: true, force: true })
    uploadFixtureDir = null
    uploadFixtureFile = null
  }
}

// ---------------------------------------------------------------------
// Media fixtures
// ---------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

let uploadFixtureFile: string | null = null
let uploadFixtureDir: string | null = null

/** Small temp PNG (magic-signature header only) for media.upload. */
function ensureUploadFixtureFile(): string {
  if (uploadFixtureFile) {
    return uploadFixtureFile
  }
  const dir = mkdtempSync(join(tmpdir(), 'dobius-ws-media-'))
  const filePath = join(dir, 'upload-fixture.png')
  writeFileSync(filePath, Buffer.from([...PNG_SIGNATURE, 0x00, 0x00]))
  uploadFixtureDir = dir
  uploadFixtureFile = filePath
  return filePath
}

function sha256Hex(bytes: readonly number[]): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function isBlobDescriptor(result: unknown): result is Record<string, unknown> {
  return isRecord(result) && typeof result.url === 'string' && typeof result.sha256 === 'string'
}

// ---------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------

export const SCENARIO_STEPS: ScenarioStep[] = [
  // --- environment probes -------------------------------------------------
  {
    command: 'workstationGit.getIdentity',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) &&
      'name' in r &&
      'email' in r &&
      (r.name === null || typeof r.name === 'string') &&
      (r.email === null || typeof r.email === 'string')
        ? ok()
        : fail(`expected {name: string|null, email: string|null}: ${JSON.stringify(r)}`),
    via: 'method'
  },
  {
    // Windows-only concept: null IS the correct answer everywhere else, so the
    // oracle accepts the platform-appropriate half of the real contract.
    command: 'workstationGit.discoverGitBashPrerequisite',
    args: () => ({}),
    shapeCheck: (r) => {
      if (r === null) {
        return ok()
      }
      return isRecord(r) &&
        typeof r.available === 'boolean' &&
        (r.path === null || typeof r.path === 'string') &&
        r.installInstructionsUrl === 'https://git-scm.com/download/win' &&
        typeof r.installHint === 'string' &&
        r.installHint.length > 0
        ? ok()
        : fail(`unexpected Git Bash prerequisite shape: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    // ftp: is neither http(s) nor ws(s), so the handler short-circuits to null
    // before any fetch — a deterministic, network-free probe of the real
    // URL-scheme gate rather than an unreachable-host timeout.
    command: 'workstationGit.fetchWorkspaceIcon',
    args: () => ({ relayUrl: 'ftp://workspace-icon-scenario.invalid/icon' }),
    shapeCheck: (r) => (r === null ? ok() : fail(`expected null for a non-ws/http relay URL, got ${JSON.stringify(r)}`)),
    via: 'method'
  },

  // --- local clone reads (temp fixture on disk) ---------------------------
  {
    command: 'workstationGit.listLocalRepositories',
    args: () => ({ reposDir: ensureListingFixture() }),
    shapeCheck: (r) => {
      if (!Array.isArray(r) || r.length !== 1) {
        return fail(`expected exactly the one git repo (plain dirs filtered out): ${JSON.stringify(r)}`)
      }
      const entry = r[0]
      return isRecord(entry) && entry.name === 'seeded-repo' && typeof entry.path === 'string' && entry.path.length > 0
        ? ok()
        : fail(`expected the seeded-repo entry: ${JSON.stringify(entry)}`)
    },
    via: 'method'
  },
  {
    command: 'workstationGit.getLocalSnapshot',
    args: () => {
      const f = requireWork()
      return { reposDir: f.workReposDir, projectDtag: 'work-repo' }
    },
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.snapshot)) {
        return fail(`expected { path, snapshot }: ${JSON.stringify(r)}`)
      }
      const snap = r.snapshot
      const commits = Array.isArray(snap.commits) ? snap.commits : []
      const files = Array.isArray(snap.files) ? snap.files : []
      return isRecord(snap.latest_commit) &&
        snap.latest_commit.subject === 'scenario commit two' &&
        commits.length === 2 &&
        files.length === 2 &&
        files.every((f) => isRecord(f) && (f.path === 'file-a.txt' || f.path === 'file-b.txt')) &&
        Array.isArray(snap.contributors) &&
        snap.contributors.length === 1
        ? ok()
        : fail(`unexpected snapshot of the seeded clone: ${JSON.stringify(snap)}`)
    },
    via: 'method'
  },
  {
    command: 'workstationGit.getLocalDiff',
    args: () => {
      const f = requireWork()
      return { reposDir: f.workReposDir, projectDtag: 'work-repo', baseCommit: f.rootSha, targetCommit: f.mainTipSha }
    },
    shapeCheck: (r) => {
      if (!isRecord(r) || !Array.isArray(r.files) || r.files.length !== 1) {
        return fail(`expected a one-file diff between the two seeded commits: ${JSON.stringify(r)}`)
      }
      const file = r.files[0]
      return (
        isRecord(file) &&
        file.path === 'file-b.txt' &&
        file.additions === 1 &&
        file.deletions === 0 &&
        file.truncated === false &&
        typeof file.patch === 'string' &&
        file.patch.startsWith('diff --git') &&
        r.additions === 1 &&
        r.deletions === 0 &&
        // The seeded commit carries a Co-authored-by trailer after the
        // subject; assert the subject prefix structurally, not the full body.
        typeof r.commit_body === 'string' &&
        r.commit_body.startsWith('scenario commit two')
      )
        ? ok()
        : fail(`unexpected diff content: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    command: 'workstationGit.getSyncStatus',
    args: () => {
      const f = requireWork()
      return { reposDir: f.workReposDir, projectDtag: 'work-repo', cloneUrl: f.originPath }
    },
    shapeCheck: (r, _ctx) => {
      const f = requireWork()
      return (
        isRecord(r) &&
        r.local_branch === 'scenario-main' &&
        r.local_head === f.mainTipSha &&
        Array.isArray(r.local_branches) &&
        r.local_branches.includes('scenario-main') &&
        r.remote_branch === 'origin/scenario-main' &&
        r.remote_head === f.mainTipSha &&
        r.merge_base === f.mainTipSha &&
        r.ahead_count === 0 &&
        r.behind_count === 0 &&
        r.has_uncommitted_changes === false &&
        r.can_push === false &&
        r.push_block_reason === 'Nothing to push' &&
        r.can_pull === false &&
        r.pull_block_reason === 'Already up to date'
      )
        ? ok()
        : fail(`expected in-sync status against the local origin: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },

  // --- remote-ref operations (real, against the filesystem-only origin) ---
  {
    // Runs the full merge pipeline: clones origin into the cache dir, verifies
    // expectedCommit against scenario-pr, merges cleanly, pushes back. Signing
    // the merged-status event CANNOT succeed here (no local identity controls
    // otherPubkey), and the handler correctly surfaces that as
    // status_publication_error instead of failing the merge.
    command: 'workstationGit.mergePullRequest',
    args: (ctx) => {
      const f = requireWork()
      return {
        targetCloneUrl: f.originPath,
        sourceCloneUrl: f.originPath,
        targetOwner: ctx.otherPubkey,
        repoAddress: 'scenario/repo-address',
        pullRequestId: 'scenario-pr-1',
        pullRequestAuthor: ctx.otherPubkey,
        statusCreatedAt: 1700000000,
        targetBranch: 'scenario-main',
        sourceBranch: 'scenario-pr',
        expectedCommit: f.prHeadSha
      }
    },
    shapeCheck: (r) =>
      isRecord(r) &&
      r.message === 'Merged scenario-pr into scenario-main' &&
      typeof r.merge_commit === 'string' &&
      /^[0-9a-f]{40}$/.test(r.merge_commit) &&
      r.status_event === '' &&
      typeof r.status_publication_error === 'string' &&
      r.status_publication_error.startsWith('No local identity controls owner ')
        ? ok()
        : fail(`unexpected merge result: ${JSON.stringify(r)}`),
    via: 'method'
  },
  {
    // Post-merge origin: HEAD history now spans both seeded commits, the PR
    // commit and the merge commit — asserted structurally, not by SHA.
    command: 'workstationGit.getRemoteSnapshot',
    args: () => ({ cloneUrl: requireWork().originPath }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !Array.isArray(r.commits) || !Array.isArray(r.files)) {
        return fail(`expected a snapshot object: ${JSON.stringify(r)}`)
      }
      const subjects = r.commits.filter((c) => isRecord(c)).map((c) => (c as Record<string, unknown>).subject)
      return (
        r.commits.length >= 4 &&
        subjects.includes('scenario commit one') &&
        subjects.includes('scenario pull request commit') &&
        isRecord(r.latest_commit) &&
        typeof r.latest_commit.hash === 'string' &&
        r.files.some((f) => isRecord(f) && f.path === 'file-a.txt')
      )
        ? ok()
        : fail(`unexpected remote snapshot: ${JSON.stringify({ latest_commit: r.latest_commit, count: r.commits.length })}`)
    },
    via: 'method'
  },
  {
    // Three-dot diff scenario-pr...scenario-main AFTER mergePullRequest ran:
    // scenario-pr is now an ancestor of scenario-main, so the diff shows
    // exactly what scenario-main gained relative to it — file-b.txt (+1),
    // nothing else.
    command: 'workstationGit.getRemoteDiff',
    args: () => ({ cloneUrl: requireWork().originPath, baseBranch: 'scenario-pr', targetRef: 'scenario-main' }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !Array.isArray(r.files)) {
        return fail(`expected a diff object: ${JSON.stringify(r)}`)
      }
      return (
        r.files.length === 1 &&
        isRecord(r.files[0]) &&
        r.files[0].path === 'file-b.txt' &&
        r.additions === 1 &&
        r.deletions === 0
      )
        ? ok()
        : fail(`unexpected remote diff: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    command: 'workstationGit.createRemoteBranch',
    args: () => {
      const f = requireWork()
      return {
        cloneUrl: f.originPath,
        sourceBranch: 'scenario-pr',
        expectedCommit: f.prHeadSha,
        newBranch: 'scenario-publish-check'
      }
    },
    shapeCheck: (r) => {
      const f = requireWork()
      return (
        isRecord(r) &&
        r.branch === 'scenario-publish-check' &&
        r.commit === f.prHeadSha &&
        r.message === 'Created scenario-publish-check'
      )
        ? ok()
        : fail(`unexpected branch-create result: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    command: 'workstationGit.deleteRemoteBranch',
    args: () => {
      const f = requireWork()
      return { cloneUrl: f.originPath, branch: 'scenario-publish-check', expectedCommit: f.prHeadSha }
    },
    shapeCheck: (r) => {
      const f = requireWork()
      return (
        isRecord(r) &&
        r.branch === 'scenario-publish-check' &&
        r.commit === f.prHeadSha &&
        r.message === 'Deleted scenario-publish-check'
      )
        ? ok()
        : fail(`unexpected branch-delete result: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },

  // --- deliberately-rejecting paths (network/GUI-bound happy paths omitted;
  // each rejection below happens BEFORE any network call or terminal spawn) --
  {
    // Path-traversal dtag must be rejected by the sanitizer before cloning.
    command: 'workstationGit.cloneRepository',
    args: () => ({
      reposDir: requireWork().root,
      projectDtag: '../traversal-scenario',
      cloneUrl: 'https://scenario.invalid/repo.git'
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'Invalid project identifier: "../traversal-scenario"',
    via: 'method'
  },
  {
    command: 'workstationGit.push',
    args: () => ({
      reposDir: requireWork().root,
      projectDtag: 'never-cloned-scenario',
      cloneUrl: 'scenario-unused-origin-placeholder'
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'No local clone to push — clone the repository first',
    via: 'method'
  },
  {
    command: 'workstationGit.pull',
    args: () => ({
      reposDir: requireWork().root,
      projectDtag: 'never-cloned-scenario',
      cloneUrl: 'scenario-unused-origin-placeholder'
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'No local clone to pull — clone the repository first',
    via: 'method'
  },
  {
    // No clone + no cloneUrl rejects before openNativeTerminalAt could ever
    // spawn a GUI terminal.
    command: 'workstationGit.openTerminal',
    args: () => ({ reposDir: requireWork().root, projectDtag: 'terminal-no-clone-scenario' }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'No local clone exists and no cloneUrl was provided to create one',
    via: 'method'
  },
  {
    // Relative reposDir must trip the absolute-path guard before any clone,
    // fetch, merge, or terminal launch.
    command: 'workstationGit.openMergeRecoveryTerminal',
    args: () => ({
      reposDir: 'relative/scenario-repos',
      projectDtag: 'recovery-scenario',
      targetCloneUrl: 'scenario-target-placeholder',
      sourceCloneUrl: 'scenario-source-placeholder',
      targetBranch: 'scenario-main',
      sourceBranch: 'scenario-pr',
      expectedCommit: 'scenario-expected-commit-placeholder'
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'reposDir must be an absolute path',
    via: 'method'
  },
  {
    command: 'workstationGit.signPullRequestReviewRequest',
    args: (ctx) => ({
      targetOwner: ctx.selfPubkey,
      repoAddress: 'scenario/repo-address',
      pullRequestId: 'scenario-pr-1',
      reviewers: [],
      reviewerLabel: 'Scenario Reviewer'
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'At least one reviewer is required',
    via: 'method'
  },
  {
    // otherPubkey is foreign by construction: neither the local human
    // identity nor any managed agent controls it, so signing-as-owner must
    // refuse — and refuse BEFORE anything is published to the relay.
    command: 'workstationGit.signPullRequestStatus',
    args: (ctx) => ({
      targetOwner: ctx.otherPubkey,
      repoAddress: 'scenario/repo-address',
      pullRequestId: 'scenario-pr-1',
      pullRequestAuthor: ctx.selfPubkey,
      status: 'closed',
      createdAt: 1700000000
    }),
    shapeCheck: () => ok(),
    expectedError: (message) =>
      message.startsWith('No local identity controls owner ') && message.endsWith(' — cannot sign on its behalf'),
    via: 'method'
  },
  {
    // A well-formed status event signed by someone OTHER than targetOwner must
    // be refused before publishSignedEvent ever fires.
    command: 'workstationGit.publishPullRequestMergedStatus',
    args: (ctx) => ({
      targetOwner: ctx.selfPubkey,
      statusEvent: JSON.stringify({
        id: 'f'.repeat(64),
        pubkey: ctx.otherPubkey,
        created_at: 1700000000,
        kind: 1631,
        tags: [],
        content: '',
        sig: 'f'.repeat(64)
      })
    }),
    shapeCheck: () => ok(),
    expectedError: (message) => message === 'statusEvent was not signed by targetOwner',
    via: 'method'
  },

  // --- media ---------------------------------------------------------------
  {
    command: 'media.uploadBytes',
    args: () => ({ data: PNG_SIGNATURE, filename: 'dobius-scenario-upload.png' }),
    shapeCheck: (r) => {
      const sha256 = sha256Hex(PNG_SIGNATURE)
      return (
        isBlobDescriptor(r) &&
        r.sha256 === sha256 &&
        r.size === PNG_SIGNATURE.length &&
        r.type === 'image/png' &&
        typeof r.url === 'string' &&
        new RegExp(`^http://127\\.0\\.0\\.1:\\d+/media/${sha256}\\.png$`).test(r.url)
      )
        ? ok()
        : fail(`expected a PNG BlobDescriptor content-addressed by sha256: ${JSON.stringify(r)}`)
    },
    capture: (r, ctx) => {
      if (isBlobDescriptor(r)) {
        ctx.family.workstationMediaUrl = r.url
        ctx.family.workstationMediaBytes = PNG_SIGNATURE
      }
    },
    via: 'method'
  },
  {
    command: 'media.upload',
    args: () => ({ filePath: ensureUploadFixtureFile(), isTemp: false }),
    shapeCheck: (r) => {
      if (!isBlobDescriptor(r)) {
        return fail(`expected a BlobDescriptor: ${JSON.stringify(r)}`)
      }
      const bytes = [...PNG_SIGNATURE, 0x00, 0x00]
      const sha256 = sha256Hex(bytes)
      const { url } = r
      return (
        r.sha256 === sha256 &&
        r.size === bytes.length &&
        r.type === 'image/png' &&
        typeof url === 'string' &&
        new RegExp(`^http://127\\.0\\.0\\.1:\\d+/media/${sha256}\\.png$`).test(url)
      )
        ? ok()
        : fail(`descriptor does not match the temp file's content hash: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    // Round-trips the URL captured above through the real media HTTP server's
    // own byte-read path.
    command: 'media.fetchBytes',
    args: (ctx) => {
      const url = ctx.family.workstationMediaUrl
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('media.fetchBytes fixture expects media.uploadBytes to have captured workstationMediaUrl first')
      }
      return { url }
    },
    shapeCheck: (r, ctx) => {
      const bytes = ctx.family.workstationMediaBytes
      return (
        Array.isArray(r) &&
        Array.isArray(bytes) &&
        r.length === bytes.length &&
        r.every((byte, i) => byte === bytes[i])
      )
        ? ok()
        : fail(`round-tripped bytes differ from the uploaded payload: ${JSON.stringify(r)}`)
    },
    via: 'method'
  },
  {
    command: 'media.getProxyPort',
    args: () => {
      removeWorkstationFixtures()
      return {}
    },
    shapeCheck: (r) =>
      typeof r === 'number' && Number.isInteger(r) && r > 0
        ? ok()
        : fail(`expected a bound TCP port number, got ${JSON.stringify(r)}`),
    via: 'method'
  }
]
