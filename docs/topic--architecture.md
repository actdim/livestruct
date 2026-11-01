---
protocol: along
protocol_version: "4.5.4"
slug: architecture
title: LiveStruct Architecture & Engine Design
type: architecture
created: 2026-10-30
updated: 2026-11-01
tags: [architecture, livestore, opfs, worker, schema, blobs]
---

# LiveStruct Architecture & Engine Design

LiveStruct is an ergonomic, reactive document abstraction built on LiveStore 0.5.0 (SQLite WASM and event-sourcing). Heavy operations (file system I/O, SQLite transaction coordination, cross-tab synchronization) execute in background workers, while the UI thread maintains a lightweight client session with synchronous snapshots.

## 1. System Topology

```text
UI Thread (Tab / Iframe)                                        Background Workers
+-----------------------------------------------+   async   +-------------------------+
| LiveDocument / LiveCollection (Public API)    |  push     | Leader Dedicated Worker |
| - Synchronous snapshot: `doc.data`            | --------> | (@actdim/livestruct/    |
| - Instant RFC 7396 merge: `doc.patch(...)`    |           |  worker):               |
| - Reactive RxJS observable: `doc.$`           |           | - OPFS SQLite writer    |
| - MobX atom integration for fine reactivity   | <-------- | - Eventlog permanence   |
| LiveStore Client Session (SQLite WASM in RAM) |  pull     | - Lock coordination     |
+-----------------------------------------------+           +------------+------------+
                                                                         |
                                                                         | MessagePort
                                                                         v
                                                            +-------------------------+
                                                            | SharedWorker            |
                                                            | (@actdim/livestruct/    |
                                                            |  shared-worker):        |
                                                            | - Cross-context bus     |
                                                            | - Multiplexed sync      |
                                                            +-------------------------+
```

### Key Topology Principles
1. **Single Writer with Web Locks:** A single dedicated worker acts as the elected leader for each database (`storeId`). It alone interacts with browser OPFS (Origin Private File System).
2. **SharedWorker Multiplexing:** Tabs and iframes connect via a SharedWorker to receive background event streams without polling.
3. **Local In-Memory SQLite WASM:** Each UI context maintains an in-memory SQLite mirror that executes sync queries and subscriptions at sub-millisecond latencies.

## 2. Built-in Schema & Materialization

LiveStruct eliminates manual CQRS event boilerplate by providing a universal document schema (`docs` table):

### Table Structure (`docs`)
- `key TEXT PRIMARY KEY`: Composite key `${collection}\x01${id}` ensuring unique records per collection.
- `collection TEXT`: Collection identifier (e.g. `shapes`, `users`).
- `id TEXT`: Document identifier.
- `body TEXT`: Document JSON payload.
- `rev INTEGER`: Monotonically increasing revision number.
- `updatedAt INTEGER`: Deterministic millisecond timestamp.
- `blobs TEXT`: Serialized JSON mapping of blob name to SHA-256 hash.
- `mutationId TEXT`: Unique mutation tracking identifier for echo suppression.
- `origin TEXT`: Marker indicating `local`, `remote`, or `migration`.

Index: `idx_docs_collection_updatedAt` on `(collection, updatedAt)`.

### Materializers
- **DocInserted:** Inserts row with `rev = 1`. Duplicate inserts are validated synchronously before commit to prevent corrupting event logs.
- **DocPatched:** Uses SQLite native `json_patch(body, ?)` with positional parameter binding for strict RFC 7396 merge patches (deep nested merges, array replacements, null deletes).
- **DocReplaced:** Performs full document body replacement (`ON CONFLICT (key) DO UPDATE`) with `rev = rev + 1`.
- **DocPathSet:** Uses SQLite `json_set(body, ?, json(?))` with `rev = rev + 1`.
- **DocDeleted:** Deletes row matching `key`.

## 3. Content-Addressed BlobStore

LiveStore event args must remain compact to prevent permanent eventlog bloat. Binary BLOBs (such as `Float32Array` CAD coordinates and `Uint8Array` binary payloads) are handled out-of-band:

1. **Storage:** Blobs are written to a dedicated content-addressed store:
   - In browser: OPFS directory `livestruct-blobs/<sha256>`.
   - In Node/testing: In-memory hash map.
2. **Type Preservation:** Payload bytes are prefixed with a 1-byte header (`0x01` for `Uint8Array`, `0x02` for `Float32Array`) before computing the SHA-256 hash.
3. **Event Payloads:** Event arguments carry only the 64-character SHA-256 hex string.
4. **Rehydration:** On `getDoc()`, binary buffers are retrieved from the BlobStore and rehydrated as exact typed array instances.

## 4. Dual-Level API

### High-Level API (UI & Dynstruct Forms)
- `LiveDocument<T>`: Implements `data` (frozen snapshot), `$` (RxJS observable), `patch(partial)`, `patchPath(path, value)`, and MobX atom notifications.
- `LiveCollection<T>`: Manages document lifecycle (`get`, `create`, `delete`, `find`, `query$`).

