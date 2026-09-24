export type TextToolResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

export function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }] }
}

export function errorResult(text: string): TextToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

export function trimText(value: string, maxLength: number): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, maxLength), truncated: true }
}
