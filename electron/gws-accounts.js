// Google Workspace (gws) multi-account foundation (v1.0.41).
//
// Lets Dobius connect several Google accounts and run the `gws` CLI (or, later,
// Google API calls) AS a chosen account, selected by email. Chrome is not
// involved here: this is the CLI/API side. The Chrome-profile launcher
// (chrome-profiles.js) is the browser equivalent.
//
// Model (see GWS-MULTI-ACCOUNT-PLAN.md, Codex-reviewed):
//  - Connect snapshots an account's refresh token via `gws auth export` into a
//    0600 file under ~/.gws-profiles/<id>.json (dir 0700). config holds only
//    metadata (id, email, name, scopes), never the token.
//  - A short-lived access token is minted on demand from the refresh token
//    (OAuth refresh grant) and cached in memory until it expires. Tokens NEVER
//    cross to the renderer; only purpose-specific main-side callers use them.
//
// PHASE-0 CAVEAT: the exact OAuth client that mints from gws's refresh token
// could not be proven from the build environment (no outbound HTTP there). The
// connect flow proves it live on first run and stores the working client; if
// neither candidate client works it fails loudly with a redacted error.

import fs from 'fs/promises';
import fsSync, { constants as FS } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { getGwsAccounts, saveGwsAccount, deleteGwsAccount, isValidGwsId } from './config-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROFILES_DIR = path.join(os.homedir(), '.gws-profiles');
const GWS_CLIENT_SECRET = path.join(os.homedir(), '.config', 'gws', 'client_secret.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// gws is typically a Homebrew binary; Electron's PATH is minimal, so augment it.
const EXEC_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const EXEC_ENV = { ...process.env, PATH: `${EXEC_PATH}:${process.env.PATH || ''}` };

// In-memory access-token cache: id -> { token, expiresAt }. Never persisted.
const tokenCache = new Map();

function ensureProfilesDir() {
  // The dir that holds refresh tokens must be a REAL directory we own, not a
  // symlink: O_NOFOLLOW only guards the leaf <id>.json, so a symlinked
  // ~/.gws-profiles would still land tokens in the link's target (possibly a
  // less-protected or attacker-controlled dir). lstat (no-follow) and refuse if
  // it is a symlink or not a directory. Codex v1.0.41 r3 P2.
  let st = null;
  try {
    st = fsSync.lstatSync(PROFILES_DIR);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (st) {
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error('profiles_dir_unsafe');
    }
    try { fsSync.chmodSync(PROFILES_DIR, 0o700); } catch { /* best effort */ }
    return;
  }
  // 0700: only the user can enter the dir that holds refresh tokens.
  fsSync.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  try { fsSync.chmodSync(PROFILES_DIR, 0o700); } catch { /* best effort */ }
}

// Derive the profile path FROM the id on every use; never store or trust a
// path from config. The id shape (gws-<alnum>) cannot contain a path
// separator or dots, so the join stays inside PROFILES_DIR. Codex plan #3.
// Exported for tests; returns null for any id that is not shape-valid.
export function profilePathFor(id) {
  if (!isValidGwsId(id)) return null;
  const p = path.join(PROFILES_DIR, `${id}.json`);
  // Belt-and-suspenders: the resolved path must still sit directly inside
  // PROFILES_DIR. isValidGwsId already forbids separators/dots, so this can
  // only ever pass, but it makes the containment explicit and future-proof.
  if (path.dirname(p) !== PROFILES_DIR) return null;
  return p;
}

function newGwsId() {
  // Opaque, main-generated. base64url avoids path-hostile chars.
  return `gws-${randomBytes(18).toString('base64url')}`;
}

// Delete the shim's on-disk token cache for an account. Called on reconnect
// (creds/scopes may have changed, so an old cached bearer token must not be
// reused for up to an hour) and on removal. Codex v1.0.41 holistic P2.
export async function clearShimTokenCache(id) {
  if (!isValidGwsId(id)) return;
  try { await fs.unlink(path.join(PROFILES_DIR, `.token-${id}.json`)); } catch { /* none */ }
}

// Read a profile file safely: open with O_NOFOLLOW so the final component is
// never followed through a symlink, verify the OPEN fd is a regular file
// (fstat, closes the lstat/read TOCTOU window), then parse. Returns creds or
// null. Codex v1.0.41 r2 P2.
async function readProfile(id) {
  const p = profilePathFor(id);
  if (!p) return null;
  let fh;
  try {
    fh = await fs.open(p, FS.O_RDONLY | FS.O_NOFOLLOW);
  } catch {
    return null; // ELOOP (symlink) / ENOENT / etc.
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return null;
    const raw = await fh.readFile('utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j.refresh_token !== 'string') return null;
    return j;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

// Write a profile with no-follow, exclusive-of-symlinks semantics so a stale or
// malicious symlink at the target can NEVER redirect the refresh-token write
// onto another file (which we would then chmod). O_NOFOLLOW fails with ELOOP if
// the final component is a symlink; O_CREAT|O_TRUNC creates or replaces our own
// regular file. We fstat the opened fd before writing and fchmod it (not the
// path) so perms are set on the actual file. Exported for the no-follow test.
// Codex v1.0.41 r2 P2.
export async function writeProfile(id, creds) {
  ensureProfilesDir();
  const p = profilePathFor(id);
  if (!p) throw new Error('bad_id');
  const flags = FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | FS.O_NOFOLLOW;
  let fh;
  try {
    fh = await fs.open(p, flags, 0o600);
  } catch {
    // ELOOP means the path is a symlink: refuse rather than follow it.
    throw new Error('profile_open_refused');
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error('profile_not_regular_file');
    await fh.chmod(0o600);
    await fh.writeFile(JSON.stringify(creds));
  } finally {
    await fh.close();
  }
}

// Run `gws auth export` for the CURRENTLY logged-in gws account. Read-only.
// Returns { client_id, client_secret, refresh_token } or null.
function gwsAuthExport() {
  return new Promise((resolve) => {
    // --unmasked is REQUIRED: without it current gws masks the refresh_token
    // and client_secret (e.g. an 11-char placeholder), and every refresh-grant
    // mint then fails invalid_grant, so no account could ever connect. Verified
    // against the installed gws CLI. Codex v1.0.41 r4 P1.
    execFile('gws', ['auth', 'export', '--unmasked'], { env: EXEC_ENV, timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.warn('[gws-accounts] gws auth export failed:', err.code || 'unknown');
        return resolve(null);
      }
      try {
        const j = JSON.parse(stdout);
        if (j && typeof j.refresh_token === 'string') resolve(j);
        else resolve(null);
      } catch {
        resolve(null); // never log stdout: it carries the refresh token
      }
    });
  });
}

// The OAuth client from ~/.config/gws/client_secret.json (installed app form).
async function readGwsClient() {
  try {
    const j = JSON.parse(await fs.readFile(GWS_CLIENT_SECRET, 'utf8'));
    const c = j.installed || j.web || {};
    if (typeof c.client_id === 'string' && typeof c.client_secret === 'string') {
      return { client_id: c.client_id, client_secret: c.client_secret };
    }
  } catch { /* fall through */ }
  return null;
}

// Exchange a refresh token for an access token. Returns { access_token,
// expires_in, scope } or { error } (never throws; never returns secrets in
// error). This is the phase-0 mechanism and the runtime minter.
async function refreshGrant(client_id, client_secret, refresh_token) {
  try {
    const body = new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) {
      return { access_token: j.access_token, expires_in: Number(j.expires_in) || 3600, scope: typeof j.scope === 'string' ? j.scope : '' };
    }
    // j.error is an OAuth error CODE (invalid_grant, etc.), not a secret.
    return { error: typeof j.error === 'string' ? j.error : `http_${r.status}` };
  } catch (e) {
    return { error: e?.code || 'network_error' };
  }
}

/**
 * Connect the currently-logged-in gws account into Dobius.
 *
 * Flow: snapshot via `gws auth export`, find a client that actually mints
 * (proving phase 0 live), read the account email from the granted token,
 * persist the 0600 profile + metadata. Returns { ok, account } or
 * { ok:false, error } with a REDACTED, generic error.
 */
export async function connectGwsAccount() {
  const exp = await gwsAuthExport();
  if (!exp) {
    return { ok: false, error: 'Could not read gws credentials. Run `gws auth login` in a terminal first.' };
  }
  // Try the export's own client first (matched set with its refresh token),
  // then the installed client from client_secret.json. Store whichever works.
  const candidates = [];
  if (exp.client_id && exp.client_secret) candidates.push({ client_id: exp.client_id, client_secret: exp.client_secret });
  const installed = await readGwsClient();
  if (installed) candidates.push(installed);
  if (candidates.length === 0) {
    return { ok: false, error: 'No usable OAuth client found for gws.' };
  }

  let working = null;
  let minted = null;
  for (const c of candidates) {
    const res = await refreshGrant(c.client_id, c.client_secret, exp.refresh_token);
    if (res.access_token) { working = c; minted = res; break; }
  }
  if (!working) {
    return { ok: false, error: 'Google rejected the refresh token for every known OAuth client. Reconnect with `gws auth login`.' };
  }

  // Identify the account email from the minted access token (userinfo).
  let email = '';
  try {
    const ur = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${minted.access_token}` },
    });
    const uj = await ur.json().catch(() => ({}));
    if (typeof uj.email === 'string') email = uj.email;
  } catch { /* email stays empty; handled below */ }
  if (!email) {
    return { ok: false, error: 'Connected, but could not read the account email (userinfo scope missing?). Reconnect granting profile/email.' };
  }

  // Reuse an existing id for this email so reconnect refreshes in place.
  const existing = getGwsAccounts().find((a) => a.email === email);
  const id = existing?.id || newGwsId();
  try {
    await writeProfile(id, {
      email,
      client_id: working.client_id,
      client_secret: working.client_secret,
      refresh_token: exp.refresh_token,
    });
  } catch {
    return { ok: false, error: 'Could not save the account profile.' };
  }
  const scopes = minted.scope ? minted.scope.split(/\s+/).filter(Boolean) : [];
  const meta = saveGwsAccount({ id, email, name: email, scopes, addedAt: Date.now() });
  if (!meta) {
    return { ok: false, error: 'Could not save the account.' };
  }
  // Reconnect may have changed scopes or the client, so drop the shim's stale
  // on-disk token cache; otherwise terminal `gws` keeps using the old bearer
  // token for up to an hour. Codex v1.0.41 holistic P2.
  await clearShimTokenCache(id);
  // Seed the token cache with the token we just minted.
  tokenCache.set(id, { token: minted.access_token, expiresAt: Date.now() + (minted.expires_in - 60) * 1000 });
  return { ok: true, account: { id: meta.id, email: meta.email, name: meta.name, scopes: meta.scopes } };
}

/** Public list: metadata only, NEVER tokens. */
export function listGwsAccounts() {
  return getGwsAccounts().map((a) => ({ id: a.id, email: a.email, name: a.name, scopes: a.scopes || [] }));
}

/** Remove an account: delete its 0600 profile file + registry entry + cache. */
export async function removeGwsAccount(id) {
  if (!isValidGwsId(id)) return { ok: false, error: 'Invalid account' };
  const p = profilePathFor(id);
  if (p) {
    try {
      await fs.unlink(p);
    } catch (e) {
      // ENOENT (already gone) is fine. Any other failure means the refresh
      // token is STILL on disk, so do NOT drop the registry entry and do NOT
      // report success: keep the account visible so the user can retry rather
      // than orphan a live token invisibly. Codex v1.0.41 r5 P2.
      if (e?.code !== 'ENOENT') {
        console.warn('[gws-accounts] could not delete profile:', e?.code || 'unknown');
        return { ok: false, error: 'Could not delete the stored credentials. Try again.' };
      }
    }
  }
  tokenCache.delete(id);
  await clearShimTokenCache(id); // also drop the shim's on-disk token cache
  deleteGwsAccount(id);
  return { ok: true };
}

/** Resolve an email to a connected account id, or null. */
export function idForEmail(email) {
  if (typeof email !== 'string') return null;
  const hit = getGwsAccounts().find((a) => a.email.toLowerCase() === email.toLowerCase());
  return hit ? hit.id : null;
}

/**
 * Get a valid access token for a connected account id. Mints + caches as
 * needed. MAIN-PROCESS ONLY: this is deliberately not exposed through preload,
 * so a bearer token never reaches the renderer (Codex plan #1). Returns the
 * token string or null.
 */
export async function getAccessToken(id) {
  if (!isValidGwsId(id)) return null;
  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt - Date.now() > 60 * 1000) return cached.token;
  const prof = await readProfile(id);
  if (!prof) return null;
  const res = await refreshGrant(prof.client_id, prof.client_secret, prof.refresh_token);
  if (!res.access_token) {
    console.warn('[gws-accounts] token refresh failed:', res.error || 'unknown');
    return null;
  }
  tokenCache.set(id, { token: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 });
  return res.access_token;
}

/** Convenience: token by email. Main-only. */
export async function getAccessTokenForEmail(email) {
  const id = idForEmail(email);
  return id ? getAccessToken(id) : null;
}

// --- Terminal token-broker shim (v1.0.41) ---

/** Find the real gws binary (never the shim). Scans the standard dirs. */
export function resolveRealGws(excludeDir = null) {
  for (const dir of EXEC_PATH.split(':')) {
    if (!dir || dir === excludeDir) continue;
    const cand = path.join(dir, 'gws');
    try { fsSync.accessSync(cand, FS.X_OK); return cand; } catch { /* next */ }
  }
  return null;
}

/**
 * Materialize the gws shim into userData and return { shimDir, realGws }.
 *
 * Writes a wrapper `gws` that runs the bundled gws-shim.mjs under Dobius's own
 * Electron binary in node mode (ELECTRON_RUN_AS_NODE), so the shim needs no
 * node/python on the user's PATH. main.js prepends shimDir to each terminal's
 * PATH and sets DOBIUS_REAL_GWS, so `gws` in a Dobius terminal is the shim
 * (transparent passthrough unless DOBIUS_GWS_ACCOUNT[_ID] is set). Returns null
 * shimDir if the source cannot be staged.
 */
export function ensureShim() {
  const realGws = resolveRealGws();
  let shimDir;
  try {
    shimDir = path.join(app.getPath('userData'), 'gws-shim');
    fsSync.mkdirSync(shimDir, { recursive: true });
    const srcJs = path.join(__dirname, 'gws-shim.mjs');
    const destJs = path.join(shimDir, 'gws-shim.mjs');
    // Copy the bundled shim source out of the asar so a plain node can run it.
    fsSync.copyFileSync(srcJs, destJs);
    const wrapperPath = path.join(shimDir, 'gws');
    // execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it a node.
    const wrapper = `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexport DOBIUS_GWS_SHIM_SELF="${wrapperPath}"\nexec "${process.execPath}" "${destJs}" "$@"\n`;
    fsSync.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
    fsSync.chmodSync(wrapperPath, 0o755);
  } catch (e) {
    console.warn('[gws-accounts] could not stage gws shim:', e?.code || e?.message || 'unknown');
    shimDir = null;
  }
  return { shimDir, realGws };
}
