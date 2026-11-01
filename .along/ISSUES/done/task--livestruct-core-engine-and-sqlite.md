---
protocol: along
protocol_version: "4.5.4"
slug: livestruct-core-engine-and-sqlite
type: task
status: done
completed: 2026-10-30
priority: high
created: 2026-10-30
updated: 2026-10-30
agent: antigravity
tags: [sqlite, livestore, opfs, engine]
blocked_by: []
related: []
---

# LiveStruct Core Engine and SQLite Storage Driver

## Objective
Implement the low-level LiveStore SQLite WASM driver and OPFS persistence integration for `@actdim/livestruct`.

## Requirements
- REQ-1: The engine MUST initialize embedded SQLite via LiveStore in browser OPFS or memory fallback.
- REQ-2: The engine MUST maintain generic document tables with support for JSON merge patch and binary BLOBs.
- REQ-3: The engine MUST expose raw query and CDC (Change Data Capture) observable streams.

## Acceptance Criteria
- [x] SQLite connection initializes in OPFS with memory fallback.
- [x] Universal document schema created with json_patch support.
- [x] CDC observable stream emits verified insert/update/delete events.