### Low-Level Engine API (Worker Bridges & MsgMesh)
- Accessible via `doc.engine` or `store.engine`.
- `queryRaw(sql, params)`: Executes read-only SELECT queries directly against SQLite. Automatically rewrites queries targeting collection names to subqueries against the `docs` table. Non-SELECT queries are rejected.
- `commitRaw(event)`: Dispatches raw commit events to engine mutations.
- `cdc$`: Change Data Capture stream emitting typed events (`type`, `kind`, `collection`, `id`, `rev`, `delta`, `data`, `mutationId`, `origin`).

## 5. Session Isolation & Embedding Defaults

- **Unique Session ID:** Same-origin iframes share `window.sessionStorage`. To prevent session collisions, each context generates an explicit unique `sessionId`.
- **Disabled DevTools by Default:** DevTools communication overhead is disabled unless explicitly requested.
- **Disabled Unsaved Changes Dialog:** `confirmUnsavedChanges: false` prevents LiveStore from registering invasive `beforeunload` prompts on the host page.

## 6. Legacy v1 Migration

Existing v1 JSON databases (`<name>.db`) are automatically detected on first launch:
1. All documents and associated `.blobs.*` binary files are parsed.
2. Binary blobs are stored in the content-addressed BlobStore.
3. Documents are batch-committed to LiveStore with `origin: 'migration'`.
4. The legacy file is renamed to `<name>.db.migrated`, ensuring migration runs exactly once.

## 7. Working with High-Frequency Updates (Transparent Lazy Commits & Overlays)

LiveStore commits are synchronous on the UI thread and append permanent entries to the eventlog. High-frequency mutations (such as 60-120 Hz drag operations, canvas transformations, or slider dragging) cannot commit to SQLite on every tick without freezing the frame or bloating storage.

LiveStruct solves this transparently through an in-memory view layer, coalescing commit scheduler, and lightweight overlay broadcast channel:

### 7.1 Instant Local Updates (Plain Object Feel)
- Calling `doc.patch(...)` or `doc.patchPath(...)` updates `doc.data` immediately and synchronously.
- Local subscriptions (`doc.$`) and MobX atoms fire synchronously in the current microtask.
- Local Change Data Capture (`doc.engine.cdc$`) emits immediately with `origin: 'local'`.
- There is NO synchronous `store.commit` in the `doc.patch` call stack (O(1) execution time, sub-millisecond p99 latency).

### 7.2 Coalesced CommitScheduler
- Pending patches for a document are coalesced into a single RFC 7396 patch using structural sharing and preserving null tombstones.
- Commit timing is controlled by two timers:
  - Trailing debounce window: `commitDelayMs` (default: 150 ms).
  - Upper bounded wait deadline: `maxCommitWaitMs` (default: 1000 ms).
- When multiple documents become due in the same tick, they are committed to SQLite in a single transaction (`commitBatchedPatches`).
- Configuration: Set globally via `createLiveStruct({ commitPolicy: 'lazy', commitDelayMs: 150, maxCommitWaitMs: 1000 })` or per document via `collection.get(id, { commitPolicy: 'immediate' })`.

### 7.3 Flush Semantics and Lifecycle Integration
- Manual flushing: `doc.flush()`, `collection.flush()`, or `store.flush()` commits all pending patches synchronously and resolves after the commit is written to SQLite.
- Automatic flushing: Store instances register listeners on `pagehide` and `visibilitychange` (state `hidden`) to flush all dirty documents before context tear-down.
- Graceful shutdown: `store.close()` flushes all pending mutations before terminating workers.
- Promise lifecycle: The Promise returned by `doc.patch(...)` resolves only when the patch is durably committed to SQLite. Callers that do not await are never blocked.

### 7.4 Live Real-Time Overlays (Cross-Context Tentative Updates)
- High-frequency mutations are shared across same-origin contexts (tabs, iframes) via `OverlayChannel` over a shared BroadcastChannel (`livestruct:<storeId>:overlay`).
- Frame coalescing: The sender throttles transmissions to at most one message per document per animation frame (~16 ms, using `requestAnimationFrame` with fallback to 16 ms timer).
- Receiver state: Remote contexts apply the tentative patch to their in-memory document view without touching SQLite, marking `doc.isTentative === true`.
- Zero persistence: Overlays never touch SQLite or the permanent eventlog.
- Automatic cleanup: Tentative overlays are dropped immediately when a matching commit arrives (tracked by unique `overlayId`) or when `overlayTtlMs` (default: 1500 ms) expires.

### 7.5 CDC Rebase and Notification Suppression
- When a remote commit arrives from LiveStore, LiveStruct computes:
  `view = remoteCommitted + localPendingPatches`
- If the rebased view is structurally identical to the previous view (`deepEquals`), subscriber notifications are suppressed, preventing redundant DOM re-renders.

### 7.6 Error Recovery and Rollback
- If a deferred commit fails (e.g. SQLite validation failure or shutdown abort), affected pending patches are rolled back to the last committed state.
- Associated pending Promises reject, and errors are dispatched to `doc.errors$` and `store.errors$`.

