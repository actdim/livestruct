---
protocol: along
protocol_version: "4.5.4"
slug: dnd-freeze-dual-iframe
type: bug
status: done
completed: 2026-11-01
priority: high
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [perf, sync, dnd]
blocked_by: []
related: []
write_scope: [../../../.claude/launch.json, ../livestruct]
---
# DnD freezes with two iframe viewports; make sync lazy but fast

## Problem

dragging a shape freezes, visibly with two iframe viewports. After livestruct #2/#3 the demo
must use the library like a plain object and contain no sync/persistence logic of its own.

Launch position: **4** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Context

**What the user expects.** livestruct must feel like a plain in-memory object: `doc.patch(...)` and
`doc.data` are instant, heavy work (SQLite, OPFS, cross-tab sync) happens in the background, by design
of the core library, not the demo. Dragging a shape (also in "Dual iframe Split": host + 2 same-origin
iframes on ONE main thread) must produce zero long tasks.

**Why it does not today (verified).**
- The original spec (`task--livestruct-core-engine-and-sqlite`, marked done) required "embedded SQLite via
  LiveStore in browser OPFS". It was never implemented: no `@livestore/*` dependency exists.
  `LiveSqliteEngine` is a `Map` on the UI thread; every write does `JSON.stringify` of the whole store and
  rewrites one OPFS file via `createWritable` before CDC is emitted (`sqliteEngine.ts:81,122,168,195,395-436`).
  `queryRaw` parses SQL with regexes. README/package.json claim LiveStore.
- Every same-origin context writes the same file (last writer wins, lock retries 25..125 ms x5, errors swallowed).
- livestruct-demo replicates mutations itself over BroadcastChannel and publishes every mousemove twice.

**LiveStore 0.5.0 facts this plan relies on** (verified from published sources and the repo on 2026-11-01;
the spike re-verifies them):
- `store.commit(...events)` is synchronous: it materializes into the session's in-memory SQLite (WASM) on
  the UI thread, re-runs affected subscriptions synchronously, and queues a push to the leader.
- Web adapter `makePersistedAdapter({ storage: { type: 'opfs' }, worker, sharedWorker })`: a leader
  dedicated worker (elected by Web Locks) is the single OPFS writer; a SharedWorker connects tabs.
  Other sessions pull committed events asynchronously and fire their subscriptions.
- Every commit is an eventlog entry forever (no compaction; schema change replays the whole log).
  LiveStore's own guidance: keep fast-changing values (drag, typing) outside and commit debounced.
