// Which strings of a tool call's input the hard rails inspect.

function collectStrings(value: unknown, strings: string[] = []): string[] {
  if (typeof value === 'string') {
    strings.push(value)
    return strings
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, strings)
    }
    return strings
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectStrings(item, strings)
    }
  }
  return strings
}

// Why: prefix-agnostic on purpose — `/Users/$USER/.claude/...` or a variable
// holding the home dir cannot be expanded here, but the credential file names
// themselves are distinctive enough to deny wherever they appear.
export function rawStringMentionsCredential(value: string): boolean {
  return (
    /(^|[\s"'=:/\\])\.env(?:\.[^\s"'`;&|]*)?(?=$|[\s"'`;&|])/i.test(value) ||
    /(^|[\s"'=:/\\])\.credentials\.json(?=$|[\s"'`;&|)])/i.test(value) ||
    /\.claude[/\\]credentials[^\s"'`;&|]*/i.test(value) ||
    /\.dobius[/\\][^\s"'`;&|]*[/\\]token[^\s"'`;&|]*/i.test(value) ||
    /Library[/\\]Keychains(?:[/\\]|\s|$)/i.test(value)
  )
}

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

// Why: for file-editing tools only the TARGET PATH matters — scanning the content
// payload false-denies writing ".env" into a .gitignore or a README that mentions it.
export function stringsToInspect(
  toolName: string,
  input: unknown
): { field: string; raw: string }[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return collectStrings(input).map((raw) => ({ field: '', raw }))
  }
  const record = input as Record<string, unknown>
  if (FILE_EDIT_TOOLS.includes(toolName)) {
    return ['file_path', 'path', 'notebook_path']
      .map((field) => ({ field, raw: record[field] }))
      .filter((entry): entry is { field: string; raw: string } => typeof entry.raw === 'string')
  }
  return Object.entries(record).flatMap(([field, value]) =>
    collectStrings(value).map((raw) => ({ field, raw }))
  )
}
