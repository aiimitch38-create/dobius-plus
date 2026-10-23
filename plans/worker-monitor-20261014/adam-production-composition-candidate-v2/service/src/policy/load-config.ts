import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { AuthorityConfigSchema, type AuthorityConfig } from './schema.js'

export async function loadAuthorityConfig(path: string): Promise<AuthorityConfig> {
  const text = await readFile(path, 'utf8')
  return AuthorityConfigSchema.parse(parse(text))
}

