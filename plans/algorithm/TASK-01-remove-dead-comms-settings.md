# TASK-01: Remove Mesh Compute + Hosted Communities settings
What: delete both Channels settings cards and their code. Why: visible UI with no backend; clicking does nothing.
Simplification: delete, don't build (Carson approved 2026-11-21). Mounts at features/settings/ui/SettingsPanels.tsx:827,833; files features/mesh-compute/, HostedCommunitiesSettingsCard.tsx, HostedCommunityOnboarding.tsx, shared/api/tauriMesh.ts.
Acceptance: grep finds no mesh_/builderlab_ invokes; typecheck + build exit 0; Settings > Channels screenshot shows neither card.
Estimate: 30-60 min (estimate).
