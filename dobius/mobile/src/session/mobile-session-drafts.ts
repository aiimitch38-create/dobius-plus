type DraftCandidate = { id: string; type: string; isActive: boolean }
type DraftDocument = { status: string; isDirty?: boolean }

/** Keep save-only phone edits reachable when their host tab disappears. */
export function retainMobileSessionDrafts<T extends DraftCandidate>(
  incoming: T[],
  current: readonly T[],
  documents: ReadonlyMap<string, DraftDocument>,
  selectedTabId: string | null
): T[] {
  const present = new Set(incoming.map((tab) => tab.id))
  const retained = current
    .filter((tab) => {
      const document = documents.get(tab.id)
      return (
        tab.type === 'markdown' &&
        !present.has(tab.id) &&
        document?.status === 'ready' &&
        document.isDirty
      )
    })
    .map((tab) => ({ ...tab, isActive: tab.id === selectedTabId }))
  return retained.length > 0 ? [...retained, ...incoming] : incoming
}
