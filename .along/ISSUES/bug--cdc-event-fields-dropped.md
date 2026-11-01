---
protocol: along
protocol_version: "4.6.0"
slug: cdc-event-fields-dropped
type: bug
status: open
priority: high
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [cdc, engine, document]
blocked_by: []
related: []
---

# Engine cdc$ drops kind, data and rev that LiveDocument relies on

`getEngineAccess()` maps CDC events to `{ type, id, delta, mutationId, overlayId }` only. `LiveDocumentImpl.handleCDCEvent` (`src/document/liveDocument.ts`) reads `event.kind`, `event.data` and `event.rev`, which are therefore always undefined: replace events are applied as merges, the revision guard never runs, and a key deleted remotely can survive in the local committed data.

## Requirements
- REQ-1: Events delivered through `LiveEngineAccess.cdc$` MUST carry every field `handleCDCEvent` reads (`kind`, `data`, `rev`), or `handleCDCEvent` MUST be rewritten against the fields actually delivered.
- REQ-2: A remote replace MUST replace the committed body, including removing keys absent from the new body.

## Acceptance Criteria
- [ ] Regression test: remote replace removes a key locally.
- [ ] Regression test: an event with an older `rev` is ignored.
- [ ] `docs/topic--domain-model.md` CDC contract updated.
