# Dobius V1 and V2 Engine Comparison

## Simple summary

- **V1** is the original Status Digital version. It is smaller, easier to understand, and focused on the team's everyday workflow.
- **V2** is the stronger underlying engine. It supports more agents, better terminals, remote work, browser control, integrations, and substantially more testing.
- **Our direction:** keep the V2 engine and bring the best V1 workflows and simplicity into it.

## Compare and contrast

| Area | V1 engine | V2 engine |
| --- | --- | --- |
| Main purpose | Focused Status Digital workflow | General multi-agent development platform |
| AI agents | Primarily Claude | Claude, Codex, Gemini, Copilot, OpenCode, Cursor, Devin, and others |
| Terminals | Simple project terminals | Persistent terminals, grids, restored sessions, SSH, remote terminals, and deeper customization |
| Session handling | Strong automatic Claude resume behavior | Broader multi-agent cold restore, session recovery, SSH fallback, and AI Vault discovery |
| Dashboard | Simple and operationally focused | More powerful, but currently busier and more complex |
| Voice Conductor | Complete original Status Digital workflow | Stronger architecture; the V1 workflow is being ported and completed |
| Build monitoring | Dedicated progress and supervisor dashboard | General observability exists, but the focused V1 Build Monitor is missing |
| Visual preview | Simple live preview and deployment buttons | Much stronger browser engine, but missing the same one-click preview/deploy workflow |
| Mobile access | Phone PWA over Tailscale | Better RPC foundation, but the V1 mobile workflow is not fully recreated |
| Tasks | Status Digital stage pipeline | More flexible tasks and automations, but V1's exact pipeline is not yet central |
| Integrations | A smaller set of direct integrations | GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, Jira, Linear, Asana, iMessage, and more |
| Browser control | Basic project preview | Full browser sessions, automation, screenshots, streaming, downloads, and computer use |
| Remote work | Mostly local | Local, SSH, remote sessions, and cross-platform support |
| Codebase | Smaller JavaScript application | Modular TypeScript application |
| Automated tests | Very limited | Extensive unit and integration test coverage |
| Best quality | Simplicity and team-specific workflow | Technical strength, extensibility, reliability, and capabilities |

## What V2 does better

- Supports many AI agents instead of primarily Claude.
- Provides a more powerful persistent terminal and session system.
- Supports SSH and remote projects.
- Includes native agent chat and AI Vault session discovery.
- Includes full browser automation and computer-use capabilities.
- Supports more source-control providers and work-management integrations.
- Uses typed services and IPC boundaries.
- Has extensive automated tests.
- Is a better foundation for long-term development.

## What V1 still does better

- Presents a simpler dashboard for daily Status Digital work.
- Includes a focused Build Monitor.
- Provides a simple Visual preview and deployment workflow.
- Includes an established mobile/Tailscale workflow.
- Has the original complete Voice Conductor experience.
- Can read Claude's latest response aloud.
- Uses the familiar Status Digital task stages:

  `Intake -> Queued -> Building -> Review -> Ship Test -> Approval -> Done`

## What should be brought from V1 into V2

1. Finish the Voice Conductor workflow.
2. Add a simplified Status Digital dashboard mode.
3. Recreate the focused Build Monitor.
4. Add the one-click Visual preview and controlled deployment flow.
5. Complete secure mobile access over Tailscale.
6. Restore the Speak Last Response feature.
7. Add the Status Digital task pipeline as a V2 workflow template.
8. Add a clear in-app walkthrough and behavior checklist.

## Final decision

We should **not replace V2 with V1**.

We should use:

> **V2's engine with V1's simplicity and Status Digital workflows.**

This keeps the stronger terminals, agents, browser tools, remote support, integrations, and testing while restoring the parts of V1 that made Dobius straightforward for the team to use.
