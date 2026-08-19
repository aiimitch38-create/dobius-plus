import { describe, expect, it } from 'vitest'

import { contactsFromTags, contactsToTags } from './contact-list-projection'

describe('contactsFromTags', () => {
  it('reads pubkey, relayUrl, and petname from a full p tag (happy path)', () => {
    expect(contactsFromTags([['p', 'pk-1', 'wss://relay.example', 'Alice']])).toEqual([
      { pubkey: 'pk-1', relayUrl: 'wss://relay.example', petname: 'Alice' }
    ])
  })

  it('leaves relayUrl and petname undefined when absent', () => {
    expect(contactsFromTags([['p', 'pk-1']])).toEqual([{ pubkey: 'pk-1', relayUrl: undefined, petname: undefined }])
  })

  it('ignores non-p tags (failure path: unrelated tags in the same event)', () => {
    expect(contactsFromTags([['d', 'ignored'], ['p', 'pk-1']])).toEqual([{ pubkey: 'pk-1', relayUrl: undefined, petname: undefined }])
  })

  it('returns an empty list for an event with no contacts (failure path)', () => {
    expect(contactsFromTags([])).toEqual([])
  })
})

describe('contactsToTags', () => {
  it('builds a p tag per contact, lowercasing the pubkey and defaulting missing fields to empty strings', () => {
    expect(contactsToTags([{ pubkey: 'PK-1', relay_url: 'wss://relay.example', petname: 'Alice' }, { pubkey: 'pk-2' }])).toEqual([
      ['p', 'pk-1', 'wss://relay.example', 'Alice'],
      ['p', 'pk-2', '', '']
    ])
  })

  it('returns an empty tag list for an empty contact list (failure path: clearing all contacts)', () => {
    expect(contactsToTags([])).toEqual([])
  })
})
