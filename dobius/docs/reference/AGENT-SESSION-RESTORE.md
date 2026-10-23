# Automatic agent session restore

Automatic restore reopens an agent provider session only when Dobius can prove
which terminal pane owned it before sleep or quit. A provider session ID alone
is not enough: duplicate or stale status rows can point at a different pane,
PTY, worktree, or SSH host.

## Ownership evidence

A persisted automatic-resume owner binds the provider session to its execution
authority and terminal identity: local or the exact SSH connection, worktree,
stable tab and layout leaf, pane key, per-leaf PTY ID, launch token, agent, and
provider session key and ID. Capture records this proof only when the live hook
launch identity agrees with the current PTY bound to that stable leaf. The
workspace-session schema retains old records that lack proof for manual
recovery, but does not promote them to automatic-resume authority.

## Restore flow

The startup sweep and the restored pane both request the main process's
single-consumer claim before creating or spawning a replacement agent. The
claim is keyed by execution authority and provider session; the exact owner
fingerprint binds retries to the same pane and launch generation. At the PTY
claim boundary, main issues an explicit target for a fresh pane within the
source worktree and execution authority. Both renderer IPC and runtime PTY
spawn paths compare that target with the actual worktree and local/SSH
connection, then verify the same target and owner against the in-memory claim.
The internal marker is removed before the environment reaches the shell.

If a trusted hook snapshot is present, its launch token, agent type, PTY,
provider session, worktree, and authority must all match the owner. After an
app restart, the snapshot may be absent; the captured sleeping owner plus the
exact persisted leaf-to-PTY binding remains sufficient. A conflicting present
snapshot fails closed. The source sleeping record stays persisted while a
resume is queued and while only a fallback shell is known to have started; a
matching successful provider spawn clears it and its duplicate aliases. A
provider spawn failure leaves the source evidence and permits retry by the
same exact owner.

For an intentional app restart, the persisted owner is sufficient when the
current runtime has no live status row: the validated sleeping record and
per-leaf PTY hint preserve the prior runtime's identity. A conflicting live
provider-session alias, an ambiguous legacy record, a changed PTY binding, or
an unverified SSH connection refuses automatic provider launch. Such records
remain available for manual recovery. A plain shell with no agent-resume
evidence can still recover as a plain shell.

## Validation

Focused regressions live in `src/shared/agent-resume-owner.test.ts`,
`src/main/pty/agent-resume-claims.test.ts`,
`src/renderer/src/store/slices/agent-status-quit-capture.test.ts`,
`src/renderer/src/lib/resume-sleeping-agent-session.test.ts`,
`src/renderer/src/lib/resume-sleeping-agent-session-replay.test.ts`, and
`src/renderer/src/components/terminal-pane/pty-connection.test.ts`. These prove
schema, ownership, single-claim, capture, split-pane, local/SSH, restart, and
legacy refusal logic; they do not prove live-machine or physical-device
behavior. The runtime and renderer PTY spawn targets are covered independently,
including wrong-worktree refusal before provider spawn.
