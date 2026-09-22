export type Surface =
  | 'review'
  | 'editor'
  | 'canvas'
  | 'command'
  | 'mission'
  | 'client'
  | 'campaign'
  | 'knowledge'

export const surfaces: { id: Surface; label: string }[] = [
  { id: 'command', label: 'Command Center' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'review', label: 'Review' },
  { id: 'editor', label: 'Image Editor' },
  { id: 'mission', label: 'Missions' },
  { id: 'client', label: 'Clients' },
  { id: 'campaign', label: 'Campaigns' },
  { id: 'knowledge', label: 'Knowledge' }
]
