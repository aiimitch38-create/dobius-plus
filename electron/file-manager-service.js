// File manager backing the Files side panel: list, preview, create, rename,
// and trash entries INSIDE a known project directory. Every operation resolves
// through containedPath() so neither `..` segments nor symlinks can reach
// outside the project root (same trust boundary as the CLAUDE.md editor).
// Deletion is shell.trashItem (recoverable), never fs.rm.
import fsp from 'fs/promises';
import path from 'path';
import { shell } from 'electron';

const MAX_ENTRIES = 2000;          // hard cap per directory listing
const MAX_TEXT_PREVIEW = 512 * 1024;   // 512KB of text
const MAX_IMAGE_PREVIEW = 5 * 1024 * 1024; // 5MB image -> data URL
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

/**
 * Resolve projectDir + relPath and REQUIRE the real (symlink-resolved) result
 * to stay inside the real project root. For paths that must already exist.
 * Returns the absolute real path, or null when invalid/escaping/missing.
 */
async function containedPath(projectDir, relPath) {
  if (!projectDir || typeof projectDir !== 'string') return null;
  if (typeof relPath !== 'string') return null;
  if (relPath.includes('\0')) return null;
  let rootReal;
  try { rootReal = await fsp.realpath(projectDir); } catch { return null; }
  const joined = path.resolve(rootReal, relPath);
  let real;
  try { real = await fsp.realpath(joined); } catch { return null; }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  return real;
}

/**
 * Containment for a path that does NOT exist yet (create / rename target):
 * the PARENT directory must exist and resolve inside the root, and the final
 * segment must be a plain name (no separators, no traversal, no null bytes).
 */
async function containedNewPath(projectDir, relDir, name) {
  if (typeof name !== 'string' || !name || name.length > 255) return null;
  if (name === '.' || name === '..') return null;
  if (/[/\\\0]/.test(name)) return null;
  const parent = await containedPath(projectDir, relDir);
  if (!parent) return null;
  let st;
  try { st = await fsp.stat(parent); } catch { return null; }
  if (!st.isDirectory()) return null;
  return path.join(parent, name);
}

/** Relative path of abs under the project root (for the renderer). */
async function relOf(projectDir, abs) {
  const rootReal = await fsp.realpath(projectDir);
  return abs === rootReal ? '' : path.relative(rootReal, abs);
}

/**
 * List a directory. Returns { relPath, entries } with entries sorted
 * directories-first then case-insensitive alphabetical, capped at MAX_ENTRIES
 * (truncated flag set when the cap hits).
 */
export async function listDir(projectDir, relPath = '') {
  const abs = await containedPath(projectDir, relPath);
  if (!abs) return { relPath: '', entries: [], error: 'Path not found in project' };
  let dirents;
  try { dirents = await fsp.readdir(abs, { withFileTypes: true }); } catch (err) {
    return { relPath: await relOf(projectDir, abs), entries: [], error: err.code || 'unreadable' };
  }
  const entries = [];
  for (const d of dirents) {
    if (entries.length >= MAX_ENTRIES) break;
    let size = 0;
    let mtime = 0;
    let type = d.isDirectory() ? 'dir' : 'file';
    if (d.isSymbolicLink()) {
      // Show symlinks as their target kind but never follow them for size;
      // preview/list operations re-run containment on the resolved path anyway.
      try { type = (await fsp.stat(path.join(abs, d.name))).isDirectory() ? 'dir' : 'file'; } catch { type = 'file'; }
    }
    if (type === 'file') {
      try { const st = await fsp.lstat(path.join(abs, d.name)); size = st.size; mtime = st.mtimeMs; } catch { /* raced away */ }
    }
    entries.push({ name: d.name, type, size, mtime });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : (a.type === 'dir' ? -1 : 1)));
  return {
    relPath: await relOf(projectDir, abs),
    entries,
    truncated: dirents.length > MAX_ENTRIES,
  };
}

/**
 * Preview a file: text (<=512KB), image (<=5MB, as data URL), or metadata-only
 * for binary/oversized files.
 */
export async function readPreview(projectDir, relPath) {
  const abs = await containedPath(projectDir, relPath);
  if (!abs) return { kind: 'error', error: 'Path not found in project' };
  let st;
  try { st = await fsp.stat(abs); } catch { return { kind: 'error', error: 'unreadable' }; }
  if (st.isDirectory()) return { kind: 'error', error: 'is a directory' };
  const ext = path.extname(abs).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    if (st.size > MAX_IMAGE_PREVIEW) return { kind: 'toolarge', size: st.size };
    const buf = await fsp.readFile(abs);
    return { kind: 'image', size: st.size, dataUrl: `data:${IMAGE_MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}` };
  }
  // Binary sniff: a NUL byte in the first 8KB means "not text".
  const fd = await fsp.open(abs, 'r');
  try {
    const head = Buffer.alloc(Math.min(8192, st.size));
    await fd.read(head, 0, head.length, 0);
    if (head.includes(0)) return { kind: 'binary', size: st.size };
    if (st.size > MAX_TEXT_PREVIEW) {
      const buf = Buffer.alloc(MAX_TEXT_PREVIEW);
      await fd.read(buf, 0, MAX_TEXT_PREVIEW, 0);
      return { kind: 'text', size: st.size, content: buf.toString('utf8'), truncated: true };
    }
  } finally {
    await fd.close();
  }
  return { kind: 'text', size: st.size, content: await fsp.readFile(abs, 'utf8'), truncated: false };
}

/** Create a file (empty) or folder inside relDir. Fails if it already exists. */
export async function createEntry(projectDir, relDir, name, kind) {
  const abs = await containedNewPath(projectDir, relDir, name);
  if (!abs) return { ok: false, error: 'Invalid name or location' };
  try {
    if (kind === 'dir') {
      await fsp.mkdir(abs);
    } else {
      await fsp.writeFile(abs, '', { flag: 'wx' }); // wx: fail if exists
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code === 'EEXIST' ? 'Already exists' : (err.code || 'failed') };
  }
}

/** Rename an entry in place (same directory, new basename). */
export async function renameEntry(projectDir, relPath, newName) {
  const abs = await containedPath(projectDir, relPath);
  if (!abs) return { ok: false, error: 'Path not found in project' };
  const rootReal = await fsp.realpath(projectDir);
  if (abs === rootReal) return { ok: false, error: 'Cannot rename the project root' };
  const target = await containedNewPath(projectDir, path.dirname(await relOf(projectDir, abs)), newName);
  if (!target) return { ok: false, error: 'Invalid new name' };
  try {
    await fsp.rename(abs, target);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'failed' };
  }
}

/** Move an entry to the system Trash (recoverable; never a hard delete). */
export async function trashEntry(projectDir, relPath) {
  const abs = await containedPath(projectDir, relPath);
  if (!abs) return { ok: false, error: 'Path not found in project' };
  const rootReal = await fsp.realpath(projectDir);
  if (abs === rootReal) return { ok: false, error: 'Cannot trash the project root' };
  try {
    await shell.trashItem(abs);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'failed' };
  }
}

/** Reveal in Finder. */
export async function revealEntry(projectDir, relPath) {
  const abs = await containedPath(projectDir, relPath);
  if (abs) shell.showItemInFolder(abs);
}

/** Open with the OS default app. */
export async function openEntry(projectDir, relPath) {
  const abs = await containedPath(projectDir, relPath);
  if (abs) await shell.openPath(abs);
}
