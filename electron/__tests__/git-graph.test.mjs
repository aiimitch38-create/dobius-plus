// Lane assignment (git tree panel) + GitHub remote parsing + branch name gate.
// Run: node ./electron/__tests__/git-graph.test.mjs
import { assignLanes } from '../../src/lib/git-graph.js';
import { parseGithubRemote, isSafeBranchName } from '../git-service.js';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// --- assignLanes ---

// 1. Linear history stays in lane 0.
const linear = assignLanes([
  { hash: 'c', parents: ['b'] },
  { hash: 'b', parents: ['a'] },
  { hash: 'a', parents: [] },
]);
check('linear: all lane 0', linear.rows.map((r) => r.lane), [0, 0, 0]);
check('linear: laneCount 1', linear.laneCount, 1);
check('linear: root has no outgoing edge', linear.rows[2].edges.length, 0);

// 2. Merge commit fans out to two lanes, both converge on the shared base.
//   m (merge of b1 into a1) -> parents a1, b1; a1 -> base; b1 -> base; base
const merged = assignLanes([
  { hash: 'm', parents: ['a1', 'b1'] },
  { hash: 'a1', parents: ['base'] },
  { hash: 'b1', parents: ['base'] },
  { hash: 'base', parents: [] },
]);
check('merge: dot lanes', merged.rows.map((r) => r.lane), [0, 0, 1, 0]);
check('merge: fan-out edges at merge row', merged.rows[0].edges, [
  { from: 0, to: 0, kind: 'track' },
  { from: 0, to: 1, kind: 'branch' },
]);
// b1's segment (lane 1) must CURVE into base's dot (lane 0) at the last row.
check('merge: converging edge bends into dot', merged.rows[2].edges, [
  { from: 0, to: 0, kind: 'track' },
  { from: 1, to: 0, kind: 'track' },
]);
check('merge: laneCount 2', merged.laneCount, 2);

// 3. A second branch TIP (git log --all): new head gets its own lane, no
//    incoming edge, then both tips share the root.
const twoTips = assignLanes([
  { hash: 'tip2', parents: ['root'] },
  { hash: 'tip1', parents: ['root'] },
  { hash: 'root', parents: [] },
]);
check('two tips: lanes', twoTips.rows.map((r) => r.lane), [0, 1, 0]);
check('two tips: tip1 edge bends into root', twoTips.rows[1].edges, [
  { from: 0, to: 0, kind: 'track' },
  { from: 1, to: 0, kind: 'track' },
]);

// 4. Empty input.
check('empty input', assignLanes([]), { rows: [], laneCount: 1 });

// --- parseGithubRemote ---
check('https form', parseGithubRemote('https://github.com/statusdigitalmarketing/dobius-plus.git'),
  { owner: 'statusdigitalmarketing', repo: 'dobius-plus', githubUrl: 'https://github.com/statusdigitalmarketing/dobius-plus' });
check('ssh scp form', parseGithubRemote('git@github.com:owner/repo.git')?.githubUrl, 'https://github.com/owner/repo');
check('ssh url form', parseGithubRemote('ssh://git@github.com/owner/repo')?.githubUrl, 'https://github.com/owner/repo');
check('no .git suffix', parseGithubRemote('https://github.com/o/r')?.githubUrl, 'https://github.com/o/r');
check('trailing slash', parseGithubRemote('https://github.com/o/r/')?.githubUrl, 'https://github.com/o/r');
check('gitlab -> null', parseGithubRemote('https://gitlab.com/o/r.git'), null);
check('garbage -> null', parseGithubRemote('not a url'), null);
check('empty -> null', parseGithubRemote(''), null);
check('dot names', parseGithubRemote('git@github.com:my.org/my.repo.git')?.repo, 'my.repo');

// --- isSafeBranchName ---
check('normal branch ok', isSafeBranchName('feat/files-gittree-panels'), true);
check('release branch ok', isSafeBranchName('release-1.0'), true);
check('leading dash rejected', isSafeBranchName('-D'), false);
check('dotdot rejected', isSafeBranchName('a..b'), false);
check('at-brace rejected', isSafeBranchName('a@{1}'), false);
check('lock suffix rejected', isSafeBranchName('main.lock'), false);
check('space rejected', isSafeBranchName('my branch'), false);
check('empty rejected', isSafeBranchName(''), false);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
