// Minimal SKILL.md frontmatter reader shared by the checkup and editor. Pure.

export type ParsedSkillFile = {
  /** null when the file has no frontmatter block at all. */
  fields: Record<string, string> | null
  /** Frontmatter keys in file order. */
  keys: string[]
  body: string
  unclosed: boolean
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed.at(0)
    const last = trimmed.at(-1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = trimmed.slice(1, -1)
      return first === '"'
        ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : inner.replace(/''/g, "'")
    }
  }
  return trimmed
}

/**
 * Small YAML-frontmatter reader: top-level `key: value` pairs, quoted values,
 * and `|` / `>` block scalars. Nested maps and lists are kept as raw text,
 * which is all the linter needs.
 */
export function parseSkillFile(text: string): ParsedSkillFile {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { fields: null, keys: [], body: normalized, unclosed: false }
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end === -1) {
    return { fields: null, keys: [], body: normalized, unclosed: true }
  }
  const fields: Record<string, string> = {}
  const keys: string[] = []
  let current: { key: string; mode: 'block' | 'folded' | 'nested'; parts: string[] } | null = null
  const flush = (): void => {
    if (!current) {
      return
    }
    const joined =
      current.mode === 'folded'
        ? current.parts
            .map((p) => p.trim())
            .filter(Boolean)
            .join(' ')
        : current.parts
            .map((p) => p.replace(/^\s+/, ''))
            .join('\n')
            .trim()
    fields[current.key] = joined
    current = null
  }
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line)
    if (match && !/^\s/.test(line)) {
      flush()
      const key = match[1]
      const raw = match[2].trim()
      if (!keys.includes(key)) {
        keys.push(key)
      }
      if (/^[|>][+-]?$/.test(raw)) {
        current = { key, mode: raw.startsWith('>') ? 'folded' : 'block', parts: [] }
      } else if (raw === '') {
        current = { key, mode: 'nested', parts: [] }
      } else {
        fields[key] = unquote(raw)
      }
      continue
    }
    if (current) {
      current.parts.push(line)
    }
  }
  flush()
  return { fields, keys, body: lines.slice(end + 1).join('\n'), unclosed: false }
}
