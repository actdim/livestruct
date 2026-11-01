---
protocol: along
protocol_version: "4.5.4"
slug: livestore-engine
type: feat
status: open
priority: high
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [livestore, engine, worker]
blocked_by: [spike--livestore-integration]
related: []
title: 'Rebuild livestruct engine on real LiveStore (OPFS leader worker, built-in schema, compatible API)'
---
# LiveStore-backed engine: OPFS leader worker, built-in schema, compatible API

## Problem

livestruct's engine is a fake (a `Map` + full JSON dump on the UI thread). Rebuild it on
LiveStore as the original spec required, keeping livestruct's public API, so storage, persistence and
cross-context sync run in LiveStore's background workers.

Launch position: **2** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

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
- REQ-1: The engine MUST be backed by a LiveStore store with a built-in livestruct schema; the `Map`-based engine, `persistToStorage`, and JSON-file persistence MUST be removed from the write path.
- REQ-2: In the browser the store MUST use `makePersistedAdapter` (OPFS, leader worker, SharedWorker) by default, `makeSingleTabAdapter` when SharedWorker is unavailable, and `makeInMemoryAdapter` in node/tests or when `forceMemory` is set.
- REQ-3: livestruct MUST ship its worker entry `@actdim/livestruct/worker` (calls `makeWorker({ schema })` with the built-in schema); apps MUST NOT need to write a LiveStore schema.
- REQ-4: Every context MUST get a unique `sessionId` (same-origin iframes included); `confirmUnsavedChanges` MUST default to false and devtools MUST be off unless enabled in config.
- REQ-5: Public API MUST stay source-compatible: `createLiveStruct`, `LiveStoreInstance.collection/close/engine`, `LiveDocument` (`data`, `$`, `patch`, `patchPath`, `engine`), `LiveCollection` (`get`, `create`, `delete`, `find`, `query$`), engine `insertDoc/updateDoc/patchDoc/deleteDoc/getDoc/queryDocs/cdc$/commitRaw/queryRaw/getEngineAccess`.
- REQ-6: CDC events MUST carry `type`, `kind`, `collection`, `id`, `rev`, `delta`, `data`, `mutationId`, `origin: 'local' | 'remote'`, for local writes synchronously and for remote writes when the pulled event is materialized.
- REQ-7: `queryRaw(sql, params)` MUST run real SQL against the `docs` table (read-only; non-SELECT rejected).
- REQ-8: Blobs MUST NOT be stored in event args; blob content goes to a content-addressed `BlobStore` (OPFS directory `livestruct-blobs/<sha256>` in the browser, memory in node), events carry hashes only.
- REQ-9: Existing JSON databases (`<name>.db` written by the old engine) MUST be imported once on first open and then renamed to `<name>.db.migrated`.
- REQ-10: README, package.json description/keywords and `docs/topic--architecture.md` MUST describe the real architecture.

## Acceptance Criteria
- [ ] `grep -rn "persistToStorage\|createWritable" src/engine` returns nothing outside `storage.ts`/`migrateV1.ts`.
- [ ] livestruct `pnpm test` and `tsc -b` green; msgmesh-store `pnpm test` green with no msgmesh-store source changes (or each change listed and justified).
- [ ] Browser check in livestruct-demo (dev and `vite build && vite preview`): `store.storageMode === 'persisted'`; a write in iframe A appears in iframe B and the host; all values survive a full reload; no beforeunload prompt; console has 0 errors.
- [ ] Main-thread cost: `doc.patch` -> `store.commit` on a 50-shape document p95 <= 4 ms in Chrome (n>=500), measured and recorded.
- [ ] README/package.json/docs describe LiveStore-backed architecture; `along lint` clean.

## Plan

## 2. livestruct: `feat--livestore-engine` (high, blocked by spike)

Problem: livestruct's engine is a fake (a `Map` + full JSON dump on the UI thread). Rebuild it on
LiveStore as the original spec required, keeping livestruct's public API, so storage, persistence and
cross-context sync run in LiveStore's background workers.

Requirements
- REQ-1: The engine MUST be backed by a LiveStore store with a built-in livestruct schema; the `Map`-based engine, `persistToStorage`, and JSON-file persistence MUST be removed from the write path.
- REQ-2: In the browser the store MUST use `makePersistedAdapter` (OPFS, leader worker, SharedWorker) by default, `makeSingleTabAdapter` when SharedWorker is unavailable, and `makeInMemoryAdapter` in node/tests or when `forceMemory` is set.
- REQ-3: livestruct MUST ship its worker entry `@actdim/livestruct/worker` (calls `makeWorker({ schema })` with the built-in schema); apps MUST NOT need to write a LiveStore schema.
- REQ-4: Every context MUST get a unique `sessionId` (same-origin iframes included); `confirmUnsavedChanges` MUST default to false and devtools MUST be off unless enabled in config.
- REQ-5: Public API MUST stay source-compatible: `createLiveStruct`, `LiveStoreInstance.collection/close/engine`, `LiveDocument` (`data`, `$`, `patch`, `patchPath`, `engine`), `LiveCollection` (`get`, `create`, `delete`, `find`, `query$`), engine `insertDoc/updateDoc/patchDoc/deleteDoc/getDoc/queryDocs/cdc$/commitRaw/queryRaw/getEngineAccess`.
- REQ-6: CDC events MUST carry `type`, `kind`, `collection`, `id`, `rev`, `delta`, `data`, `mutationId`, `origin: 'local' | 'remote'`, for local writes synchronously and for remote writes when the pulled event is materialized.
- REQ-7: `queryRaw(sql, params)` MUST run real SQL against the `docs` table (read-only; non-SELECT rejected).
- REQ-8: Blobs MUST NOT be stored in event args; blob content goes to a content-addressed `BlobStore` (OPFS directory `livestruct-blobs/<sha256>` in the browser, memory in node), events carry hashes only.
- REQ-9: Existing JSON databases (`<name>.db` written by the old engine) MUST be imported once on first open and then renamed to `<name>.db.migrated`.
- REQ-10: README, package.json description/keywords and `docs/topic--architecture.md` MUST describe the real architecture.

