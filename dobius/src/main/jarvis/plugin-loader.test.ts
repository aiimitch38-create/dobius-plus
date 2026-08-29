import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_TOOL_PREFIX,
  loadAdamPlugins,
  pluginToolName,
  runPlugin,
  runPluginByToolName
} from './plugin-loader'
import { ADAM_PLUGINS_DIR_NAME } from './shell-tool'
import { resolveEditablePath } from './self-edit'

function pluginDir(): string {
  return mkdtempSync(join(tmpdir(), 'adam-plugins-'))
}

/** Real `.mjs` on disk: a stubbed importer would not prove the mechanism. */
function writePlugin(directory: string, file: string, source: string): void {
  writeFileSync(join(directory, file), source, 'utf-8')
}

const GOOD_PLUGIN = `
export const PLUGIN = {
  name: 'weather',
  description: 'Reads the weather.',
  parameters: { type: 'object', properties: { city: { type: 'string' } } }
}
export async function run(parameters) {
  return \`It is sunny in \${parameters.city}.\`
}
`

describe('loadAdamPlugins', () => {
  it('loads a valid plugin', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'weather.mjs', GOOD_PLUGIN)
    const result = await loadAdamPlugins(directory)
    expect(result.failures).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].name).toBe('weather')
    expect(result.plugins[0].parameters).toMatchObject({ type: 'object' })
  })

  it('runs a loaded plugin', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'weather.mjs', GOOD_PLUGIN)
    const { plugins } = await loadAdamPlugins(directory)
    await expect(runPlugin(plugins[0], { city: 'Perth' })).resolves.toBe('It is sunny in Perth.')
  })

  it('treats a missing directory as no plugins, not an error', async () => {
    await expect(loadAdamPlugins('/nope/does/not/exist')).resolves.toEqual({
      plugins: [],
      failures: []
    })
  })

  it('ignores files that are not .mjs', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'notes.txt', 'not a plugin')
    writePlugin(directory, 'weather.mjs', GOOD_PLUGIN)
    const result = await loadAdamPlugins(directory)
    expect(result.plugins).toHaveLength(1)
    expect(result.failures).toEqual([])
  })
})

describe('loadAdamPlugins — refusals', () => {
  it('refuses a name that is not a valid identifier', async () => {
    const directory = pluginDir()
    writePlugin(
      directory,
      'bad.mjs',
      `export const PLUGIN = { name: '9 drop tables', description: '', parameters: {} }
       export async function run() { return 'x' }`
    )
    const result = await loadAdamPlugins(directory)
    expect(result.plugins).toHaveLength(0)
    expect(result.failures[0].reason).toContain('not a valid plugin name')
  })

  it('refuses a duplicate name and keeps the first', async () => {
    const directory = pluginDir()
    // `a.mjs` sorts before `b.mjs`, and the load order is sorted, so "first"
    // is deterministic rather than whatever the filesystem returns.
    writePlugin(directory, 'a.mjs', GOOD_PLUGIN)
    writePlugin(
      directory,
      'b.mjs',
      `export const PLUGIN = { name: 'weather', description: 'impostor', parameters: {} }
       export async function run() { return 'impostor' }`
    )
    const result = await loadAdamPlugins(directory)
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].description).toBe('Reads the weather.')
    expect(result.failures[0].reason).toContain('duplicate')
  })

  it('reports a module that throws on import and still loads the others', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'aaa-broken.mjs', `throw new Error('boom at import')`)
    writePlugin(directory, 'zzz-weather.mjs', GOOD_PLUGIN)
    const result = await loadAdamPlugins(directory)
    // The broken one must not take the good one down with it.
    expect(result.plugins.map((plugin) => plugin.name)).toEqual(['weather'])
    expect(result.failures[0].reason).toContain('boom at import')
  })

  it('refuses a module with no PLUGIN export', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'x.mjs', `export async function run() { return 'x' }`)
    const result = await loadAdamPlugins(directory)
    expect(result.failures[0].reason).toBe('no PLUGIN export')
  })

  it('refuses a plugin with no description', async () => {
    // The description is the only thing telling the model when to call the
    // tool. Without it the plugin registers and is never invoked, which looks
    // like a broken plugin with nothing in any log.
    const directory = pluginDir()
    writePlugin(
      directory,
      'x.mjs',
      `export const PLUGIN = { name: 'silent', description: '   ', parameters: {} }
       export async function run() { return 'x' }`
    )
    const result = await loadAdamPlugins(directory)
    expect(result.plugins).toHaveLength(0)
    expect(result.failures[0].reason).toContain('no description')
  })

  it('refuses a plugin whose run is not a function', async () => {
    const directory = pluginDir()
    writePlugin(
      directory,
      'x.mjs',
      `export const PLUGIN = { name: 'thing', description: 'Does a thing.', parameters: {} }
       export const run = 'not a function'`
    )
    const result = await loadAdamPlugins(directory)
    expect(result.failures[0].reason).toContain('no run() function')
  })
})

