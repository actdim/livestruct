---
protocol: along
protocol_version: "4.6.0"
slug: replace-commit-path-consistency
type: debt
status: open
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [document, commit, overlay]
blocked_by: []
related: []
---

# replace() bypasses CommitScheduler; debounced commits skip broadcastCommit

`LiveDocument.replace()` calls `updateDoc` directly, so it ignores the commit policy and sends no overlay. `broadcastCommit` is only sent on explicit flushes, so commits fired by the debounce timer rely on LiveStore CDC or the overlay TTL to clear tentative state in other tabs.

## Requirements
- REQ-1: The intended behaviour of `replace()` with respect to `CommitScheduler` and overlays MUST be decided and implemented consistently.
- REQ-2: Timer-driven commits MUST clear remote tentative state as promptly as explicit flushes, or the difference MUST be documented as intended.

## Acceptance Criteria
- [ ] Tests cover `replace()` under each commit policy.
- [ ] Test: a debounced commit clears the overlay in a second session.
- [ ] `docs/topic--02-core-concepts.md` describes the final behaviour.
