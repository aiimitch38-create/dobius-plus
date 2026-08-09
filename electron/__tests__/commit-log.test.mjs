// Commit log parsing with BODIES. The Git side panel could only ever show a
// truncated one-line subject because getCommitLog fetched %s and nothing else
// (Sam: "why can't I click the things in the git side panel and read the full
// description"). Bodies are multi-line, so the old line-per-commit parse had
// to become record-delimited, which is exactly where a parser breaks.
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/commit-log.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-cltest-'));
process.env.DOBIUS_TEST_USERDATA = userData;

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-clrepo-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test Person');

const commit = (msg) => {
  fs.writeFileSync(path.join(repo, 'f.txt'), String(Math.random()));
  git('add', '-A');
  git('commit', '-q', '-m', msg);
};

commit('plain subject only');
commit('subject with body\n\nFirst body line.\nSecond body line.\n\nA third paragraph.');
// A body that contains the parser's OWN markers must not corrupt the record.
commit('marker torture\n\nbody has ||SEP|| inside\nand even ||REC|| here\ndone.');
// Subjects can contain the separator too.
commit('subject with ||SEP|| inside it');

const { getCommitLog } = await import('../git-service.js');
let pass = 0;
const ok = (n) => { console.log(`PASS  ${n}`); pass += 1; };

const log = await getCommitLog(repo, 20);
const bySubject = (s) => log.find((c) => c.subject.startsWith(s));

// 1. All four commits parse, newest first, with valid hashes.
assert.equal(log.length, 4);
assert.ok(log.every((c) => /^[0-9a-f]{40}$/.test(c.hash)), 'every hash is a full sha');
assert.ok(log.every((c) => c.author === 'Test Person'), 'author parsed');
ok('all commits parse with valid hash + author');

// 2. A subject-only commit has an empty body (not undefined, not the subject).
assert.equal(bySubject('plain subject only').body, '');
ok('subject-only commit has an empty body');

// 3. The multi-line body survives intact, paragraphs and all.
const withBody = bySubject('subject with body');
assert.equal(withBody.subject, 'subject with body');
assert.equal(withBody.body, 'First body line.\nSecond body line.\n\nA third paragraph.');
ok('multi-line body preserved verbatim');

// 4. Markers INSIDE a body do not split the record or leak into other fields.
const torture = bySubject('marker torture');
assert.equal(torture.subject, 'marker torture');
assert.ok(torture.body.includes('||SEP||'), 'SEP marker survives inside the body');
assert.ok(torture.body.includes('||REC||'), 'REC marker survives inside the body');
assert.equal(log.length, 4, 'a marker in a body did not create a phantom commit');
ok('separator markers inside a body do not corrupt parsing');

// 5. A separator in the SUBJECT keeps the rest of the fields aligned.
const sepSubject = log.find((c) => c.subject.includes('||SEP||'));
assert.ok(sepSubject, 'commit with a separator in its subject is present');
assert.ok(/^[0-9a-f]{40}$/.test(sepSubject.hash), 'hash still clean');
assert.equal(sepSubject.author, 'Test Person');
ok('separator in a subject keeps fields aligned');


// 6. A UNIT SEPARATOR (\x1f) inside a subject must not shift fields (Codex
// round 2): commit messages can legitimately contain it, so it cannot be used
// as framing. NUL is the only byte a commit message can never hold.
commit('subject\x1fwith unit sep\n\nbody stays put');
const usLog = await getCommitLog(repo, 20);
const us = usLog.find((c) => c.subject.includes('with unit sep'));
assert.ok(us, 'commit with \\x1f in its subject is present');
assert.ok(/^[0-9a-f]{40}$/.test(us.hash), 'hash clean');
assert.equal(us.author, 'Test Person', 'author not shifted');
assert.equal(us.body, 'body stays put', 'body not polluted by the subject');
ok('unit separator in a subject does not shift fields');

// 7. A pathological body must not blank the whole list (Codex, Medium): the
// body query gets a bigger buffer, the payload is capped per commit, and a
// still-failing query falls back to subject-only rather than returning [].
// -F, not -m: a 1.2MB message exceeds the argv size limit (E2BIG), which is
// a limit of the TEST harness, not of the code under test.
const msgFile = path.join(os.tmpdir(), 'dobius-huge-msg.txt');
fs.writeFileSync(msgFile, `huge body\n\n${'x'.repeat(1_200_000)}`);
fs.writeFileSync(path.join(repo, 'f.txt'), 'huge');
git('add', '-A');
git('commit', '-q', '-F', msgFile);
fs.rmSync(msgFile, { force: true });
const big = await getCommitLog(repo, 20);
assert.equal(big.length, 6, 'the huge commit did not blank the list');
const huge = big.find((c) => c.subject === 'huge body');
assert.ok(huge, 'huge commit present');
assert.ok(huge.body.length < 5000, `body capped, got ${huge.body.length}`);
assert.ok(huge.body.includes('truncated'), 'truncation is disclosed, not silent');
// The other commits still parse correctly alongside it.
assert.equal(big.find((c) => c.subject === 'subject with body').body,
  'First body line.\nSecond body line.\n\nA third paragraph.');
ok('a pathological body is capped without breaking the list');


// 8. Leading indentation in a verbatim body is preserved; only the trailing
// newline git appends is trimmed (Codex round 3, Low).
const vfile = path.join(os.tmpdir(), 'dobius-verbatim-msg.txt');
fs.writeFileSync(vfile, 'verbatim body\n\n    indented first line\nsecond   \n\n');
fs.writeFileSync(path.join(repo, 'f.txt'), 'verbatim');
git('add', '-A');
git('commit', '-q', '--cleanup=verbatim', '-F', vfile);
fs.rmSync(vfile, { force: true });
const vb = (await getCommitLog(repo, 20)).find((c) => c.subject === 'verbatim body');
assert.ok(vb, 'verbatim commit present');
assert.ok(vb.body.startsWith('    indented first line'), `leading indent kept, got ${JSON.stringify(vb.body.slice(0, 30))}`);
assert.ok(!/\s$/.test(vb.body), 'trailing whitespace trimmed');
ok('verbatim body keeps leading indent, drops trailing padding');

// 9. Non-repo and bad input degrade to an empty list, never a throw.
assert.deepEqual(await getCommitLog(os.tmpdir(), 5), []);
assert.deepEqual(await getCommitLog('', 5), []);
assert.deepEqual(await getCommitLog(null, 5), []);
ok('non-repo and invalid input return an empty list');

fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(repo, { recursive: true, force: true });
console.log(`commit-log: ${pass} groups pass`);
