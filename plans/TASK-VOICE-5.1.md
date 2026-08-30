# TASK-VOICE-5.1 — Opening line: evidence + attribution fix

**What:** Adam's scripted opening ("Something broke in X") is injected as
first_message; the brain never sees why it said it. Result (transcript
conv_7801m191...): he can't answer "what broke?" and re-attributes his own
opening to the user.

**Fix:**
1. `agent-context.ts`: remember the last opening line built (line, project,
   matched marker); `buildAgentContext` prepends a "Your opening line" section
   — standing rule ("the first message is yours, never the boss's") plus the
   specific line and terminal evidence marker when fresh.
2. Soften OPENERS_FAILED to observation phrasing ("Looks like...") — the
   classifier is a marker heuristic ('fail'/'error'/'exit code' substrings)
   and produces false positives.
3. `proactive-watcher.ts`: export `matchedMarker(tail)` so the evidence names
   the exact string that tripped the classifier.
4. Server-side ElevenLabs prompt PATCH (no rebuild): attribution rule.

**Test:** extend agent-opening/agent-context tests — failed opening stores
evidence; context contains the attribution rule and the marker.
**Risk:** low — additive; blast radius jarvis/ only.