describe('runPlugin', () => {
  it('turns a throwing run into a sentence rather than a rejection', async () => {
    const directory = pluginDir()
    writePlugin(
      directory,
      'x.mjs',
      `export const PLUGIN = { name: 'grumpy', description: 'Always fails.', parameters: {} }
       export async function run() { throw new Error('nope') }`
    )
    const { plugins } = await loadAdamPlugins(directory)
    // A rejection here is a silent non-answer mid-conversation; a sentence is
    // something Adam can actually say.
    await expect(runPlugin(plugins[0], {})).resolves.toBe('The grumpy plugin failed: nope')
  })

  it('stringifies a non-string result', async () => {
    const directory = pluginDir()
    writePlugin(
      directory,
      'x.mjs',
      `export const PLUGIN = { name: 'counter', description: 'Counts things.', parameters: {} }
       export async function run() { return { count: 3 } }`
    )
    const { plugins } = await loadAdamPlugins(directory)
    await expect(runPlugin(plugins[0], {})).resolves.toBe('{"count":3}')
  })
})

describe('runPluginByToolName — the dispatch path', () => {
  it('runs the plugin whose tool name matches', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'weather.mjs', GOOD_PLUGIN)
    const { plugins } = await loadAdamPlugins(directory)
    await expect(runPluginByToolName(plugins, 'plugin_weather', { city: 'Perth' })).resolves.toBe(
      'It is sunny in Perth.'
    )
  })

  it('answers in words for an unknown tool name rather than throwing', async () => {
    // The renderer routes ANY unrecognised name here, so this is a normal case,
    // not an exceptional one — and a rejection mid-conversation is silence.
    await expect(runPluginByToolName([], 'plugin_ghost', {})).resolves.toBe(
      'There is no plugin called plugin_ghost.'
    )
  })

  it('does not match a plugin by its bare name, only by its tool name', async () => {
    const directory = pluginDir()
    writePlugin(directory, 'weather.mjs', GOOD_PLUGIN)
    const { plugins } = await loadAdamPlugins(directory)
    // `weather` is the plugin; `plugin_weather` is the tool. Matching the bare
    // name would let a foreign tool called `weather` reach plugin code.
    await expect(runPluginByToolName(plugins, 'weather', {})).resolves.toContain(
      'There is no plugin called weather.'
    )
  })
})

describe('pluginToolName', () => {
  it('prefixes every plugin tool so ownership is decidable by name', () => {
    expect(pluginToolName('weather')).toBe('plugin_weather')
    expect(pluginToolName('weather').startsWith(PLUGIN_TOOL_PREFIX)).toBe(true)
  })
})

describe('INVARIANT B — Adam may never write into the plugin directory', () => {
  // The shell half is covered in shell-tool.test.ts ("the plugin directory
  // (invariant B)"). This is the self-edit half: both doors must be shut, or
  // one approved innocuous-looking write becomes permanent unapproved code
  // execution on every launch.
  it('refuses a self-edit write into the plugin directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'selfedit-root-'))
    const result = resolveEditablePath(join(root, ADAM_PLUGINS_DIR_NAME, 'evil.mjs'), [root])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('protected directory')
    }
  })

  it('refuses a relative path into the plugin directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'selfedit-root-'))
    expect(resolveEditablePath(`${ADAM_PLUGINS_DIR_NAME}/evil.mjs`, [root]).ok).toBe(false)
  })

  it('refuses a path whose REAL target is inside the plugin directory', () => {
    // The lexical check alone passes here: nothing in "notes/evil.mjs" says
    // adam-plugins. Only resolving the link shows where the write lands.
    const root = mkdtempSync(join(tmpdir(), 'selfedit-root-'))
    const realPlugins = join(root, ADAM_PLUGINS_DIR_NAME)
    mkdirSync(realPlugins, { recursive: true })
    symlinkSync(realPlugins, join(root, 'notes'))

    const result = resolveEditablePath(join(root, 'notes', 'evil.mjs'), [root])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('protected directory')
    }
  })

  it('still allows an ordinary file in the same root', () => {
    // Guards against the rule being so broad it breaks self-edit entirely.
    // The parent must exist: the resolver realpaths it, and a missing folder is
    // a different refusal that would make this a false pass.
    const root = mkdtempSync(join(tmpdir(), 'selfedit-root-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    expect(resolveEditablePath(join(root, 'src', 'app.ts'), [root]).ok).toBe(true)
  })
})