Steps
1. Dependencies: add pinned versions from the spike ADR to the pnpm catalog; `peerDependencies` of livestruct: `@livestore/livestore`, `@livestore/adapter-web`, `effect` (+ required `@effect/*` peers per ADR); `dependencies` none new.
2. `src/engine/schema.ts` (built-in schema):
   - table `docs`: `key TEXT PK` (`${collection}\u0000${id}`), `collection TEXT`, `id TEXT`, `body JSON`, `rev INTEGER`, `updatedAt INTEGER`, `blobs JSON` (name -> sha256); index `(collection, updatedAt)`.
   - events (`Events.synced`, names prefixed `livestruct.v1.`): `DocInserted {collection,id,data,blobs?,mutationId,origin}`, `DocReplaced {...}`, `DocPatched {collection,id,patch,blobs?,mutationId,origin}`, `DocPathSet {collection,id,path: (string|number)[],value,mutationId,origin}`, `DocDeleted {collection,id,mutationId,origin}`.
   - materializers: insert (`INSERT ... ON CONFLICT DO NOTHING`; duplicate detection happens before commit), replace, patch (strategy from spike Q3), path set (`json_set` with an escaped JSON path or JS merge), delete; each increments `rev` and sets `updatedAt` from the event args (materializers must be deterministic: no `Date.now()` inside).
3. `src/engine/adapter.ts`: `resolveAdapter(config)` implementing REQ-2 and REQ-4 (`sessionId = crypto.randomUUID()` per context unless provided; `clientId` default from LiveStore).
4. `src/worker.ts` -> `@actdim/livestruct/worker` export + `@actdim/livestruct/shared-worker` re-export if the spike chose option (a); wire `packageConfig.ts` / `vite.config.ts` / `package.json#exports`.
5. `src/engine/liveStoreEngine.ts` (`LiveDocEngine`, exported also as deprecated alias `LiveSqliteEngine`):
   - writes: validate (insert uniqueness via sync `store.query`), build event, `store.commit(event)`, emit local CDC synchronously, return a resolved Promise (signatures stay `async`).
   - reads: `getDoc`/`queryDocs` via synchronous `store.query` (returned records frozen copies).
   - remote CDC: subscribe once per engine to the `docs` table changes (or `store.events()`, per spike Q7); emit CDC with `origin: 'remote'` for mutationIds not issued by this engine.
   - `commitRaw` maps `RawCommitEvent` to the same write path; `queryRaw` per REQ-7.
   - `close()`: unsubscribe, `await store.shutdownPromise()`.
6. `src/engine/blobStore.ts`: `BlobStore { put(bytes): Promise<string>; get(hash): Promise<Uint8Array|null>; }`, OPFS and memory implementations; engine writes blobs first, then commits the event with hashes.
7. `src/engine/migrateV1.ts`: REQ-9 (one commit per document with `origin: 'migration'`, in one `store.commit(...events)` call).
8. Remove `src/engine/sqliteEngine.ts` Map implementation and `storage.ts` from the write path (`storage.ts` kept only as the v1 reader used by migration).
9. `LiveDocument` / `LiveCollection` adapted to the new engine without behaviour changes (lazy commit comes in ticket 3).
10. Docs per REQ-10; CHANGELOG entry.

Tests (Vitest node, `makeInMemoryAdapter`)
- All existing `tests/*.test.ts` pass; any changed assertion is listed in the session log with the reason (only storage-internals tests may change).
- New `tests/liveStoreEngine.test.ts`: insert/patch/replace/pathSet/delete materialize correctly (nested objects, arrays, null-deletes); `rev` increments; duplicate insert rejects without committing; local CDC is synchronous and carries `mutationId`; `queryRaw('SELECT ...')` returns rows, `UPDATE` rejects.
- Two engines on one in-memory sync backend (or the LiveStore test fixture used by the spike) see each other's writes with `origin: 'remote'`.
- Blob round trip: put, commit, reopen, get; event args contain only hashes (assert on eventlog rows).
- Migration: a v1 JSON file in a memory `StorageAdapter` is imported once; second open does not re-import.
- msgmesh-store suite passes against the new engine (run it in this ticket).

Acceptance
- [ ] `grep -rn "persistToStorage\|createWritable" src/engine` returns nothing outside `storage.ts`/`migrateV1.ts`.
- [ ] livestruct `pnpm test` and `tsc -b` green; msgmesh-store `pnpm test` green with no msgmesh-store source changes (or each change listed and justified).
- [ ] Browser check in livestruct-demo (dev and `vite build && vite preview`): `store.storageMode === 'persisted'`; a write in iframe A appears in iframe B and the host; all values survive a full reload; no beforeunload prompt; console has 0 errors.
- [ ] Main-thread cost: `doc.patch` -> `store.commit` on a 50-shape document p95 <= 4 ms in Chrome (n>=500), measured and recorded.
- [ ] README/package.json/docs describe LiveStore-backed architecture; `along lint` clean.

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
