// Demo workspace content for the Buzz tab — mirrors the channel/thread layout
// from Block's Buzz README screenshot so the ported look reads 1:1.

export type BuzzChannel = {
  name: string
  locked?: boolean
  unread?: boolean
  active?: boolean
  badge?: string
}

export type BuzzSection = {
  label: string
  emoji?: string
  channels: BuzzChannel[]
}

export type BuzzDm = {
  name: string
  unread: number
  tone: string
}

export type BuzzReaction = {
  emoji: string
  count: number
}

export type BuzzMessage = {
  author: string
  time: string
  agent?: boolean
  tone: string
  /** Paragraph lines; `mention:` prefix renders an inline agent chip. */
  body: string[]
  list?: { title: string; items: string[] }[]
  footer?: string[]
  reactions?: BuzzReaction[]
}

export const BUZZ_SECTIONS: BuzzSection[] = [
  {
    label: 'The Hive',
    emoji: '🐝',
    channels: [
      { name: 'announcements', unread: true },
      { name: 'general', unread: true }
    ]
  },
  {
    label: 'Product',
    emoji: '🛠️',
    channels: [
      { name: 'design', unread: true },
      { name: 'flight-path', active: true, badge: '0s' },
      { name: 'mobile', unread: true }
    ]
  },
  {
    label: 'Launch Swarm',
    emoji: '🚀',
    channels: [
      { name: 'marketing', unread: true },
      { name: 'queen-bee-launch', locked: true, unread: true }
    ]
  }
]

export const BUZZ_LOCKED_CHANNELS: BuzzChannel[] = [{ name: 'Welcome', locked: true }]

export const BUZZ_DMS: BuzzDm[] = [
  { name: 'Jordan Brooks', unread: 1, tone: 'bg-sky-300' },
  { name: 'Maya Chen', unread: 1, tone: 'bg-rose-300' },
  { name: 'Priya Shah', unread: 1, tone: 'bg-amber-300' }
]

export const BUZZ_MESSAGES: BuzzMessage[] = [
  {
    author: 'Maya Chen',
    time: '3:25 PM',
    tone: 'bg-rose-300',
    body: ['Small thing: the desktop-to-mobile handoff still feels a little fast.']
  },
  {
    author: 'Jordan Brooks',
    time: '3:25 PM',
    tone: 'bg-sky-300',
    body: ['Yeah — I want one extra beat on the sent message.']
  },
  {
    author: 'Camille Dubois',
    time: '3:25 PM',
    tone: 'bg-violet-300',
    body: ['That would give the camera somewhere to land too.']
  },
  {
    author: 'Maya Chen',
    time: '3:25 PM',
    tone: 'bg-rose-300',
    body: ['mention:Fizz', 'can you turn that into a clean three-beat capture plan?'],
    reactions: [
      { emoji: '👀', count: 1 },
      { emoji: '💬', count: 1 }
    ]
  },
  {
    author: 'Fizz',
    time: '3:25 PM',
    agent: true,
    tone: 'bg-lime-300',
    body: ['Absolutely — clean three-beat capture plan:'],
    list: [
      {
        title: 'Desktop compose',
        items: [
          'Start on the project view.',
          'One clean cursor move into the update field.',
          'Type the short update without rushing.'
        ]
      },
      {
        title: 'Project header settle',
        items: [
          'After the transition, hold on the project header for a half beat.',
          'Let the context change become legible before moving on.',
          'Keep motion quick, but not slippery.'
        ]
      },
      {
        title: 'Mobile handoff / sent message',
        items: [
          'Cut to mobile.',
          'Let the sent message land and hold one extra beat.',
          'This gives the camera a clear final resting point.'
        ]
      }
    ],
    footer: [
      'Tiny rule of thumb: cursor moves once, transition breathes once, sent state lands once. Nice and buzzy 🐝✨',
      'mention:Honey',
      'over to you for the final capture pass.'
    ],
    reactions: [
      { emoji: '👀', count: 1 },
      { emoji: '💬', count: 1 }
    ]
  }
]
