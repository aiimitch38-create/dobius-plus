const DIFF_CONTEXT_LINES = 3
// Why: the line diff is an O(n*m) table; past this many cells the CLI prints a
// plain before/after block instead of hanging on a huge generated file.
const MAX_DIFF_TABLE_CELLS = 4_000_000

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return []
  }
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

export type DiffOp = { kind: ' ' | '-' | '+'; text: string }

function diffMiddle(before: string[], after: string[]): DiffOp[] {
  const n = before.length
  const m = after.length
  if (n === 0 || m === 0 || n * m > MAX_DIFF_TABLE_CELLS) {
    return [
      ...before.map((text) => ({ kind: '-' as const, text })),
      ...after.map((text) => ({ kind: '+' as const, text }))
    ]
  }
  // lcs[i][j] = longest common subsequence of before[i..] and after[j..]
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: ' ', text: before[i] })
      i += 1
      j += 1
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ kind: '-', text: before[i] })
      i += 1
    } else {
      ops.push({ kind: '+', text: after[j] })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ kind: '-', text: before[i] })
    i += 1
  }
  while (j < m) {
    ops.push({ kind: '+', text: after[j] })
    j += 1
  }
  return ops
}

export function buildLineDiff(beforeText: string, afterText: string): DiffOp[] {
  const before = splitLines(beforeText)
  const after = splitLines(afterText)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return [
    ...before.slice(0, prefix).map((text) => ({ kind: ' ' as const, text })),
    ...diffMiddle(
      before.slice(prefix, before.length - suffix),
      after.slice(prefix, after.length - suffix)
    ),
    ...before.slice(before.length - suffix).map((text) => ({ kind: ' ' as const, text }))
  ]
}

export function renderHunks(ops: DiffOp[]): string[] {
  const keep = Array.from({ length: ops.length }, () => false)
  ops.forEach((op, index) => {
    if (op.kind === ' ') {
      return
    }
    const start = Math.max(0, index - DIFF_CONTEXT_LINES)
    const end = Math.min(ops.length - 1, index + DIFF_CONTEXT_LINES)
    for (let k = start; k <= end; k += 1) {
      keep[k] = true
    }
  })
  const out: string[] = []
  let oldLine = 1
  let newLine = 1
  let inHunk = false
  ops.forEach((op, index) => {
    if (keep[index]) {
      if (!inHunk) {
        out.push(`@@ line ${oldLine} before, line ${newLine} after @@`)
        inHunk = true
      }
      out.push(`${op.kind}${op.text}`)
    } else {
      inHunk = false
    }
    if (op.kind !== '+') {
      oldLine += 1
    }
    if (op.kind !== '-') {
      newLine += 1
    }
  })
  return out
}
