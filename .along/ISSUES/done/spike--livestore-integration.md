---
protocol: along
protocol_version: "4.5.4"
slug: livestore-integration
type: spike
status: done
completed: 2026-11-01
priority: high
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [livestore, spike]
blocked_by: []
related: []
plan_status: approved
---
# Spike: prove LiveStore integration details before the engine rewrite

## Problem

the engine rewrite depends on several LiveStore behaviours that are undocumented or only
inferred (json_patch in materializers, shipping the worker from a library package, iframe sessions,
cost of commit + subscription refresh). They must be proven before the rewrite.

Launch position: **1** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

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
- REQ-1: The spike MUST answer every question Q1-Q9 below with evidence (a runnable test, a measured number, or a cited source line).
- REQ-2: The spike MUST produce an ADR recording the go/no-go and each design decision used by `feat--livestore-engine`.
- REQ-3: The spike MUST NOT change livestruct's published `src/` (prototype code lives under `spikes/livestore/` and is deleted or excluded from the build at the end).

## Acceptance Criteria
- [x] Q1-Q9 each answered in `docs/topic--livestore-integration.md` with evidence (test path or numbers table).
- [x] ADR recorded: go/no-go, pinned versions, merge-patch strategy, worker shipping strategy, sessionId strategy, commit window defaults derived from Q6.
- [x] Measured `store.commit` p95 for Q6 reported; if p95 > 4 ms for the 1-subscription case the ADR states the mitigation before T2 starts.
- [x] Spike code is excluded from the published package (`pnpm pack --dry-run` shows no `spikes/`).

## Plan

## 1. livestruct: `spike--livestore-integration` (high)

Problem: the engine rewrite depends on several LiveStore behaviours that are undocumented or only
inferred (json_patch in materializers, shipping the worker from a library package, iframe sessions,
cost of commit + subscription refresh). They must be proven before the rewrite.

Requirements
- REQ-1: The spike MUST answer every question Q1-Q9 below with evidence (a runnable test, a measured number, or a cited source line).
- REQ-2: The spike MUST produce an ADR recording the go/no-go and each design decision used by `feat--livestore-engine`.
- REQ-3: The spike MUST NOT change livestruct's published `src/` (prototype code lives under `spikes/livestore/` and is deleted or excluded from the build at the end).

Questions
- Q1 Install: exact versions to pin (`@livestore/livestore`, `@livestore/adapter-web`, `@livestore/wa-sqlite`, `effect` + peers) through the pnpm catalog; does `pnpm install` + `tsc -b` of the whole workspace stay green.
- Q2 Node tests: a Vitest node test creates a store with `makeInMemoryAdapter()`, commits, queries synchronously, subscribes (record the vitest config needed).
- Q3 Materializer for RFC 7396 merge patch: does `json_patch(body, ?)` work in a raw-SQL materializer, including null-deletes and nested objects; if not, measure the alternative (read via `ctx.query`, merge in JS, write full body).
- Q4 Worker shipping: can `@actdim/livestruct/worker` (a dist file calling `makeWorker({ schema })` with livestruct's built-in schema) be consumed by livestruct-demo in Vite dev AND `vite build`, via (a) `?worker` / `?sharedworker` imports in the app, (b) `new Worker(new URL(..., import.meta.url), { type: 'module' })` inside the library. Pick one; record required Vite config (`worker.format`, `optimizeDeps.exclude`).
- Q5 Iframes: host + 2 same-origin iframes with explicit unique `sessionId` each: all three see each other's commits; measure commit-to-remote-subscription latency (median, p95, n>=100).
- Q6 Cost on UI thread: time `store.commit` of one patch event on a 50-shape document with 1, 5, 20 active subscriptions (median, p95, n>=500) in Chrome; time 60 commits/s for 3 s and record long tasks.
- Q7 Remote change attribution: can a remote context recover `mutationId` and origin of a change (include them in event args; read via `store.events()` or table subscription) to keep livestruct CDC semantics.
- Q8 Embedding defaults: confirm `confirmUnsavedChanges: false`, `disableDevtools: true` remove the beforeunload prompt and devtools; check `store.storageMode` fallback in a private window.
- Q9 Bundle: added gzip size to livestruct-demo build (JS + WASM).

Steps
1. Branch `spike/livestore-integration` in the livestruct submodule; add deps to the pnpm catalog.
2. `spikes/livestore/schema.ts`: universal `docs` table + events (as proposed in `feat--livestore-engine`).
3. Node tests for Q2, Q3, Q7 under `spikes/livestore/*.test.ts`.
4. Browser harness page in livestruct-demo (temporary route `?spike=livestore`) for Q4-Q6, Q8, Q9; measure with `performance.now()` and `PerformanceObserver({ type: 'longtask' })`.
5. Write results to `docs/topic--livestore-integration.md` and an ADR via `/along-decision-sync`.

Acceptance
- [x] Q1-Q9 each answered in `docs/topic--livestore-integration.md` with evidence (test path or numbers table).
- [x] ADR recorded: go/no-go, pinned versions, merge-patch strategy, worker shipping strategy, sessionId strategy, commit window defaults derived from Q6.
- [x] Measured `store.commit` p95 for Q6 reported; if p95 > 4 ms for the 1-subscription case the ADR states the mitigation before T2 starts.
- [x] Spike code is excluded from the published package (`pnpm pack --dry-run` shows no `spikes/`).

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
