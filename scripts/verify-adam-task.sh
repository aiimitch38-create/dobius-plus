#!/bin/bash
# scripts/verify-adam-task.sh — gate for the Adam control build.
# Usage: bash scripts/verify-adam-task.sh 1.1
#
# Why this exists instead of scripts/verify-task.sh: that script was written for
# the 2026-06 dashboard app that lives at the REPO ROOT (src/, vite build,
# DashboardView.jsx). This build targets the Electron app in dobius/. Run against
# this build, the old script:
#   - builds the WRONG app (root `npx vite build`), so it reports "Builds clean"
#     even if dobius/ is completely broken;
#   - fails permanently on a pre-existing `// eslint-disable` in the old root
#     src/, which this build is forbidden to touch;
#   - checks plans/TASK-N.N.md, which already exist from that old build, so the
#     plan/review checks pass without the agent writing anything.

set -uo pipefail

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "FAIL: usage: bash scripts/verify-adam-task.sh <task-number, e.g. 1.1>"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

APP="$REPO_ROOT/dobius"
PLAN="plans/TASK-ADAM-${TASK}.md"
REVIEW="plans/TASK-ADAM-${TASK}-REVIEW.md"

# The scoped baseline. See AUTONOMOUS-BUILD.md — the repo carries 566
# pre-existing failures outside this scope that are not this build's to fix.
TEST_SCOPE="src/main/jarvis src/main/window src/renderer/src/components/jarvis"
BASELINE_PASSING=221
EXPECTED_FAILING_FILE="attach-main-window-services.test.ts"

PASS=true
fail() { echo "FAIL: $1"; PASS=false; }
ok()   { echo "OK   $1"; }

echo "=== Verifying TASK-ADAM-$TASK ==="
echo ""

# 1-2. Plan and review must exist, in the ADAM namespace.
[ -f "$PLAN" ]   && ok "plan exists ($PLAN)"     || fail "$PLAN does not exist."
[ -f "$REVIEW" ] && ok "review exists ($REVIEW)" || fail "$REVIEW does not exist."

# 3. Latest commit references this task.
LAST_COMMIT=$(git log -1 --format=%s 2>/dev/null || echo "")
if echo "$LAST_COMMIT" | grep -qiE "ADAM-${TASK}|TASK ${TASK}"; then
  ok "commit references the task"
else
  fail "latest commit does not reference ADAM-${TASK}. Last: '$LAST_COMMIT'"
fi

# 4. Feature branch, and the right one.
BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
if [ "$BRANCH" = "feat/adam-voice-control" ]; then
  ok "on branch $BRANCH"
else
  fail "on '$BRANCH' — this build is pinned to feat/adam-voice-control."
fi

# 5. Blast radius: nothing committed outside the allowed paths.
CHANGED=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)
OUTSIDE=$(echo "$CHANGED" | grep -vE '^(dobius/src/(main/(jarvis|window)|renderer/src/components/(jarvis|settings)|preload|shared/speech-types\.ts)|plans/|scripts/verify-adam-task\.sh|BUILD-LOG\.md|HANDOFF\.md|LESSONS-LEARNED\.md|AUTONOMOUS-BUILD\.md|claude-progress\.json)' | grep -v '^$' || true)
if [ -z "$OUTSIDE" ]; then
  ok "commit stays inside the blast radius"
else
  fail "commit touches files outside the allowed paths:"
  echo "$OUTSIDE" | sed 's/^/       /'
fi

# 6. Typechecks — both configs, from the app directory.
echo ""
echo "--- Typecheck ---"
if (cd "$APP" && npx tsgo --noEmit -p config/tsconfig.node.json >/tmp/adam-tc-node.log 2>&1); then
  ok "node typecheck"
else
  fail "node typecheck. Tail:"; tail -15 /tmp/adam-tc-node.log | sed 's/^/       /'
fi
if (cd "$APP" && npx tsgo --noEmit -p config/tsconfig.tc.web.json >/tmp/adam-tc-web.log 2>&1); then
  ok "web typecheck"
else
  fail "web typecheck. Tail:"; tail -15 /tmp/adam-tc-web.log | sed 's/^/       /'
fi

