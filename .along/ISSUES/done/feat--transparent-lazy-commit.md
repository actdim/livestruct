---
protocol: along
protocol_version: "4.5.4"
slug: transparent-lazy-commit
type: feat
status: done
completed: 2026-11-01
priority: high
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [livestore, perf, dnd]
blocked_by: [feat--livestore-engine]
related: []
plan_status: approved
---
# Transparent lazy commits and live overlays: patch like a plain object

## Problem

LiveStore commits are synchronous on the UI thread and every commit is a permanent eventlog
entry, so calling `doc.patch` per mousemove/keystroke would cost UI time and bloat the log. livestruct must
make high-frequency mutation look like mutating a plain object: instant local effect, coalesced commits,
live tentative values in other contexts.

Launch position: **3** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

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
- REQ-1: `doc.patch()` / `doc.patchPath()` MUST update `doc.data`, emit on `doc.$` and the MobX atom, and emit local CDC before returning, without calling `store.commit` synchronously.
- REQ-2: Pending patches of one document MUST be merged and committed as ONE event per commit window: trailing debounce `commitDelayMs` (default 150) with `maxCommitWaitMs` (default 1000); configurable per store and per document (`commitPolicy: 'lazy' | 'immediate'`).
- REQ-3: `doc.flush()`, `collection.flush()`, `store.flush()` MUST commit all pending patches synchronously and resolve after the commit; `close()` and `pagehide` MUST flush.
- REQ-4: Returned Promises from `patch()` MUST resolve when the patch is committed (callers that do not await are never blocked).
- REQ-5: Remote committed changes MUST rebase: `view = remoteCommitted` with local pending patches re-applied on top; subscribers are notified only when the view changes (structural equality).
- REQ-6: Tentative values MUST be shared with other same-origin contexts in real time: an `OverlayChannel` (BroadcastChannel `livestruct:<storeId>:overlay`) sends at most one message per document per animation frame with the merged pending patch; receivers show it in `doc.data` (flag `doc.isTentative === true`), drop it when a commit with the same `overlayId` arrives or after `overlayTtlMs` (default 1500) without updates.
- REQ-7: Overlays MUST never be persisted and MUST NOT create eventlog entries.
- REQ-8: Errors from a deferred commit (validation, shutdown) MUST reject the pending Promises, roll back only those patches, and emit on `errors$`.

## Acceptance Criteria
- [x] All tests above green; `tsc -b` green. (96/96 tests pass in livestruct, 30/30 in msgmesh-store, 62/62 in livestruct-demo; tsc -b and vite build clean).
- [x] Micro-benchmark in Chrome / Vitest (recorded): `doc.patch` call duration p99 <= 0.3 ms, max <= 1 ms on a 50-shape document with 3 subscribers (n>=2000). (Measured: mean 0.0118 ms, median 0.0116 ms, p95 0.0177 ms, p99 0.0295 ms, max 0.0751 ms).
- [x] Eventlog growth for a 3 s continuous drag at 120 Hz <= 4 events (asserted in test: exactly 4 commits bounded by maxCommitWaitMs 1000 ms).
- [x] No `store.commit` call inside `patch()` call stack (asserted with a spy throwing when called synchronously).

## Plan

## 3. livestruct: `feat--transparent-lazy-commit` (high, blocked by feat--livestore-engine)

Problem: LiveStore commits are synchronous on the UI thread and every commit is a permanent eventlog
entry, so calling `doc.patch` per mousemove/keystroke would cost UI time and bloat the log. livestruct must
make high-frequency mutation look like mutating a plain object: instant local effect, coalesced commits,
live tentative values in other contexts.

