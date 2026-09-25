import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// Must match V2_WRITER_MARKER_FILE in dobius/src/main/storage/v2-writer-marker.ts.
// The Dobius+ V2 app writes it into the userData dir it owns. This legacy V1 app
// uses the same dir (same package name), so once the marker exists V1 must not
// start or write there: its config.json, scrollback and Chromium profile files
// would land in V2's data (bug #52).
export const V2_WRITER_MARKER_FILE = 'dobius-v2-writer.json';

let loggedBlock = false;

/**
 * True when the V2 writer marker exists in `dir`. Any error other than
 * "not found" (permissions, I/O) counts as present, so V1 fails closed.
 */
export function hasV2WriterMarker(dir) {
  try {
    fs.lstatSync(path.join(dir, V2_WRITER_MARKER_FILE));
    return true;
  } catch (err) {
    return err?.code !== 'ENOENT';
  }
}

// Why at import time: main.js imports this module before any module that
// resolves userData paths, and Chromium writes its profile files into userData
// during startup. Redirecting here keeps a refused launch out of V2's dir.
export const V1_SHARED_DATA_DIR = app.getPath('userData');
export const v1RefusedAtStartup = hasV2WriterMarker(V1_SHARED_DATA_DIR);
if (v1RefusedAtStartup) {
  app.setPath('userData', path.join(app.getPath('temp'), 'dobius-v1-refused'));
}

/**
 * True when V1 must not write to the shared data dir: refused at startup, or V2
 * claimed the dir while this V1 process was already running.
 */
export function v1WritesBlocked() {
  const blocked = v1RefusedAtStartup || hasV2WriterMarker(V1_SHARED_DATA_DIR);
  if (blocked && !loggedBlock) {
    loggedBlock = true;
    console.warn(`[v2-writer-guard] ${V2_WRITER_MARKER_FILE} found in ${V1_SHARED_DATA_DIR}; legacy V1 writes are disabled.`);
  }
  return blocked;
}
