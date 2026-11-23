import { describe, expect, it, vi } from 'vitest'
import { matchQuickHand, runQuickHand, type QuickHandsDeps } from './live-voice-quick-hands'
import {
  branchLabel,
  cleanTitle,
  matchTerminals,
  spokenWords,
  whichOneQuestion,
  type QuickTerminal
} from './live-voice-terminal-target'

// Shaped like Carson's real list: names repeat across projects, Claude topic
// titles carry spinner glyphs, untitled tabs fall back to their branch.
const REAL: QuickTerminal[] = [
  { handle: 'a', name: 'Terminal 1', project: 'SMID' },
  { handle: 'b', name: 'Terminal 1', project: 'Website' },
  { handle: 'c', name: 'Terminal 1', project: 'FEATURES-HUB' },
  { handle: 'd', name: 'Terminal 2', project: 'SMID' },
  { handle: 'e', name: 'SMID', labels: ['SMID'], project: 'SMID' },
  { handle: 'f', name: 'Submit SMIDs', project: 'SMID' },
  { handle: 'g', name: 'Terminal 1', project: 'epoxy-site' },
  { handle: 'h', name: 'quick-hands', project: 'WB-quick-hands' },
  { handle: 'i', name: 'Notes', labels: ['My notes', 'Notes'], project: 'Website' }
]

const ids = (hits: QuickTerminal[]): string[] => hits.map((hit) => hit.handle).sort()

describe('names', () => {
  it('drops spinner and status glyphs from titles', () => {
    expect(cleanTitle('⠦ SMID')).toBe('SMID')
    expect(cleanTitle('✳ Fix login bug')).toBe('Fix login bug')
    expect(cleanTitle('  ● ✻ Build')).toBe('Build')
    expect(cleanTitle(null)).toBe('')
  })

  it('drops refs/heads/ and the owner/ prefix from a branch', () => {
    expect(branchLabel('refs/heads/aiimitch38-create/FEATURES-HUB')).toBe('FEATURES-HUB')
    expect(branchLabel('aiimitch38-create/SMID')).toBe('SMID')
    expect(branchLabel('refs/heads/main')).toBe('main')
    expect(branchLabel('')).toBe('')
  })

  it('reads number words as digits', () => {
    expect(spokenWords('Terminal one')).toBe('terminal 1')
    expect(spokenWords('terminal Twenty')).toBe('terminal 20')
    expect(spokenWords('Terminal 12')).toBe('terminal 12')
    expect(spokenWords('someone')).toBe('someone')
  })
})

describe('matchTerminals', () => {
  it('a repeated name matches every terminal that has it', () => {
    expect(ids(matchTerminals(REAL, 'terminal 1', 'exact'))).toEqual(['a', 'b', 'c', 'g'])
  })

  it('narrows by project: "Terminal 1 in SMID", "terminal one in epoxy", "SMID terminal 1"', () => {
    expect(ids(matchTerminals(REAL, 'terminal 1 in smid', 'exact'))).toEqual(['a'])
    expect(ids(matchTerminals(REAL, 'terminal one in epoxy', 'exact'))).toEqual(['g'])
    expect(ids(matchTerminals(REAL, 'smid terminal 1', 'exact'))).toEqual(['a'])
    expect(ids(matchTerminals(REAL, 'terminal 1 in features hub', 'exact'))).toEqual(['c'])
  })

  it('a name beats a project of the same name; a project alone picks its terminals', () => {
    expect(ids(matchTerminals(REAL, 'smid', 'exact'))).toEqual(['e'])
    expect(ids(matchTerminals(REAL, 'wb quick hands', 'exact'))).toEqual(['h'])
  })

  it('answers to every label (tab rename and pane title)', () => {
    expect(ids(matchTerminals(REAL, 'my notes', 'exact'))).toEqual(['i'])
    expect(ids(matchTerminals(REAL, 'notes', 'exact'))).toEqual(['i'])
  })

  it('project words are whole words', () => {
    expect(matchTerminals(REAL, 'terminal 1 in epo', 'exact')).toEqual([])
  })
})

describe('whichOneQuestion', () => {
  it('asks by project when the names are the same', () => {
    expect(whichOneQuestion(REAL.slice(0, 3))).toBe(
      'Three are called Terminal 1: in SMID, Website, and FEATURES-HUB. Which one?'
    )
  })
  it('lists the names otherwise', () => {
    expect(whichOneQuestion([REAL[3], REAL[4]])).toBe('Two match: Terminal 2 and SMID. Which one?')
  })
  it('is null for one, none, more than five, or hits the voice cannot tell apart', () => {
    expect(whichOneQuestion([REAL[0]])).toBeNull()
    expect(whichOneQuestion([])).toBeNull()
    expect(whichOneQuestion(REAL.slice(0, 6))).toBeNull()
    expect(
      whichOneQuestion([
        { handle: 'x', name: 'Terminal 1', project: 'SMID' },
        { handle: 'y', name: 'Terminal 1', project: 'SMID' }
      ])
    ).toBeNull()
  })
})

describe('quick hands on the real list', () => {
  const typeInto = vi.fn(async () => undefined)
  const deps = (): QuickHandsDeps => ({
    listTerminals: async () => ({ terminals: REAL, truncated: false }),
    typeInto,
    readTail: async () => ['all good']
  })

  it('types into "Terminal 1 in SMID" and nowhere else', async () => {
    typeInto.mockClear()
    expect(await runQuickHand('type ls into terminal one in SMID', deps())).toEqual({
      name: 'type',
      speak: 'Typed it into Terminal 1.'
    })
    expect(typeInto).toHaveBeenCalledWith('a', 'ls', expect.any(Function))
  })

  it('asks which one, and writes nothing, when the name repeats', async () => {
    typeInto.mockClear()
    expect((await runQuickHand('type ls into terminal 1', deps()))?.speak).toBe(
      'Four are called Terminal 1: in SMID, Website, FEATURES-HUB, and epoxy-site. Which one?'
    )
    expect(typeInto).not.toHaveBeenCalled()
  })

  it('a submit word in the terminal name is fine: "type hello into Submit SMIDs"', async () => {
    typeInto.mockClear()
    expect(matchQuickHand('type hello into Submit SMIDs')).toEqual({
      hand: 'type',
      text: 'hello',
      target: 'submit smids'
    })
    expect((await runQuickHand('type hello into Submit SMIDs', deps()))?.speak).toBe(
      'Typed it into Submit SMIDs.'
    )
    expect(typeInto).toHaveBeenCalledWith('f', 'hello', expect.any(Function))
  })

  it('"type ls in terminal 1 in smid" is two-way ambiguous and goes to ADAM', () => {
    expect(matchQuickHand('type ls in terminal 1 in smid')).toBeNull()
  })

  it('reads "the SMID terminal" and asks about "terminal 1"', async () => {
    expect((await runQuickHand("what's the SMID terminal doing", deps()))?.speak).toBe(
      'SMID last showed: all good'
    )
    expect((await runQuickHand("what's terminal 2 in smid doing", deps()))?.speak).toBe(
      'Terminal 2 last showed: all good'
    )
    expect((await runQuickHand('read terminal 1', deps()))?.speak).toContain('Which one?')
  })
})
