# TASK-10: Telegram bot bridge for Carson
What: copy the iMessage bridge to Telegram: encrypted token, pairing via /start, allowlisted numeric user id, private chat only, skip backlog, @Agent route (read-only, budget cap) and command route (terminal-send guard + pause gate). Per-agent toggle.
Simplification: generalise agent-channel-service.ts instead of a second copy; raw https like destination-delivery.ts:27, no new SDK.
Acceptance: unit tests mirroring imessage bridge-service tests (allowlist, backlog skip, at-most-once); live: message @Adam from Telegram, get one reply; message from another account is ignored.
Estimate: 3-4 days (estimate). Approve-from-phone and /tabs commands are out of scope.
