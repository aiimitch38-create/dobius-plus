// Chrome profile launcher (v1.0.41).
//
// Sam runs ~29 Chrome profiles, each logged into a different Google account.
// This lets Dobius list them and open a URL in a CHOSEN profile, so a link
// lands in the right account's browser without hunting through the profile
// menu. It reads Chrome's own profile registry (Local State) read-only and
// launches the Chrome binary directly with --profile-directory.
//
// No OAuth, no tokens, no Google API: Chrome is already authenticated for each
// profile. This is the safe, self-contained half of the "multiple Google
// accounts" ask.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';

const LOCAL_STATE = path.join(
  os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Local State',
);
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// A Chrome profile directory name is "Default" or "Profile <n>". Anything else
// is rejected before it can reach --profile-directory, so a crafted value can
// never inject another flag or a path. This is the allowlist SHAPE; the value
// must ALSO be one actually present in Local State (checked in openUrlInProfile).
const PROFILE_DIR_RE = /^(Default|Profile \d{1,4})$/;

/**
 * List Chrome profiles from Local State (read-only).
 * Returns [{ dir, name, account }] sorted by display name, or [] if Chrome is
 * not installed / Local State is unreadable. Never throws.
 */
export async function listChromeProfiles() {
  let raw;
  try {
    raw = await fs.readFile(LOCAL_STATE, 'utf8');
  } catch {
    return []; // Chrome not installed or no profiles yet
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const cache = json?.profile?.info_cache;
  if (!cache || typeof cache !== 'object') return [];
  const out = [];
  for (const [dir, info] of Object.entries(cache)) {
    // Only surface real, shape-valid profile dirs.
    if (!PROFILE_DIR_RE.test(dir)) continue;
    out.push({
      dir,
      name: typeof info?.name === 'string' ? info.name : dir,
      // user_name is the signed-in Google account for the profile (may be '').
      account: typeof info?.user_name === 'string' ? info.user_name : '',
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Open a URL in a specific Chrome profile.
 *
 * Security:
 *  - profileDir must be SHAPE-valid AND present in Local State (allowlist), so
 *    it can never inject another Chrome flag or an arbitrary path.
 *  - url must be http(s). Rejects file:, javascript:, data:, chrome:, etc.,
 *    which could read local files or run script in the chosen profile.
 *  - execFile with an argv array (no shell), so neither value is ever
 *    interpreted by a shell.
 *
 * Returns { ok: true } or { ok: false, error } (generic, no internals leaked).
 */
export async function openUrlInProfile(profileDir, url) {
  if (typeof profileDir !== 'string' || !PROFILE_DIR_RE.test(profileDir)) {
    return { ok: false, error: 'Invalid profile' };
  }
  // Must be a profile Chrome actually knows about.
  const known = await listChromeProfiles();
  if (!known.some((p) => p.dir === profileDir)) {
    return { ok: false, error: 'Unknown profile' };
  }
  if (typeof url !== 'string' || url.length > 2048) {
    return { ok: false, error: 'Invalid URL' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are allowed' };
  }
  return await new Promise((resolve) => {
    execFile(
      CHROME_BIN,
      [`--profile-directory=${profileDir}`, parsed.href],
      { timeout: 10000 },
      (err) => {
        if (err) {
          // Do not surface err.message (may include the binary path / args).
          console.warn('[chrome-profiles] launch failed:', err.code || 'unknown');
          resolve({ ok: false, error: 'Could not launch Chrome' });
        } else {
          resolve({ ok: true });
        }
      },
    );
  });
}
