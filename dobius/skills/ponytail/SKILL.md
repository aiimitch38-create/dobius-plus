---
name: ponytail
description: Preserve and apply Dobius-specific rationale comments, architecture guardrails, and "why this exists" context. Use when editing or reviewing Dobius code that already contains `ponytail:` comments, when adding non-obvious compatibility/safety/performance constraints, when restructuring modules, or when documenting decisions future agents must not accidentally undo.
---

# Ponytail

## Overview

Use this skill to keep Dobius changes aligned with the existing `ponytail:`
comment convention. Treat `ponytail:` as a compact marker for rationale that is
easy for future agents to search, preserve, and validate.

## Core Rule

Add or preserve `ponytail:` comments only for non-obvious constraints that a
competent engineer might otherwise remove or simplify incorrectly.

Good uses:

- explain a safety boundary;
- record a platform-specific constraint;
- document a performance tradeoff;
- mark an integration limitation;
- preserve a compatibility shim;
- warn that an apparent simplification breaks a known workflow.

Bad uses:

- restate what the code already says;
- tag ordinary TODOs;
- justify messy code that should be refactored;
- add narrative history that belongs in `BUILD-LOG.md` or a plan;
- create vague comments such as "important" or "do not change."

## Workflow

1. Search the touched area for existing `ponytail:` comments before editing.
2. Preserve existing `ponytail:` comments unless the underlying constraint is
   removed by the change.
3. If changing the behavior near an existing marker, update the comment in the
   same patch.
4. Add a new marker only when the rationale is durable and non-obvious.
5. Keep each marker short: one or two lines.
6. Validate the behavior with the narrowest relevant test or static check.

## Comment Format

Prefer this shape:

```ts
// ponytail: <why this constraint exists; what breaks if it is removed>.
```

For block comments:

```ts
/*
 * ponytail: <short rationale>.
 */
```

Use plain language. Name the constraint, not the implementation mechanics.

## Architecture Guardrails

When using this skill for Dobius architecture or restructuring:

- keep Electron process boundaries explicit: main, preload, renderer, shared,
  CLI, and relay should not import across layers casually;
- keep integrations behind adapters rather than leaking provider-specific logic
  into generic modules;
- prefer domain folders with precise names over broad `helpers`, `utils`,
  `common`, or `misc` buckets;
- keep runtime/build-monitor root files in place unless all references are
  updated;
- preserve cross-platform behavior for macOS, Linux, Windows, SSH, and remote
  workspace use cases;
- avoid broad watchers, synchronous hot-path work, and renderer-triggered
  high-frequency IPC loops.

## Validation Checklist

Before handing off a change made with this skill:

- run `rg -n "ponytail:" <touched-paths>` and confirm nearby rationale still
  matches behavior;
- run the smallest relevant test/typecheck/lint command;
- mention any intentionally preserved constraint in the final handoff when it
  materially affected the implementation;
- do not claim a full architecture cleanup if only guardrails or docs changed.

## Examples

Useful:

```ts
// ponytail: relay filters drop `until`, so client-side pagination owns the
// upper-bound check.
```

Not useful:

```ts
// ponytail: this function handles pagination.
```
