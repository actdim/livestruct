---
protocol: along
slug: 03-architecture-and-wiring
title: Architecture & Wiring
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [03-architecture-and-wiring, topology, worker, shared-worker, data-flow]
---

# Architecture & Wiring

[<- Back to 02. Core Concepts](./topic--02-core-concepts.md) | [Next: 04. Integration Guide ->](./topic--04-integration-guide.md)

---

This page describes how the pieces are wired at runtime and how data flows between them. Two companion pages go deeper:

- [LiveStruct Architecture & Engine Design](./topic--architecture.md) - the `docs` table, materializers, BlobStore, lazy-commit internals.
- [LiveStore 0.5.0 Integration & Architectural Spike](./topic--livestore-integration.md) - measured evidence behind the design (latency, bundle size, worker shipping, iframe sessions).

---

## 1. Runtime Topology

LiveStruct runs in up to three kinds of JavaScript contexts:

| Context | What runs there | Entry |
|---|---|---|
| **UI context** (each tab or same-origin iframe) | `createLiveStruct` store, collections, documents, `CommitScheduler`, `OverlayChannel`, `LiveDocEngine`, LiveStore client session with an in-memory SQLite mirror. | `@actdim/livestruct` |
| **Leader dedicated worker** (one per store, elected) | LiveStore leader: persistent SQLite on OPFS, eventlog, materializers from the built-in `schema`. | `@actdim/livestruct/worker` (`makeWorker({ schema })`) |
| **SharedWorker** (one per origin and store) | LiveStore shared worker: connects all client sessions to the leader. | `@actdim/livestruct/shared-worker` |

```mermaid
flowchart LR
    subgraph TabA["Tab A (UI context)"]
        A_UI["UI components<br/>(React / dynstruct / MobX)"]
        A_DOC["LiveDocument / LiveCollection"]
        A_SCH["CommitScheduler"]
        A_ENG["LiveDocEngine<br/>(cdc$, queryRaw, commitRaw)"]
        A_LS["LiveStore client session<br/>(in-memory SQLite)"]
        A_OV["OverlayChannel"]
        A_UI --> A_DOC
        A_DOC --> A_SCH --> A_ENG --> A_LS
        A_DOC <--> A_OV
        A_ENG -- "cdc$" --> A_DOC
    end

    subgraph TabB["Tab B / iframe (UI context)"]
        B_DOC["LiveDocument"]
        B_OV["OverlayChannel"]
        B_LS["LiveStore client session"]
        B_DOC <--> B_OV
    end

    SW["SharedWorker<br/>@actdim/livestruct/shared-worker"]
    LW["Leader worker<br/>@actdim/livestruct/worker<br/>OPFS SQLite + eventlog"]

    A_LS <--> SW
    B_LS <--> SW
    SW <--> LW
    A_OV <-. "BroadcastChannel<br/>livestruct:&lt;name&gt;:overlay" .-> B_OV
```

Two independent channels connect contexts:

1. **The durable path** - LiveStore events travel client session -> SharedWorker -> leader worker -> OPFS, and back out to every other client session. Each session's `docs` table subscription feeds `LiveDocEngine`, which emits remote CDC events.
2. **The ephemeral path** - `OverlayChannel` posts tentative patches and flush notifications over a `BroadcastChannel`. Nothing on this path is persisted.

### Adapter selection

`resolveLiveStoreAdapter(config)` picks the LiveStore adapter at startup; the result is visible as `store.storageMode`:

```mermaid
flowchart TD
    S["resolveLiveStoreAdapter(config)"] --> M{"forceMemory, storagePath ':memory:',<br/>or no window/navigator?"}
    M -- yes --> MEM["makeInMemoryAdapter()<br/>storageMode 'in-memory'"]
    M -- no --> O{"OPFS available?<br/>(navigator.storage.getDirectory)"}
    O -- no --> MEM
    O -- yes --> SH{"canUseSharedWorker() and<br/>worker + sharedWorker given?"}
    SH -- yes --> P["makePersistedAdapter({ storage: opfs, worker, sharedWorker, sessionId })<br/>storageMode 'persisted'"]
    SH -- no --> W{"worker given?"}
    W -- yes --> ST["makeSingleTabAdapter({ storage: opfs, worker, sessionId })<br/>storageMode 'single-tab'"]
    W -- no --> MEM
```

If adapter construction throws, the engine falls back to the in-memory adapter. The `BlobStore` follows the same decision: in-memory when `forceMemory` is set or the resolved mode is `in-memory`, otherwise `OpfsBlobStore` (`livestruct-blobs/` directory, with an in-memory fallback per operation).

---

## 2. Object Wiring Inside One Context

`createLiveStruct` builds a small object graph. One engine, one scheduler and one overlay channel are shared by every collection and document of the store:

```mermaid
flowchart TD
    CFG["LiveStructConfig"] --> CLS["createLiveStruct()"]
    CLS --> ENG["createLiveEngine() -> LiveDocEngine"]
    ENG --> LS["createStorePromise({ schema, storeId: name, adapter,<br/>confirmUnsavedChanges: false, disableDevtools: true })"]
    ENG --> BS["resolveBlobStore()"]
    CLS --> OC["new OverlayChannel({ storeId, sessionId, overlayTtlMs, disabled })"]
    CLS --> CS["new CommitScheduler(engine, { commitPolicy, commitDelayMs, maxCommitWaitMs, overlayChannel })"]
    CLS --> EV["events$ (Subject of LiveStructEvent)"]
    CLS --> INST["LiveStoreInstance"]
    INST --> COL["collection(name) -> LiveCollectionImpl"]
    COL --> ACC["engine.getEngineAccess(name) -> LiveEngineAccess"]
    COL --> DOC["LiveDocumentImpl (per id, cached)"]
    DOC -. "registerDocument" .-> CS
    DOC -. "registerDocument" .-> OC
    DOC -. "cdc$ filtered by id" .-> ACC
```

