import { describe, expect, it } from 'vitest'
import { assertFetchableUrl } from './media-url-guard'

describe('assertFetchableUrl', () => {
  it('accepts https and http URLs', () => {
    expect(() => assertFetchableUrl('https://relay.example/media/1')).not.toThrow()
    expect(() => assertFetchableUrl('http://relay.example/media/1')).not.toThrow()
  })

  it('rejects file: URLs', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow('Only http(s)')
  })

  it('rejects data: URLs', () => {
    expect(() => assertFetchableUrl('data:text/plain;base64,aGk=')).toThrow('Only http(s)')
  })

  it('rejects unparseable strings', () => {
    expect(() => assertFetchableUrl('not a url')).toThrow('Invalid URL')
  })
})
