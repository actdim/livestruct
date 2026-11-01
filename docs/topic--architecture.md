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
