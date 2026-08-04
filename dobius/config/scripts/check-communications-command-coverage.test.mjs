import { describe, expect, it } from 'vitest'

import { classifyCommand } from './communications-command-classification.mjs'
import { buildManifest, scanImplementedCommands } from './check-communications-command-coverage.mjs'

describe('classifyCommand', () => {
  it('routes Block/Builderlab-only commands to removed', () => {
    expect(classifyCommand('start_builderlab_login')?.disposition).toBe('removed')
    expect(classifyCommand('mesh_start_node')?.disposition).toBe('removed')
    expect(classifyCommand('confirm_pairing_sas')?.disposition).toBe('removed')
  })

  it('routes workflow commands to communications-service before the generic channel rule', () => {
    const classification = classifyCommand('get_channel_workflows')
    expect(classification?.disposition).toBe('communications-service')
    expect(classification?.feature).toBe('workflows')
  })

  it('routes agent lifecycle commands to dobius-rpc / package 3', () => {
    const classification = classifyCommand('start_managed_agent_runtime')
    expect(classification?.disposition).toBe('dobius-rpc')
    expect(classification?.package).toBe(3)
  })

  it('routes voice huddle commands to communications-service / package 6', () => {
    const classification = classifyCommand('start_huddle')
    expect(classification?.disposition).toBe('communications-service')
    expect(classification?.package).toBe(6)
  })

  it('routes generic channel commands to relay / package 2', () => {
    const classification = classifyCommand('create_channel')
    expect(classification?.disposition).toBe('relay')
    expect(classification?.package).toBe(2)
  })

  it('returns null for an unrecognized command instead of guessing', () => {
    expect(classifyCommand('totally_made_up_command_xyz')).toBeNull()
  })
})

describe('scanImplementedCommands', () => {
  it('extracts case labels from the bridge dispatch switch', () => {
    const source = `
      switch (command) {
        case "get_event":
          return handleGetEvent()
        case 'send_dobius_channel_message':
          return handleSend()
        default:
          throw new Error("not implemented")
      }
    `
    const implemented = scanImplementedCommands(source)
    expect(implemented.has('get_event')).toBe(true)
    expect(implemented.has('send_dobius_channel_message')).toBe(true)
    expect(implemented.size).toBe(2)
  })
})

describe('buildManifest', () => {
  it('marks an unrecognized command as unclassified and reports it separately', () => {
    const commands = new Map([['totally_made_up_command_xyz', 'foo.ts:1']])
    const { entries, unclassified } = buildManifest(commands, new Set())

    expect(unclassified).toEqual(['totally_made_up_command_xyz'])
    expect(entries[0].status).toBe('unclassified')
  })

  it('marks a classified, bridge-handled command as implemented', () => {
    const commands = new Map([['create_channel', 'foo.ts:1']])
    const { entries } = buildManifest(commands, new Set(['create_channel']))

    expect(entries[0].status).toBe('implemented')
    expect(entries[0].disposition).toBe('relay')
  })

  it('marks a classified, not-yet-handled command as pending', () => {
    const commands = new Map([['create_channel', 'foo.ts:1']])
    const { entries } = buildManifest(commands, new Set())

    expect(entries[0].status).toBe('pending')
  })

  it('marks a removed-disposition command as removed-pending while it is still callable', () => {
    const commands = new Map([['start_builderlab_login', 'foo.ts:1']])
    const { entries } = buildManifest(commands, new Set())

    expect(entries[0].status).toBe('removed-pending')
  })
})
