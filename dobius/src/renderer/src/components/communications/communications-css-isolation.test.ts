import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Communications client ships its own Tailwind build and theme into the
// app's document. Opening it once used to restyle the whole app: its preflight
// reset every border to currentColor, its `hsl(var(--foreground))` utilities
// replaced the app's (the app tokens are hex/oklch, so they went transparent —
// every Settings switch vanished), and its ThemeProvider wrote HSL channels
// over the app's `--background`/`--foreground`/... on <html>.

const COMMS = import.meta.dirname
const RENDERER = join(COMMS, '..', '..')
const EMBED_CSS = join(COMMS, 'communications-embed.css')

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') {
      continue
    }
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...walk(path, exts))
    } else if (exts.some((ext) => name.endsWith(ext)) && !name.includes('.test.')) {
      out.push(path)
    }
  }
  return out
}

const TOKEN = /(?<![\w-])--([a-z][\w-]*)/g
const DECLARED = /(?<![\w-])--([a-z][\w-]*)\s*:/g

function appDeclaredTokens(): Set<string> {
  const names = new Set<string>()
  for (const file of walk(RENDERER, ['.css', '.ts', '.tsx'])) {
    if (file.startsWith(COMMS)) {
      continue
    }
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(DECLARED)) {
      names.add(m[1])
    }
    for (const m of text.matchAll(/setProperty\(\s*['"]--([a-z][\w-]*)/g)) {
      names.add(m[1])
    }
  }
  return names
}

describe('Communications CSS isolation', () => {
  it('uses no custom property the app also defines (except the subtree aliases)', () => {
    const app = appDeclaredTokens()
    expect(app.has('foreground')).toBe(true)
    const clashes: string[] = []
    for (const file of walk(COMMS, ['.css', '.ts', '.tsx', '.js'])) {
      if (file === EMBED_CSS) {
        continue
      }
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(TOKEN)) {
        if (app.has(m[1]) && !m[1].startsWith('tw-')) {
          clashes.push(`${relative(COMMS, file)}: --${m[1]}`)
        }
      }
    }
    expect([...new Set(clashes)]).toEqual([])
  })

  it('aliases the app tokens only inside the Communications subtree', () => {
    const css = readFileSync(EMBED_CSS, 'utf8')
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const declaresAppToken = /(?<![\w-])--(background|foreground|primary|border|input)\s*:/.test(
        m[2]
      )
      if (declaresAppToken) {
        const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim()
        expect(selectors).toBe(':where(.dobius-comms-embed, .dobius-comms-embed *)')
      }
    }
  })

  it('layers the whole client below the app components/utilities, without preflight', () => {
    const globals = readFileSync(join(COMMS, 'shared/styles/globals.css'), 'utf8')
    expect(globals).not.toMatch(/@import\s+["']tailwindcss["']/)
    expect(globals).not.toMatch(/tailwindcss\/preflight/)
    expect(globals).toMatch(
      /@import\s+"tailwindcss\/utilities\.css"\s+layer\(comms\.utilities\)\s+source\(none\)/
    )
    expect(globals).toMatch(/@import\s+"tailwindcss\/theme\.css"\s+layer\(comms\.theme\)/)
    expect(globals).toMatch(
      /@layer comms\.theme, comms\.base, comms\.components, comms\.utilities;/
    )

    for (const file of walk(join(COMMS, 'shared/styles'), ['.css'])) {
      for (const m of readFileSync(file, 'utf8').matchAll(/@layer\s+([\w.-]+)\s*\{/g)) {
        expect(`${relative(COMMS, file)}: ${m[1]}`).toMatch(/: comms\./)
      }
    }

    const main = readFileSync(join(RENDERER, 'assets/main.css'), 'utf8')
    const firstRule = main
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .split(';')[0]
    expect(firstRule).toBe('@layer properties, theme, base, comms, components, utilities')
  })

  it('scopes element-wide base rules to the Communications subtree', () => {
    const theme = readFileSync(join(COMMS, 'shared/styles/globals/theme.css'), 'utf8')
    // A bare `*`, `body` or `mark` rule here would restyle every app element.
    const selectors = [...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].map(
      (m) => m[1].trim().replace(/\s+/g, ' ')
    )
    for (const bare of ['*', 'body', 'mark']) {
      expect(selectors).not.toContain(bare)
    }
  })
})