- `makeInMemoryAdapter()` from `@livestore/adapter-web` works in Vitest node env (LiveStore's own tests),
  with the alias `@livestore/wa-sqlite/dist/wa-sqlite.mjs -> wa-sqlite.node.mjs`.
- Peers: `effect@^4.0.3` and the `@effect/*` 4.x cohort, `@opentelemetry/api`, `@standard-schema/spec`.
- Same-origin iframes share `sessionStorage` -> same default `sessionId`; pass a unique `sessionId` per context.
- Defaults to override when embedding: `confirmUnsavedChanges` (beforeunload prompt), devtools.
- Event args are JSON; binary in events bloats the log permanently.

**Target architecture**
```text
 UI thread (each tab / iframe)                                  background
 +-----------------------------------------------+   async   +-----------------------+
 | LiveDocument / LiveCollection (livestruct API) |  push     | leader dedicated      |
 |  view = committed row + local overlay          | --------> | worker (one per       |
 |  patch(): overlay update, sync emit, O(1)      |           | storeId): OPFS SQLite |
 |  CommitScheduler: coalesce -> 1 store.commit   | <-------- | eventlog, cross-tab   |
 |  OverlayChannel: frame-coalesced tentative     |  pull     | via SharedWorker      |
 |    values to other contexts (BroadcastChannel) |           +-----------------------+
 |  LiveStore client session (in-memory SQLite)   |
 +-----------------------------------------------+
```
Cost of `doc.patch()` on the UI thread = merge into overlay + notify subscribers. The LiveStore commit
(in-memory SQLite + subscriptions) runs at most once per document per commit window; OPFS I/O never
runs on the UI thread.

## Requirements
- REQ-1: The canvas MUST call `doc.patch` directly on drag moves (one source: window `pointermove`), rendering from `doc.data`; no separate "ephemeral drag" bus channel for document state.
- REQ-2: The demo MUST NOT replicate document mutations itself (remove `cad.cdc.mutation` / `cad.project.imported` / `cad.cursor.drag` BroadcastChannel replication; peers get live values via livestruct overlays).
- REQ-3: Undo/redo MUST operate on the document (patches committed through livestruct) and therefore replicate automatically; no `cad.command.undo/redo` re-execution in each context.
- REQ-4: Each context MUST create the store with the livestruct worker setup chosen by the spike, a unique session per iframe, and `forceMemory` only in tests.
- REQ-5: The UI MUST stay at frame rate while dragging in "Dual iframe Split" (see acceptance thresholds).
- REQ-6: TelemetryMonitor MUST show livestruct events (local patch, overlay sent/received, commit, remote commit) with O(1) work per event and at most 100 rendered rows.

## Acceptance Criteria
- [x] Long tasks (`PerformanceObserver` type `longtask`): 0 in host, 0 in iframe A, 0 in iframe B during the scripted drag and 2 s after pointerup.
- [x] Iframe A frame deltas (rAF) during drag: p95 <= 17.5 ms, max <= 34 ms.
- [x] Iframe B shows the tentative ghost following the drag: >= 30 overlay updates per second received; committed final position visible in B within 500 ms after pointerup.
- [x] Eventlog growth for the scripted drag (~2.4 s) <= 4 events.
- [x] After reloading the whole page, the final position is restored in host, A and B.
- [x] Console in all three contexts: 0 errors, 0 warnings from livestruct/livestore/demo code.
- [x] Same thresholds hold in dev mode (`pnpm dev`) for long tasks (0) and final-position replication.
- [x] The JSON report from step 8 and a screenshot are attached to the session log.
- [x] `grep -rn "BroadcastChannel" src/` in livestruct-demo returns nothing.
- [x] livestruct-demo `pnpm test` and `pnpm typecheck` green.

## Plan

## 4. livestruct-demo: `bug--dnd-freeze-dual-iframe` (high, blocked by livestruct #2 and #3)

Problem: dragging a shape freezes, visibly with two iframe viewports. After livestruct #2/#3 the demo
must use the library like a plain object and contain no sync/persistence logic of its own.

Requirements
- REQ-1: The canvas MUST call `doc.patch` directly on drag moves (one source: window `pointermove`), rendering from `doc.data`; no separate "ephemeral drag" bus channel for document state.
- REQ-2: The demo MUST NOT replicate document mutations itself (remove `cad.cdc.mutation` / `cad.project.imported` / `cad.cursor.drag` BroadcastChannel replication; peers get live values via livestruct overlays).
- REQ-3: Undo/redo MUST operate on the document (patches committed through livestruct) and therefore replicate automatically; no `cad.command.undo/redo` re-execution in each context.
- REQ-4: Each context MUST create the store with the livestruct worker setup chosen by the spike, a unique session per iframe, and `forceMemory` only in tests.
- REQ-5: The UI MUST stay at frame rate while dragging in "Dual iframe Split" (see acceptance thresholds).
- REQ-6: TelemetryMonitor MUST show livestruct events (local patch, overlay sent/received, commit, remote commit) with O(1) work per event and at most 100 rendered rows.

Steps
1. `src/cad/store.ts`: build store via livestruct (#2 config); drop `publishCursorDrag`, `ephemeralDragCount`, `diskCommitCount`; counters come from livestruct events (`commits`, `overlaysSent`).
2. `src/components/VectorCanvas.tsx`: pointer capture (`setPointerCapture`), `pointermove` -> compute new position -> `store.doc.patch({ shapes: { [id]: { x, y, x2?, y2? } } })`; render via `doc.$` + RAF; remote tentative shapes drawn with ghost style when `doc.isTentative`; pointerup -> `doc.flush()` (no await on UI path).
3. `src/cad/broadcast.ts`: delete document replication; file removed if nothing remains.
4. Undo/redo: snapshot-based stack applies `doc.patch` + `doc.flush()`; keyboard handlers unchanged otherwise.
5. `src/cad/exportImport.ts`: export via `queryRaw`/document data; import via `collection` writes + `flush()`; no direct storage writes.
6. `TelemetryMonitor.tsx`: subscribe to livestruct events; ring buffer of 100 rows; RAF-batched render; timestamp trimming in the 1 s interval only.
7. Root `.claude/launch.json`: add `livestruct-demo` (pnpm --dir src/packages/livestruct-demo dev, port 4173) and `livestruct-demo-preview` (`vite preview`, built bundle).
8. `scripts/perf-drag.ts` (or a `?perf=drag` mode): scripted drag in iframe A: 300 `pointermove` events at 8 ms intervals along a path, then `pointerup`; collects metrics in host + both iframes and prints a JSON report.
9. Tests (node): store/undo/export-import tests updated to the new API; remove tests of deleted broadcast code; add a test that 300 drag patches produce <= 4 commits.

Acceptance (measured on the built bundle `vite build && vite preview`, Chrome, host + iframe A + iframe B, OPFS persisted)
- [x] Long tasks (`PerformanceObserver` type `longtask`): 0 in host, 0 in iframe A, 0 in iframe B during the scripted drag and 2 s after pointerup.
- [x] Iframe A frame deltas (rAF) during drag: p95 <= 17.5 ms, max <= 34 ms.
- [x] Iframe B shows the tentative ghost following the drag: >= 30 overlay updates per second received; committed final position visible in B within 500 ms after pointerup.
- [x] Eventlog growth for the scripted drag (~2.4 s) <= 4 events.
- [x] After reloading the whole page, the final position is restored in host, A and B.
- [x] Console in all three contexts: 0 errors, 0 warnings from livestruct/livestore/demo code.
- [x] Same thresholds hold in dev mode (`pnpm dev`) for long tasks (0) and final-position replication.
- [x] The JSON report from step 8 and a screenshot are attached to the session log.
- [x] `grep -rn "BroadcastChannel" src/` in livestruct-demo returns nothing.
- [x] livestruct-demo `pnpm test` and `pnpm typecheck` green.

## Ticket map and launch order

| Order | Package | Key | Prio | Blocked by |
|---|---|---|---|---|
| 1 | livestruct | `spike--livestore-integration` (new) | high | - |
| 2 | livestruct | `feat--livestore-engine` (renamed from `feat--worker-engine-lazy-sync`) | high | spike |
| 3 | livestruct | `feat--transparent-lazy-commit` (new) | high | livestore-engine |
| 4 | livestruct-demo | `bug--dnd-freeze-dual-iframe` | high | livestruct #2, #3 |
| 5 | livestruct | `bug--engine-correctness-batch` (rewritten: API-layer bugs only) | medium | transparent-lazy-commit |
| 6 | msgmesh-store | `bug--bridge-sync-correctness` | high | livestruct #2, #3 |
| 7 | msgmesh-store | `bug--worker-transport-lifecycle` | medium | #6 |
| 8 | msgmesh-store | `debt--perf-tests-and-types` | low | #6 |
| 9 | livestruct | `debt--test-coverage-and-naming` (rewritten) | low | #3, #5 |
| - | livestruct | `bug--cross-context-last-writer-wins` -> **superseded** by `feat--livestore-engine` (LiveStore leader worker is the single writer) | - | - |

Rules for every ticket:
- Start with `along start <slug>`, plan approval is already given by this plan; do not widen scope.
- Each acceptance item needs evidence in the ticket's session log: test name, command output, or measured numbers.
- A ticket is not done while any acceptance item is unchecked. No "partially done" wraps.
- Never weaken an existing test to make it pass; changed assertions must be listed with the reason.
- No `any`, no `@ts-ignore`, no `as unknown as` added in new code.