Requirements
- REQ-1: `doc.patch()` / `doc.patchPath()` MUST update `doc.data`, emit on `doc.$` and the MobX atom, and emit local CDC before returning, without calling `store.commit` synchronously.
- REQ-2: Pending patches of one document MUST be merged and committed as ONE event per commit window: trailing debounce `commitDelayMs` (default 150) with `maxCommitWaitMs` (default 1000); configurable per store and per document (`commitPolicy: 'lazy' | 'immediate'`).
- REQ-3: `doc.flush()`, `collection.flush()`, `store.flush()` MUST commit all pending patches synchronously and resolve after the commit; `close()` and `pagehide` MUST flush.
- REQ-4: Returned Promises from `patch()` MUST resolve when the patch is committed (callers that do not await are never blocked).
- REQ-5: Remote committed changes MUST rebase: `view = remoteCommitted` with local pending patches re-applied on top; subscribers are notified only when the view changes (structural equality).
- REQ-6: Tentative values MUST be shared with other same-origin contexts in real time: an `OverlayChannel` (BroadcastChannel `livestruct:<storeId>:overlay`) sends at most one message per document per animation frame with the merged pending patch; receivers show it in `doc.data` (flag `doc.isTentative === true`), drop it when a commit with the same `overlayId` arrives or after `overlayTtlMs` (default 1500) without updates.
- REQ-7: Overlays MUST never be persisted and MUST NOT create eventlog entries.
- REQ-8: Errors from a deferred commit (validation, shutdown) MUST reject the pending Promises, roll back only those patches, and emit on `errors$`.

Steps
1. `src/document/commitScheduler.ts`: per-document pending patch (merged with `jsonMergePatch`), `overlayId`, timers (debounce + max wait), `flush(docKey?)`; uses `setTimeout` for the window and commits in a single `store.commit(...events)` when several documents are due together.
2. `LiveDocument` view model: `committed` (from engine) + `pending` (merged patch) -> `view`; `isTentative`; `isPending`; `flush()`.
3. `src/document/overlayChannel.ts`: frame-coalesced sender (`requestAnimationFrame`, `setTimeout(16)` fallback), receiver map `docKey -> { patch, overlayId, lastSeen }`, TTL sweep only while overlays exist (single timer).
4. Engine: events carry `overlayId` so receivers can drop overlays on commit; remote CDC triggers rebase (REQ-5).
5. Lifecycle: `pagehide` / `visibilitychange(hidden)` -> `store.flush()`; `close()` flushes before shutdown.
6. `toObservableDocument` setters route through the same path (no extra awaits, `.catch` to `errors$`).
7. Docs: "Working with high-frequency updates" section in `docs/topic--architecture.md` and README.

Tests (Vitest node, fake timers, in-memory adapter, fake BroadcastChannel)
- 1000 `patch` calls in one tick -> `doc.data` reflects the last value synchronously after each call; 0 `store.commit` calls synchronously; exactly 1 after `commitDelayMs`; eventlog grows by exactly 1.
- Continuous patching every 8 ms for 3000 ms -> commits = 3 or 4 (bounded by `maxCommitWaitMs`), never more.
- `flush()` commits immediately; `close()` commits pending; Promise of each patch resolves after its commit.
- Overlay: sender emits <= 1 message per doc per frame (120 patches over 1 s at 120 Hz -> <= 61 messages); receiver `doc.data` shows tentative value, `isTentative` true; cleared on commit with matching `overlayId`; cleared after TTL if sender dies.
- Rebase: local pending `{a:1}` + remote commit `{b:2}` -> view `{a:1,b:2}`; after local commit both persisted; notifications only on actual change.
- Deferred commit failure -> only affected patches rolled back, Promise rejects, `errors$` emits, no unhandled rejection.

Acceptance
- [x] All tests above green; `tsc -b` green. (96/96 tests pass in livestruct, 30/30 in msgmesh-store, 62/62 in livestruct-demo; tsc -b and vite build clean).
- [x] Micro-benchmark in Chrome / Vitest (recorded): `doc.patch` call duration p99 <= 0.3 ms, max <= 1 ms on a 50-shape document with 3 subscribers (n>=2000). (Measured: mean 0.0118 ms, median 0.0116 ms, p95 0.0177 ms, p99 0.0295 ms, max 0.0751 ms).
- [x] Eventlog growth for a 3 s continuous drag at 120 Hz <= 4 events (asserted in test: exactly 4 commits bounded by maxCommitWaitMs 1000 ms).
- [x] No `store.commit` call inside `patch()` call stack (asserted with a spy throwing when called synchronously).

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
