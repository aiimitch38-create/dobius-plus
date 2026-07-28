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
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { getGwsAccounts, saveGwsAccount, deleteGwsAccount, isValidGwsId } from './config-manager.js';

const PROFILES_DIR = path.join(os.homedir(), '.gws-profiles');
const GWS_CLIENT_SECRET = path.join(os.homedir(), '.config', 'gws', 'client_secret.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// gws is typically a Homebrew binary; Electron's PATH is minimal, so augment it.
const EXEC_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const EXEC_ENV = { ...process.env, PATH: `${EXEC_PATH}:${process.env.PATH || ''}` };

// In-memory access-token cache: id -> { token, expiresAt }. Never persisted.
const tokenCache = new Map();

function ensureProfilesDir() {
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

// Read a profile file safely: must be a regular file (not a symlink) directly
// under PROFILES_DIR, then parse. Returns the parsed creds or null.
async function readProfile(id) {
  const p = profilePathFor(id);
  if (!p) return null;
  try {
    const st = await fs.lstat(p);
    if (!st.isFile()) return null; // reject symlink/dir/etc (no-follow)
    const raw = await fs.readFile(p, 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j.refresh_token !== 'string') return null;
    return j;
  } catch {
    return null;
  }
}

async function writeProfile(id, creds) {
  ensureProfilesDir();
  const p = profilePathFor(id);
  if (!p) throw new Error('bad_id');
  // Write 0600 so only the user can read the refresh token.
  await fs.writeFile(p, JSON.stringify(creds), { mode: 0o600 });
  try { await fs.chmod(p, 0o600); } catch { /* best effort */ }
}

// Run `gws auth export` for the CURRENTLY logged-in gws account. Read-only.
// Returns { client_id, client_secret, refresh_token } or null.
function gwsAuthExport() {
  return new Promise((resolve) => {
    execFile('gws', ['auth', 'export'], { env: EXEC_ENV, timeout: 15000 }, (err, stdout) => {
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
  if (p) { try { await fs.unlink(p); } catch { /* already gone */ } }
  tokenCache.delete(id);
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
