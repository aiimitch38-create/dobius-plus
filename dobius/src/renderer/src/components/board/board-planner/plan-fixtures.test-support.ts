import type { PlanBoardSnapshot } from './plan-schema'

export const BOARD: PlanBoardSnapshot = {
  workspace: 'main',
  workspaces: [
    { name: 'main', current: true },
    { name: 'feature', current: false }
  ],
  consoles: [
    { name: 'Claude 1', agent: 'claude', role: 'review', status: 'idle', group: 'Team A' },
    { name: 'Claude 2', agent: 'claude', role: 'frontend', status: 'working', group: 'Team A' },
    { name: 'Codex 1', agent: 'codex', role: null, status: 'idle', group: null }
  ],
  groups: [{ name: 'Team A', members: ['Claude 1', 'Claude 2'] }],
  orchestrators: [{ name: 'Lead', wired: ['Claude 1'] }],
  presets: ['Command Deck'],
  markdownFiles: ['README.md'],
  loops: []
}
