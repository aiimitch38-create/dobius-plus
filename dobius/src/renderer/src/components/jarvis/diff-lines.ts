export type DiffLine = { kind: 'context' | 'added' | 'removed'; text: string }

/**
 * Line diff for review display only.
 *
 * Why hand-rolled: this drives a read-only panel, and the one diff package in
 * the tree is an undeclared transitive dependency — depending on it would add a
 * packaging question for something a short LCS covers.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split('\n')
  const after = newText.split('\n')

  // Longest common subsequence table over lines.
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0)
  )
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        before[i] === after[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'context', text: before[i] })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ kind: 'removed', text: before[i] })
      i += 1
    } else {
      lines.push({ kind: 'added', text: after[j] })
      j += 1
    }
  }
  while (i < before.length) {
    lines.push({ kind: 'removed', text: before[i] })
    i += 1
  }
  while (j < after.length) {
    lines.push({ kind: 'added', text: after[j] })
    j += 1
  }
  return lines
}

/** Trims unchanged runs so a long file still reads as a short review. */
export function collapseContext(lines: DiffLine[], keep = 3): DiffLine[] {
  const keepIndex = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind === 'context') {
      return
    }
    for (let offset = -keep; offset <= keep; offset += 1) {
      const target = index + offset
      if (target >= 0 && target < lines.length) {
        keepIndex.add(target)
      }
    }
  })

  const result: DiffLine[] = []
  let skipping = false
  lines.forEach((line, index) => {
    if (keepIndex.has(index)) {
      result.push(line)
      skipping = false
      return
    }
    if (!skipping) {
      result.push({ kind: 'context', text: '⋯' })
      skipping = true
    }
  })
  return result
}
