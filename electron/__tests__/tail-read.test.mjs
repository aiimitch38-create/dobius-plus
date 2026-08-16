// readTail correctness across chunk boundaries (v1.0.62). The tail reader was
// rewritten from a per-chunk full-buffer recount (quadratic: ~0.5GB of
// scanning per call at the 8MB cap, paid every 3.5s chat poll on an active
// transcript) to per-chunk counting with a single concat. These lock the
// rewrite to the exact old behavior on files big enough to span many chunks.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseJsonl } from '../data-utils.js';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
};

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-tailread-'));

// A file spanning many 64KB chunks: 3000 lines of ~200 bytes = ~600KB.
{
  const lines = [];
  for (let i = 0; i < 3000; i += 1) lines.push(JSON.stringify({ i, pad: 'x'.repeat(180) }));
  const p = path.join(dir, 'many-chunks.jsonl');
  await fs.writeFile(p, lines.join('\n') + '\n');
  const tail = await parseJsonl(p, 50);
  check('tail across chunks: right count', tail.length, 50);
  check('tail across chunks: exact last entry', tail[49].i, 2999);
  check('tail across chunks: exact first entry of the window', tail[0].i, 2950);
}

// One line far larger than a 64KB chunk: the reader must keep growing past
// chunk boundaries until the line is complete.
{
  const p = path.join(dir, 'giant-line.jsonl');
  const giant = JSON.stringify({ id: 'giant', pad: 'y'.repeat(200_000) });
  await fs.writeFile(p, `${JSON.stringify({ id: 'before' })}\n${giant}\n${JSON.stringify({ id: 'after' })}\n`);
  const tail = await parseJsonl(p, 2);
  check('giant line: both tail entries parse', tail.map((e) => e.id), ['giant', 'after']);
  check('giant line: content intact through chunk boundaries', tail[0].pad.length, 200_000);
}

// A file smaller than one chunk still round-trips whole.
{
  const p = path.join(dir, 'small.jsonl');
  await fs.writeFile(p, `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ a: 2 })}\n`);
  check('small file: full tail', (await parseJsonl(p, 10)).map((e) => e.a), [1, 2]);
}

// Multibyte UTF-8 straddling a chunk boundary must not corrupt: build a file
// where a run of 3-byte chars crosses the 64KB edge.
{
  const p = path.join(dir, 'utf8-boundary.jsonl');
  const pad = '€'.repeat(30_000); // 90KB of euro signs in one line
  await fs.writeFile(p, `${JSON.stringify({ id: 'first' })}\n${JSON.stringify({ id: 'euros', pad })}\n`);
  const tail = await parseJsonl(p, 1);
  check('utf8 boundary: line parses', tail[0]?.id, 'euros');
  check('utf8 boundary: every char survives', tail[0]?.pad === pad, true);
}

await fs.rm(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
