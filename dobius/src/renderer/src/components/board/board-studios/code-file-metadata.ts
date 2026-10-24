export function codeFileMetadata(content: string): { lines: number; size: string } {
  const bytes = new TextEncoder().encode(content).length
  const size =
    bytes < 1000
      ? `${bytes} B`
      : bytes < 1_000_000
        ? `${(bytes / 1000).toFixed(1)} KB`
        : `${(bytes / 1_000_000).toFixed(1)} MB`
  return { lines: content.split(/\r\n|\r|\n/).length, size }
}

export function codeLanguageLabel(language: string): string {
  const labels: Record<string, string> = {
    plaintext: 'Text',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    markdown: 'Markdown',
    shell: 'Shell',
    yaml: 'YAML',
    python: 'Python'
  }
  return labels[language] ?? language.charAt(0).toUpperCase() + language.slice(1)
}
