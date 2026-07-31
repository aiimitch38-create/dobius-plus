// Local speech-to-text for the mobile voice feature (v1.0.43 Phase 5), using
// the Mac's whisper.cpp (Metal) via whisper-cli. Sam's requirement: use the
// Mac-specific whisper CLI, no cloud STT. Audio recorded on the phone is
// streamed to the Mac over Tailscale and transcribed here; the text then feeds
// the existing Voice Conductor flow.
//
// Pipeline: <recorded blob> -> ffmpeg (16kHz mono PCM WAV) -> whisper-cli -> text.

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';

const WHISPER_CANDIDATES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
const MODEL_CANDIDATES = [
  path.join(os.homedir(), '.samknows', 'models', 'ggml-base.en.bin'),
  path.join(os.homedir(), '.cache', 'whisper-cpp', 'ggml-base.en.bin'),
  path.join(os.homedir(), '.cache', 'whisper-cpp', 'ggml-medium.en.bin'),
];
// A recorded voice command is short; cap the upload so a bad/hostile client
// can't fill the disk or hang whisper.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function firstExecutable(cands) {
  for (const p of cands) {
    try { fsSync.accessSync(p, fsSync.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}
function firstFile(cands) {
  for (const p of cands) {
    try { if (fsSync.statSync(p).size > 0) return p; } catch { /* next */ }
  }
  return null;
}

/** Are all the pieces present to transcribe locally? */
export function transcribeAvailable() {
  return !!(firstExecutable(WHISPER_CANDIDATES) && firstExecutable(FFMPEG_CANDIDATES) && firstFile(MODEL_CANDIDATES));
}

function run(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// A safe extension for the recorded container, derived from the mime type. Only
// used to name a temp file; ffmpeg sniffs the real format regardless.
function extFor(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  return 'bin';
}

/**
 * Transcribe a recorded audio buffer to text. Returns the transcript string, or
 * { error } (never throws). Writes only to a private temp dir, cleaned up after.
 */
export async function transcribeAudio(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: 'empty audio' };
  if (buffer.length > MAX_AUDIO_BYTES) return { error: 'audio too large' };
  const whisper = firstExecutable(WHISPER_CANDIDATES);
  const ffmpeg = firstExecutable(FFMPEG_CANDIDATES);
  const model = firstFile(MODEL_CANDIDATES);
  if (!whisper || !ffmpeg || !model) {
    return { error: 'whisper-cli / ffmpeg / model not installed on this Mac' };
  }

  const base = path.join(os.tmpdir(), `dobius-voice-${Date.now()}-${randomBytes(4).toString('hex')}`);
  const inFile = `${base}.${extFor(mimeType)}`;
  const wavFile = `${base}.wav`;
  const outPrefix = base; // whisper writes <outPrefix>.txt
  const txtFile = `${base}.txt`;
  try {
    await fs.writeFile(inFile, buffer, { mode: 0o600 });
    // Convert to what whisper.cpp wants: 16kHz mono signed-16 PCM WAV.
    const conv = await run(ffmpeg, ['-y', '-i', inFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile], 30000);
    if (conv.err || !fsSync.existsSync(wavFile)) {
      return { error: 'could not decode the audio' };
    }
    const tr = await run(whisper, ['-m', model, '-f', wavFile, '-otxt', '-nt', '-np', '-of', outPrefix], 120000);
    if (tr.err) return { error: 'transcription failed' };
    let text = '';
    try { text = (await fs.readFile(txtFile, 'utf8')).trim(); } catch { /* no output */ }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return { error: 'no speech detected' };
    return { text };
  } catch (e) {
    return { error: e?.code || 'transcribe error' };
  } finally {
    for (const f of [inFile, wavFile, txtFile]) {
      try { await fs.unlink(f); } catch { /* best effort */ }
    }
  }
}