Additional wiring done by `createLiveStruct`:

- `engine.cdc$` events with `origin: 'remote'` are re-emitted as `remote_commit` diagnostic events (deduplicated by collection, id, rev and overlay id).
- `window` `pagehide` and `document` `visibilitychange` (hidden) trigger `CommitScheduler.flushAll()`.
- `store.close()` removes those listeners, flushes, disposes the overlay channel, scheduler and collections, then closes the engine (which shuts down the LiveStore session).

---

## 3. Data Flow: Local Patch

```mermaid
sequenceDiagram
    participant UI as UI code
    participant D as LiveDocument
    participant S as CommitScheduler
    participant O as OverlayChannel
    participant E as LiveDocEngine
    participant L as LiveStore (client session)

    UI->>D: patch({ x: 120 })
    D->>D: assertJsonSafe, merge into localPendingPatch
    D->>D: recompute data, emit $ and MobX atom
    D->>S: schedulePatch(collection, id, patch)
    D->>E: emitCDC({ origin: 'local', mutationId: overlayId })
    D->>O: sendTentative(patch, overlayId)
    Note over O: coalesced, posted on next animation frame
    Note over S: debounce commitDelayMs / cap maxCommitWaitMs
    S->>E: commitBatchedPatches([...entries])
    E->>L: store.commit(DocPatched..., DocPathSet...)
    E-->>S: DocumentRecord[] (new rev, data)
    S->>D: onCommitSuccess(rev, data, overlayId)
    S-->>UI: patch() Promise resolves
```

Key properties:

- Nothing in the synchronous part of `patch()` touches SQLite; UI code sees the new `doc.data` immediately.
- The engine writes the merged patch as one `DocPatched` event (`json_patch(body, ?)`) and each path write as a `DocPathSet` event (`json_set(body, ?, json(?))`), all in a single `store.commit(...)` call per batch.
- Local CDC is emitted once, by the document, so the scheduler passes `emitCDC: false` to the engine.

## 4. Data Flow: Remote Change

```mermaid
sequenceDiagram
    participant LA as Tab A LiveStore
    participant SW as SharedWorker / leader
    participant LB as Tab B LiveStore
    participant EB as Tab B LiveDocEngine
    participant DB as Tab B LiveDocument

    LA->>SW: event pushed
    SW->>LB: event pulled, materialized into docs table
    LB->>EB: tables.docs subscription callback (rows)
    EB->>EB: compare row.rev with localKnownDocs, skip own mutationIds
    EB->>DB: cdc$ { type: 'update', origin: 'remote', overlayId }
    DB->>DB: drop matching overlay, update committedData
    DB->>DB: data = committed + local pending, emit if changed
```

Inserts are detected as rows with an unknown key, updates as rows with a higher `rev`, deletes as known keys missing from the row set. A remote delete disposes the cached document and removes it from its collection.

## 5. Data Flow: Tentative Overlay and Flush

```mermaid
sequenceDiagram
    participant DA as Tab A LiveDocument
    participant OA as Tab A OverlayChannel
    participant OB as Tab B OverlayChannel
    participant DB as Tab B LiveDocument

    DA->>OA: sendTentative(patch, overlayId)
    OA->>OB: { type: 'overlay', patch, overlayId, senderSessionId } (once per frame)
    OB->>DB: applyRemoteOverlay(mergedPatch, overlayId)
    Note over DB: isTentative = true (unless DB has local pending edits)
    DA->>DA: flush()
    DA->>OA: broadcastCommit(overlayId, patch, rev)
    OA->>OB: { type: 'commit', overlayId, patch, rev }
    OB->>DB: applyRemoteCommit(patch, rev, overlayId)
    Note over DB: isTentative = false
```

Without an explicit flush, the overlay is cleared when the durable commit arrives through LiveStore (matched by overlay id) or when `overlayTtlMs` elapses.

---

## 6. Where the Application Plugs In

```mermaid
flowchart LR
    APP["Application"] --> CFG["createLiveStruct({ name, sessionId, worker, sharedWorker })"]
    APP --> VIEW["Views read doc.data / doc.$<br/>(MobX observer, dynstruct, RxJS)"]
    APP --> CMD["Commands call doc.patch / patchPath / flush"]
    APP --> BUS["Optional msgmesh MsgBus<br/>for commands and ephemeral signals"]
    APP --> LOW["Low-level: store.engine.cdc$, queryRaw, commitRaw, blobs"]
    APP --> TEL["Telemetry: store.events$, store.errors$"]
```

- **Views** stay declarative: MobX `observer` components (and dynstruct views) re-render when `doc.data` changes.
- **Commands** call document methods and decide when durability matters (`await doc.flush()` at the end of a gesture).
- **Messaging** (`@actdim/msgmesh`) is optional and lives beside the store; LiveStruct does not depend on it. A bridge from `engine.cdc$` to bus channels is application (or `@actdim/msgmesh-store`) code.

Step-by-step setup is in the [Integration Guide](./topic--04-integration-guide.md).

---

[<- Back to 02. Core Concepts](./topic--02-core-concepts.md) | [Next: 04. Integration Guide ->](./topic--04-integration-guide.md)
