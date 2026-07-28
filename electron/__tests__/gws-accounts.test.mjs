// gws multi-account storage + security layer (v1.0.41). The token MINT needs
// live Google HTTP and is proven when Sam clicks Connect in the app; this
// covers everything else: the registry CRUD, id validation, path derivation
// (Codex plan #3 path-traversal), and email resolution.
//
// Isolate HOME so config (userData via the electron stub) and ~/.gws-profiles
// both land in throwaway dirs, same trick as the other suites.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-gws-home-'));
process.env.HOME = TMP_HOME;
process.env.DOBIUS_TEST_USERDATA = path.join(TMP_HOME, 'userdata');

const cfg = await import('../config-manager.js');
const gws = await import('../gws-accounts.js');

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
};

// --- id validation ---
check('valid id accepted', cfg.isValidGwsId('gws-abcDEF012345_-xyz'), true);
check('empty rejected', cfg.isValidGwsId(''), false);
check('too short rejected', cfg.isValidGwsId('gws-abc'), false);
check('wrong prefix rejected', cfg.isValidGwsId('acct-abcdef0123456789'), false);

// --- path derivation / traversal (Codex plan #3) ---
const goodId = 'gws-abcdefghijklmnop01';
const p = gws.profilePathFor(goodId);
check('good id derives a path inside ~/.gws-profiles',
  p && p.startsWith(path.join(TMP_HOME, '.gws-profiles')) && p.endsWith(`${goodId}.json`), true);
for (const bad of ['gws-../../etc/passwd', 'gws-a/b', 'gws-a.b', '../x', 'gws-', 'gws-short', '']) {
  check(`traversal/bad id rejected: ${JSON.stringify(bad)}`, gws.profilePathFor(bad), null);
}

// --- registry CRUD (metadata only, never secrets) ---
check('registry starts empty', gws.listGwsAccounts(), []);
cfg.saveGwsAccount({ id: goodId, email: 'sam@example.com', name: 'sam@example.com', scopes: ['a', 'b'], addedAt: 1 });
const listed = gws.listGwsAccounts();
check('one account listed with metadata', listed.length === 1 && listed[0].email === 'sam@example.com' && listed[0].scopes.length === 2, true);
check('saveGwsAccount rejects a bad id', cfg.saveGwsAccount({ id: 'nope', email: 'x@y.com' }), null);
check('saveGwsAccount rejects missing email', cfg.saveGwsAccount({ id: 'gws-anothergoodid12345' }), null);

// --- email resolution ---
check('idForEmail resolves (case-insensitive)', gws.idForEmail('SAM@example.com'), goodId);
check('idForEmail unknown -> null', gws.idForEmail('nobody@example.com'), null);

// --- remove deletes the profile file + registry entry ---
await fs.mkdir(path.join(TMP_HOME, '.gws-profiles'), { recursive: true });
await fs.writeFile(p, JSON.stringify({ email: 'sam@example.com', refresh_token: 'x' }), { mode: 0o600 });
let existed = true;
try { await fs.stat(p); } catch { existed = false; }
check('profile file exists before remove', existed, true);
await gws.removeGwsAccount(goodId);
let gone = false;
try { await fs.stat(p); } catch { gone = true; }
check('profile file deleted after remove', gone, true);
check('registry empty after remove', gws.listGwsAccounts(), []);

// --- no-follow write (Codex r2 P2): a symlink at the profile path must NOT be
// followed; the pointed-at file must stay untouched. ---
{
  const profDir = path.join(TMP_HOME, '.gws-profiles');
  await fs.mkdir(profDir, { recursive: true, mode: 0o700 });
  const victim = path.join(TMP_HOME, 'victim.txt');
  await fs.writeFile(victim, 'DO NOT OVERWRITE');
  const symId = 'gws-symlinkattack01234';
  const symPath = gws.profilePathFor(symId);
  await fs.symlink(victim, symPath); // attacker points the profile at victim
  let threw = false;
  try {
    await gws.writeProfile(symId, { email: 'x@y.com', refresh_token: 'secret-should-not-land' });
  } catch {
    threw = true;
  }
  check('writeProfile refuses to follow a symlink', threw, true);
  const victimContent = await fs.readFile(victim, 'utf8');
  check('the symlink target is left untouched (no token written to it)', victimContent, 'DO NOT OVERWRITE');
}

await fs.rm(TMP_HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
