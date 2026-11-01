---
protocol: along
protocol_version: "4.6.0"
slug: readme-claims-mismatch
type: docs
status: open
priority: low
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [readme]
blocked_by: []
related: []
---

# README claims mutable doc.data and blob access via doc.engine

README states "Mutable MobX properties: `doc.data.name`", but `doc.data` is deeply frozen; property-style writes only work through `toObservableDocument(doc)`. It also says `doc.engine` gives content-addressed BLOB access, but `LiveEngineAccess` can only write blobs (`commitRaw({ blobs })`); reading needs `store.engine.getDoc()`.

## Requirements
- REQ-1: README MUST describe mutation through `patch*` / `toObservableDocument` and blob read/write as the code implements them.

## Acceptance Criteria
- [ ] README statements match `src/` and the KB topics.
- [ ] `along kb-sync` recompiled `llms-full.txt`.
