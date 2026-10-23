export type PtyReattachStatelessQuery = {
  kind: 'da1' | 'pixel-14' | 'pixel-16' | 'osc-color'
  data: string
}

const ESC = '\x1b'
const CAN = '\x18'
const SUB = '\x1a'
const BEL = '\x07'
const C1_CSI = '\x9b'
const C1_OSC = '\x9d'
const C1_ST = '\x9c'
const C1_STRING_INTRODUCERS = new Set(['\x90', '\x98', '\x9e', '\x9f'])
const MAX_QUERY_CANDIDATE_LENGTH = 32

type FrameState = 'ground' | 'escape' | 'escape-intermediate' | 'csi' | 'osc' | 'string'

function buildQueries(): Map<string, PtyReattachStatelessQuery['kind']> {
  const queries = new Map<string, PtyReattachStatelessQuery['kind']>()
  queries.set(`${ESC}[c`, 'da1')
  queries.set(`${ESC}[0c`, 'da1')
  queries.set(`${ESC}[14t`, 'pixel-14')
  queries.set(`${ESC}[16t`, 'pixel-16')
  for (const slot of [10, 11] as const) {
    for (const body of slot === 10 ? ['?', '?;?'] : ['?']) {
      for (const terminator of [BEL, `${ESC}\\`]) {
        queries.set(`${ESC}]${slot};${body}${terminator}`, 'osc-color')
      }
    }
  }
  return queries
}

const QUERY_KINDS = buildQueries()

/** Keeps bounded VT framing for dropped bytes while answering only stateless queries. */
export function createPtyReattachQueryPreserver(
  onQuery: (query: PtyReattachStatelessQuery) => void
): {
  pushOverflowData: (data: string) => void
  continuePendingQuery: (data: string) => number
  reset: () => void
} {
  let state: FrameState = 'ground'
  let candidate = ''
  let stringEscape = false
  let oscCandidateValid = true
  const isGround = (): boolean => state === 'ground'

  const appendCandidate = (character: string): void => {
    if (candidate.length < MAX_QUERY_CANDIDATE_LENGTH) {
      candidate += character
    } else {
      candidate = ''
      oscCandidateValid = false
    }
  }

  const completeQuery = (terminator: string): void => {
    const data = candidate + terminator
    const kind = QUERY_KINDS.get(data)
    if (kind) {
      onQuery({ kind, data })
    }
    state = 'ground'
    candidate = ''
    oscCandidateValid = true
  }

  const pushCharacter = (character: string): void => {
    if (state === 'ground') {
      if (character === ESC) {
        state = 'escape'
        candidate = ESC
      } else if (character === C1_CSI) {
        state = 'csi'
        candidate = character
      } else if (character === C1_OSC) {
        state = 'osc'
        candidate = ''
        oscCandidateValid = false
      } else if (C1_STRING_INTRODUCERS.has(character)) {
        state = 'string'
        candidate = ''
        stringEscape = false
      }
      return
    }

    if (character === CAN || character === SUB) {
      state = 'ground'
      candidate = ''
      stringEscape = false
      oscCandidateValid = true
      return
    }

    if (state === 'escape') {
      appendCandidate(character)
      if (character === '[') {
        state = 'csi'
      } else if (character === ']') {
        state = 'osc'
      } else if (character === 'P' || character === '^' || character === '_' || character === 'X') {
        state = 'string'
        candidate = ''
        stringEscape = false
      } else if (character >= ' ' && character <= '/') {
        state = 'escape-intermediate'
      } else if (character >= '0' && character <= '~') {
        state = 'ground'
        candidate = ''
      } else if (character === ESC) {
        state = 'escape'
        candidate = ESC
      }
      return
    }

    if (state === 'escape-intermediate') {
      if (character >= ' ' && character <= '/') {
        appendCandidate(character)
      } else if (character >= '0' && character <= '~') {
        state = 'ground'
        candidate = ''
      } else if (character === ESC) {
        state = 'escape'
        candidate = ESC
      }
      return
    }

    if (state === 'csi') {
      if (character === ESC) {
        state = 'escape'
        candidate = ESC
      } else if (character === C1_ST) {
        state = 'ground'
        candidate = ''
      } else if (character >= '@' && character <= '~') {
        appendCandidate(character)
        completeQuery('')
      } else if (character >= ' ' && character <= '?') {
        appendCandidate(character)
      }
      return
    }

    if (state === 'osc') {
      if (character === BEL) {
        completeQuery(BEL)
      } else if (character === C1_ST) {
        completeQuery('')
      } else if (stringEscape && character === '\\') {
        appendCandidate(character)
        completeQuery('')
        stringEscape = false
      } else {
        if (oscCandidateValid) {
          appendCandidate(character)
          if (candidate.length === 0) {
            oscCandidateValid = false
          }
        }
        stringEscape = character === ESC
      }
      return
    }

    if (state === 'string') {
      if (character === C1_ST || (stringEscape && character === '\\')) {
        state = 'ground'
        stringEscape = false
      } else {
        stringEscape = character === ESC
      }
    }
  }

  return {
    pushOverflowData(data) {
      for (const character of data) {
        pushCharacter(character)
      }
    },
    continuePendingQuery(data) {
      if (isGround()) {
        return 0
      }
      for (let index = 0; index < data.length; index += 1) {
        pushCharacter(data[index] ?? '')
        if (isGround()) {
          return index + 1
        }
      }
      return data.length
    },
    reset() {
      state = 'ground'
      candidate = ''
      stringEscape = false
      oscCandidateValid = true
    }
  }
}
