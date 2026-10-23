import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_ARTIFACT_COUNT = 32

export function collectArtifactEvidence(root: string, paths: readonly string[], maxBytes: number) {
  if (paths.length > MAX_ARTIFACT_COUNT) {
    throw new Error('Recipe artifact allowlist exceeds the count limit.')
  }
  let total = 0
  const evidence: string[] = []
  for (const path of paths) {
    if (isAbsolute(path)) {
      throw new Error('Artifact paths must be relative to the enrolled root.')
    }
    const fullPath = resolve(root, path)
    const rel = relative(root, fullPath)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
      throw new Error('Artifact path escapes the enrolled root.')
    }
    let parent = root
    for (const segment of rel.split(sep).slice(0, -1)) {
      parent = resolve(parent, segment)
      const parentStat = lstatSync(parent)
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new Error('Artifact parent must be a real directory under the enrolled root.')
      }
    }
    const fd = openSync(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile()) {
        throw new Error('Artifact must be a regular non-symlink file.')
      }
      const bytes = readFileSync(fd)
      total += bytes.byteLength
      if (total > maxBytes) {
        throw new Error('Artifact output exceeds the registered byte cap.')
      }
      const digest = createHash('sha256').update(bytes).digest('hex')
      evidence.push(`artifact:${rel}:${bytes.byteLength}:${digest}`)
    } finally {
      closeSync(fd)
    }
  }
  return evidence
}