# 7. Scoped tests against the pinned baseline.
echo ""
echo "--- Tests (scoped) ---"
(cd "$APP" && npx vitest run $TEST_SCOPE --reporter=dot >/tmp/adam-tests.log 2>&1)
PASSED=$(grep -oE 'Tests +[0-9]+ passed' /tmp/adam-tests.log | grep -oE '[0-9]+' | tail -1)
PASSED=${PASSED:-0}
FAILED_TESTS=$(grep -oE 'Tests +[0-9]+ failed' /tmp/adam-tests.log | grep -oE '[0-9]+' | tail -1)
FAILED_TESTS=${FAILED_TESTS:-0}
FAILED_FILES=$(grep -oE 'Test Files +[0-9]+ failed' /tmp/adam-tests.log | grep -oE '[0-9]+' | tail -1)
FAILED_FILES=${FAILED_FILES:-0}

if [ "$PASSED" -lt "$BASELINE_PASSING" ]; then
  fail "only $PASSED tests passing, baseline is $BASELINE_PASSING. You lost tests."
else
  ok "$PASSED tests passing (baseline $BASELINE_PASSING)"
fi

if [ "$FAILED_TESTS" -gt 0 ]; then
  fail "$FAILED_TESTS individual tests failing:"
  grep -E '^\s*(FAIL|×)' /tmp/adam-tests.log | head -10 | sed 's/^/       /'
fi

if [ "$FAILED_FILES" -gt 1 ]; then
  fail "$FAILED_FILES test files failing — only the known one is allowed ($EXPECTED_FAILING_FILE):"
  grep -E '^\s*FAIL' /tmp/adam-tests.log | head -10 | sed 's/^/       /'
elif [ "$FAILED_FILES" -eq 1 ]; then
  if grep -qE "FAIL.*$EXPECTED_FAILING_FILE" /tmp/adam-tests.log; then
    ok "one failing file, and it is the known pre-existing one"
  else
    fail "one failing file, but NOT the expected $EXPECTED_FAILING_FILE:"
    grep -E '^\s*FAIL' /tmp/adam-tests.log | head -5 | sed 's/^/       /'
  fi
else
  ok "no failing test files"
fi

# 8. Lint every source file this commit touched.
echo ""
echo "--- Lint ---"
LINT_TARGETS=$(echo "$CHANGED" | grep -E '^dobius/src/.*\.(ts|tsx)$' | sed 's|^dobius/||' || true)
if [ -z "$LINT_TARGETS" ]; then
  ok "no source files in this commit to lint"
else
  # zsh/bash word-splitting: feed the list on stdin, never unquoted expansion.
  if (cd "$APP" && echo "$LINT_TARGETS" | tr '\n' '\0' | xargs -0 npx oxlint >/tmp/adam-lint.log 2>&1); then
    ok "oxlint clean on $(echo "$LINT_TARGETS" | wc -l | tr -d ' ') file(s)"
  else
    fail "oxlint findings:"; tail -20 /tmp/adam-lint.log | sed 's/^/       /'
  fi
fi

# 9. Type suppressions in the files this commit touched.
if [ -n "$LINT_TARGETS" ]; then
  SUPPRESS=$(cd "$APP" && echo "$LINT_TARGETS" | tr '\n' '\0' | xargs -0 grep -l '@ts-ignore\|@ts-nocheck' 2>/dev/null || true)
  if [ -z "$SUPPRESS" ]; then
    ok "no @ts-ignore / @ts-nocheck"
  else
    fail "type suppressions found in: $SUPPRESS"
  fi
fi

# 10. Logs.
echo ""
grep -q "ADAM-${TASK}" BUILD-LOG.md 2>/dev/null \
  && ok "BUILD-LOG.md has an entry" \
  || fail "BUILD-LOG.md has no ADAM-${TASK} entry."
grep -q "ADAM-${TASK}\|${TASK}" HANDOFF.md 2>/dev/null \
  && ok "HANDOFF.md mentions the task" \
  || fail "HANDOFF.md does not mention ADAM-${TASK}."

echo ""
echo "==========================================="
if [ "$PASS" = true ]; then
  echo "PASS: TASK-ADAM-$TASK verified."
  exit 0
fi
echo "FAIL: TASK-ADAM-$TASK has failures. Fix and re-run."
exit 1
