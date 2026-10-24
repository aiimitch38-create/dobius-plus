import { describe, expect, it } from 'vitest'
import { codeFileMetadata } from './code-file-metadata'

describe('codeFileMetadata', () => {
  it('counts editor lines across Windows and Unix line endings', () => {
    expect(codeFileMetadata('a\r\nb\r\nc').lines).toBe(3)
    expect(codeFileMetadata('a\nb\n').lines).toBe(3)
    expect(codeFileMetadata('').lines).toBe(1)
  })
  it('reports UTF-8 bytes rather than JavaScript character count', () => {
    expect(codeFileMetadata('你好').size).toBe('6 B')
    expect(codeFileMetadata('a'.repeat(2400)).size).toBe('2.4 KB')
  })
})
