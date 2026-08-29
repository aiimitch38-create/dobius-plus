# TASK-ADAM-1.1 — Shell tool: classification and gate

> **Plan-file naming.** `plans/TASK-1.1.md` … `plans/TASK-4.3.md` already exist
> in this repo from the 2026-06 dashboard build. Overwriting committed design
> docs to satisfy a filename convention is a destructive no-op, so this build's
> plans are namespaced `TASK-ADAM-N.N.md` and gated with
> `bash scripts/verify-task.sh ADAM-N.N` (the script takes the task number as an
> argument, so the namespace works unchanged).

## Algorithm gate (steps 1–3, run once for the whole build)

1. **QUESTION.** The one requirement worth challenging is the classifier itself.
   With `execFile` + argv (no shell), what observably breaks without a
   classifier? Answer: everything — `rm -rf ~/Projects` is a single argv with no
   shell metacharacters at all. The classifier is load-bearing. Kept.
   The *shell-string parser* the original plan implied is not: it defends
   against operators that are already inert. Deleted (step 2).
2. **DELETE.** Cut: redirection/pipe/substitution parsing (inert by
   construction); a `tail -f` string analysis (the 30 s timeout covers it); a
   userData path-plumbing module for the plugin directory (the existing
   `FORBIDDEN_SEGMENTS` segment mechanism already does this in one word).
3. **SIMPLIFY.** Reuse `parseCommandArgs` from `agent-context.ts` rather than
   writing a second tokenizer. Reuse the `execFile` shape of `runCli`
   (`agent-context.ts:78`) rather than a new process helper.

Steps 4–5 (accelerate, automate) are re-run at the end of the build.

## What

`dobius/src/main/jarvis/shell-tool.ts` — pure classification only. No execution
in this task.

`classifyShellCommand(argv, options) -> { verdict: 'read-only' | 'writing' } |
{ verdict: 'denied', reason }`.

- **Read-only allowlist, by leading binary:** `ls, cat, head, tail, wc, df, du,
  ps, vm_stat, sw_vers, uptime, date, echo, which, pgrep, grep, find,
  networksetup, system_profiler`.
- **`osascript` is NOT read-only** — "get only" is not decidable from the argv
  and `osascript -e 'do shell script … with administrator privileges'` is a root
  escalation. Writing bucket, unconditionally.
- **A binary containing `/` is never allowlisted.** `/bin/ls` is fine but
  `/tmp/evil/ls` would otherwise inherit `ls`'s allowlist entry by basename.
  Any slash → writing bucket.
- **Argument scan** (forces `writing` even when the binary is allowlisted):
  `find` with `-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-fprint`,
  `-fprint0`, `-fprintf`, `-fls`; any `xargs` anywhere in the argv; any
  output-file flag (`-o`, `-O`, `--output`, `--output=…`, `--output-file`) —
  except `find`'s `-o`, which is the documented OR operator and is covered by
  find's own rule set.
- **Hard deny (never runnable at any approval level):** `sudo, su, dd, mkfs*,
  diskutil, shutdown, reboot, halt, killall, launchctl, csrutil, spctl,
  security, chown`; `chmod` with a recursive flag targeting a root-level system
  directory; and **any argument resolving inside the Adam plugin directory**
  (invariant B).

## Why

Invariant A says the model never authorises execution. That only matters if the
gate above it is honest about which commands need a human at all. Read-only is
the fast path; everything else is queued for the review window (TASK-ADAM-1.2);
the deny list is the set that no approval can unlock.

Invariant B: plugins are unsigned code loaded into the main process at startup.
One approved innocuous-looking write into that folder is permanent, unapproved
code execution on every launch. The deny is enforced here *and* in the self-edit
resolver (TASK-ADAM-4.1).

## Test

`shell-tool.test.ts`:
- the full classification table (each allowlisted binary → read-only; each
  denied binary → denied; unknown binary → writing; `osascript` → writing)
- every argument-scan case above
- a binary with a slash is not allowlisted
- **inertness:** `echo hello > /tmp/pwned-<unique>` classifies read-only, and
  running it through `execFile` creates no such file
- a plugin-directory path lands in the deny bucket, both by resolved
  containment and by the `adam-plugins` segment

## Risks

- **Allowlist too broad.** `find` is in it and `find` can execute. Mitigated by
  the dedicated argument scan; anything unrecognised falls to `writing`, which
  is the safe default rather than the permissive one.
- **Allowlist too narrow** costs only an extra approval click, so every
  ambiguity resolves toward `writing`.

## Estimate

~120 lines of source, ~150 of test. No IPC, no execution, no renderer change.
