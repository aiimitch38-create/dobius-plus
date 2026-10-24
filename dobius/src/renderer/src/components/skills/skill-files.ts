import { useCallback, useEffect, useState } from 'react'
import { joinPath } from '@/lib/path'
import { useMountedRef } from '@/hooks/useMountedRef'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoverySource
} from '../../../../shared/skills'
import { withSkillScanTimeout } from './skills-scan'
import { toSkillName } from './skill-starters'

// Reading and writing SKILL.md files for create / edit / duplicate. Writes only
// land under a scope folder the user picked (a home or repo skills folder from
// discovery) and never replace an existing file unless the caller passes
// `overwrite` after the user confirmed.

export type SkillScope = { id: string; label: string; path: string }

const SCOPE_ORDER = ['home-claude', 'home-agents', 'home-codex']

/** Writable skill folders: home and repo roots (plugin and bundled roots are read-only). */
export function skillScopes(sources: readonly SkillDiscoverySource[]): SkillScope[] {
  const rank = (id: string): number => {
    const index = SCOPE_ORDER.indexOf(id)
    return index === -1 ? SCOPE_ORDER.length : index
  }
  return sources
    .filter(
      (s) =>
        (s.sourceKind === 'home' || s.sourceKind === 'repo') &&
        !s.skippedReason?.startsWith('remote')
    )
    .map((s) => ({ id: s.id, label: s.label, path: s.path }))
    .sort((a, b) => rank(a.id) - rank(b.id))
}

export function isEditableSkill(skill: DiscoveredSkill): boolean {
  return skill.installed && (skill.sourceKind === 'home' || skill.sourceKind === 'repo')
}

/** `<scope>/<name>/SKILL.md`; throws for a name that is not a valid skill folder name. */
export function skillTargetPath(scopePath: string, name: string): string {
  if (!name || toSkillName(name) !== name) {
    throw new Error(`Invalid skill name: ${name}`)
  }
  return joinPath(joinPath(scopePath, name), 'SKILL.md')
}

export function skillFolderName(skillFilePath: string): string {
  const parts = skillFilePath.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? (parts.at(-2) ?? '') : ''
}

export async function readSkillFile(
  skill: Pick<DiscoveredSkill, 'directoryPath' | 'skillFilePath'>
): Promise<string> {
  // Why: skill folders (e.g. ~/.claude/skills) sit outside workspace roots, so
  // the read is authorized for this one skill folder first.
  await window.api.fs.authorizeExternalPath({ targetPath: skill.directoryPath })
  const result = await window.api.fs.readFile({ filePath: skill.skillFilePath })
  if (result.isBinary) {
    throw new Error('SKILL.md is not a text file')
  }
  return result.content
}

export type SkillSaveResult = { status: 'saved'; path: string } | { status: 'exists'; path: string }

/** Creates `<scope>/<name>/SKILL.md`. Reports `exists` instead of replacing unless `overwrite`. */
export async function createSkillFile(args: {
  scopePath: string
  name: string
  content: string
  overwrite?: boolean
}): Promise<SkillSaveResult> {
  const path = skillTargetPath(args.scopePath, args.name)
  await window.api.fs.authorizeExternalPath({ targetPath: joinPath(args.scopePath, args.name) })
  const exists = await window.api.fs.pathExists({ filePath: path })
  if (exists && !args.overwrite) {
    return { status: 'exists', path }
  }
  if (!exists) {
    // Why: createFile is create-if-absent (wx) and makes the folder, so a file
    // that appeared since the check fails here instead of being clobbered.
    await window.api.fs.createFile({ filePath: path })
  }
  await window.api.fs.writeFile({ filePath: path, content: args.content })
  return { status: 'saved', path }
}

/** Saves an edit to a skill the user opened from a writable folder. */
export async function saveSkillEdit(
  skill: Pick<DiscoveredSkill, 'directoryPath' | 'skillFilePath'>,
  content: string
): Promise<void> {
  await window.api.fs.authorizeExternalPath({ targetPath: skill.directoryPath })
  await window.api.fs.writeFile({ filePath: skill.skillFilePath, content })
}

/** Discovery including the open workspace's own skill folders. */
export function useSkillDiscovery(cwd: string | null): {
  result: SkillDiscoveryResult | null
  loading: boolean
  error: unknown
  reload: () => void
} {
  const [result, setResult] = useState<SkillDiscoveryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [generation, setGeneration] = useState(0)
  const mountedRef = useMountedRef()

  useEffect(() => {
    setLoading(true)
    setError(null)
    withSkillScanTimeout(window.api.skills.discover(cwd ? { cwd } : undefined))
      .then((next) => {
        if (mountedRef.current) {
          setResult(next)
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err)
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false)
        }
      })
  }, [cwd, generation, mountedRef])

  const reload = useCallback(() => setGeneration((n) => n + 1), [])
  return { result, loading, error, reload }
}
