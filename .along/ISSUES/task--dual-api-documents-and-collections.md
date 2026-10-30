---
protocol: along
protocol_version: "4.5.4"
slug: dual-api-documents-and-collections
type: task
status: open
priority: high
created: 2026-10-30
updated: 2026-10-30
agent: antigravity
tags: [documents, collections, mobx, rxjs, api]
milestone: v2.0.0-along-transition
blocked_by: []
related: []
---

# Dual-Level API: LiveDocument and LiveCollection

## Objective
Implement RxDB-like high-level documents with MobX observable properties, `.patch()` mutations, and low-level `.engine` escape hatches.

## Requirements
- REQ-1: `LiveDocument` MUST expose synchronous `.data`, RxJS `.$`, and asynchronous `.patch(partial)`.
- REQ-2: `LiveDocument` MUST implement optimistic updates with echo suppression for local mutations.
- REQ-3: `LiveCollection` MUST provide `get(id)`, `create(id, initialData)`, and reactive `query$`.

## Acceptance Criteria
- [ ] `LiveDocument` updates emit on `.$` and update MobX observable getters.
- [ ] Concurrent mutations from neighboring tabs update local state without cursor jumps.
- [ ] `engine` property exposes low-level SQLite driver.
