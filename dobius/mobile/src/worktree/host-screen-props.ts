export type HostScreenProps = {
  // The tablet sidebar mounts without route focus and navigates into its detail pane.
  embedded?: boolean
  // Sidebar callers provide route data explicitly.
  hostId?: string
  action?: string
  onHideSidebar?: () => void
}
