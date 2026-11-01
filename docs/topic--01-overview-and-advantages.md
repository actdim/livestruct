---
protocol: along
slug: 01-overview-and-advantages
title: Overview & Key Advantages
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [01-overview-and-advantages, overview, livestore, local-first]
---

# Overview & Key Advantages

[<- Back to README](../README.md) | [Next: 02. Core Concepts ->](./topic--02-core-concepts.md)

---

## What is @actdim/livestruct?

**`@actdim/livestruct`** is a reactive document and record layer built on top of [LiveStore](https://livestore.dev) (`@livestore/livestore` 0.5.0: reactive SQLite WASM plus event-sourcing). It lets a TypeScript application work with **hierarchical JSON documents** grouped into **collections**, while LiveStore takes care of durable storage (OPFS), the eventlog, and multi-tab synchronization.

One call gives you a ready store:

```typescript
import { createLiveStruct } from '@actdim/livestruct';

const store = await createLiveStruct({ name: 'cad_workspace' });
const parts = await store.collection<{ id: string; name: string; color: string }>('parts');
const doc = await parts.create('part-101', { id: 'part-101', name: 'Bracket A', color: 'blue' });

doc.$.subscribe((state) => console.log(state.color));
void doc.patch({ color: 'red' }); // doc.data is updated synchronously
await doc.flush();                // durable SQLite commit
```

The library provides:

- **Document API with RxDB-like ergonomics** - `store.collection(name)`, `collection.get(id)` / `create` / `delete` / `find`, `doc.patch(...)`, `doc.patchPath(...)`, `doc.replace(...)`.
- **A built-in universal schema** - one `docs` SQLite table and five `livestruct.v1.*` events with SQL materializers (`json_patch`, `json_set`). No Effect schema, events or materializers have to be authored by the application.
- **Transparent lazy commits** - mutations land in memory instantly; a `CommitScheduler` coalesces them into batched SQLite commits (`commitDelayMs` 150 ms, `maxCommitWaitMs` 1000 ms by default).
- **Live tentative overlays** - uncommitted values stream to other same-origin tabs and iframes over a `BroadcastChannel` at most once per animation frame, without touching the eventlog (`doc.isTentative`).
- **Reactivity for both RxJS and MobX** - `doc.$` is an RxJS `BehaviorSubject`-backed stream; `doc.data` reports to a MobX atom, so MobX `observer` components and `@actdim/dynstruct` views re-render automatically.
- **Off-main-thread persistence** - an OPFS leader worker (`@actdim/livestruct/worker`) and a SharedWorker (`@actdim/livestruct/shared-worker`) host the persistent SQLite database; each tab keeps an in-memory SQLite mirror for synchronous reads.
- **Content-addressed binary blobs** - `Uint8Array` / `Float32Array` payloads live in a `BlobStore` (OPFS directory `livestruct-blobs/<sha256>`), so events carry only hashes.
- **A low-level escape hatch** - `doc.engine` / `store.engine` expose raw read-only SQL (`queryRaw`), raw commits (`commitRaw`) and a Change Data Capture stream (`cdc$`).

---

## The Problems It Solves

Raw LiveStore is a strong foundation (embedded SQLite, OPFS persistence, event-sourcing, cross-tab sync), but using it directly from interactive UI code creates friction:

| Problem with raw LiveStore in UI code | How LiveStruct addresses it |
|---|---|
| Every field update needs an event definition, an Effect schema, a SQL materializer and a query subscription (CQRS boilerplate). | A universal `docs` table and generic `DocInserted` / `DocPatched` / `DocPathSet` / `DocReplaced` / `DocDeleted` events cover any JSON document. |
| UI entities (cards, CAD shapes, GIS features) are trees; SQLite is flat rows. | Documents are JSON bodies merged with RFC 7396 merge patches (`json_patch(body, ?)`), plus type-safe dot paths (`NestedPath<T>`). |
| 60-120 Hz interactions (dragging, sliders, typing) cannot each become a permanent event without bloating the log and costing frame time. | `doc.patch()` is synchronous in memory; the `CommitScheduler` debounces and batches commits; other contexts see tentative overlays instead of committed events. |
| Same-origin iframes share `sessionStorage`, so LiveStore sessions collide. | Each `createLiveStruct` call resolves an explicit `sessionId` (generated if omitted). |
| LiveStore defaults register a `beforeunload` prompt and devtools channels on the host page. | LiveStruct defaults to `confirmUnsavedChanges: false` and `disableDevtools: true`. |
| Binary geometry in event args bloats the eventlog forever. | Blobs are stored out-of-band and referenced by SHA-256 hash. |

---

## When to Use It

Use `@actdim/livestruct` when:

- The application is **local-first**: data must survive reloads (OPFS) and stay consistent across several tabs or same-origin iframes.
- Data is naturally **document-shaped** (nested objects keyed by id) rather than relational.
- The UI performs **high-frequency edits** (canvas editors, CAD/GIS tools, property inspectors) that must feel instant but still persist.
- You want **MobX or RxJS reactivity** on persisted records without writing a sync layer.

Consider raw LiveStore (or a different store) when you need custom relational tables with hand-written SQL materializers, server-side sync semantics beyond what the generic `docs` table provides, or when documents are not JSON-safe (LiveStruct rejects `Date`, `Map`, `Set`, class instances, `NaN`, typed arrays inside document bodies - see [Core Concepts](./topic--02-core-concepts.md), section "JSON Safety").

---

## Key Advantages

1. **Zero schema authoring** - the built-in `schema` (exported from `@actdim/livestruct/engine`) is all a worker needs: `makeWorker({ schema })`.
2. **Instant local writes** - `doc.patch()` updates `doc.data`, emits on `doc.$`, notifies the MobX atom and emits local CDC before any SQLite work happens.
3. **Durability on demand** - the Promise returned by `doc.patch()` resolves only after the commit lands in SQLite; `doc.flush()`, `collection.flush()` and `store.flush()` force it. Pending data is also flushed on `pagehide`, `visibilitychange` (hidden) and `store.close()`.
4. **Rebase instead of overwrite** - when a remote commit arrives, the view is recomputed as `remoteCommitted + localPendingPatches`; notifications are suppressed if the result is structurally equal (`deepEquals`).
5. **Failure is observable** - deferred commit errors reject the pending Promises, roll back the uncommitted patch, and are emitted on `doc.errors$`, `collection.errors$` and `store.errors$`.
6. **Diagnostics built in** - `store.events$` / `doc.events$` stream `local_patch`, `overlay_sent`, `overlay_received`, `commit` and `remote_commit` events (the demo's telemetry panel is built on them).
7. **Testable in Node** - outside the browser (or with `forceMemory: true`) the engine uses LiveStore's in-memory adapter and an in-memory `BlobStore`, so the whole API runs in Vitest.

---

## Relation to Other Packages

| Package | Relation |
|---|---|
| **LiveStore** (`@livestore/livestore`, `@livestore/adapter-web`) | Required peer. LiveStruct is a layer over it: storage, eventlog, leader election and cross-tab sync are LiveStore's; documents, lazy commits, overlays and the CDC stream are LiveStruct's. Details: [LiveStore Integration](./topic--livestore-integration.md). |
| **`effect`** | Required peer (pinned `4.0.3`); used by the built-in schema (`Schema.Struct`) and by LiveStore itself. |
| **`mobx`**, **`rxjs`** | Required peers. Every `LiveDocument` owns a MobX atom (`createAtom`) and RxJS subjects. |
| **`@actdim/utico`** | Required peer of the package (shared monorepo utility layer). |
| **`@actdim/msgmesh`** | Optional peer. LiveStruct itself does not import msgmesh; applications put a typed `MsgBus` next to the store for commands and ephemeral signals (the demo creates one with `createMsgBus` from `@actdim/msgmesh/core`). See [Integration Guide](./topic--04-integration-guide.md), Step 6. |
| **`@actdim/msgmesh-store`** | Not a dependency. The README describes it as the place to bridge `engine.cdc$` into typed bus channels; any such bridge subscribes to the public `cdc$` stream. |
| **`@actdim/dynstruct`** | Not a dependency. Dynstruct components are MobX-reactive, so reading `doc.data` (or a `toObservableDocument` proxy) inside a dynstruct view re-renders it when the document changes. |

---

## Package Entry Points

| Import path | Source | Contents |
|---|---|---|
| `@actdim/livestruct` | `src/index.ts` | `createLiveStruct` plus everything from the engine, lens and document modules. |
| `@actdim/livestruct/engine` | `src/engine.ts` | Engine, schema, blob store, storage adapters, plus re-exports of the document and lens modules. |
| `@actdim/livestruct/document` | `src/document.ts` | Document and collection implementation, scheduler, overlay channel, helpers. |
| `@actdim/livestruct/lens` | `src/lens.ts` | Path types and immutable path helpers. |
| `@actdim/livestruct/worker` | `src/worker.ts` | Dedicated leader worker script (`makeWorker({ schema })`). |
| `@actdim/livestruct/shared-worker` | `src/shared-worker.ts` | SharedWorker script (re-hosts `@livestore/adapter-web/shared-worker`). |

The `document` and `lens` paths resolve through the `./*` wildcard export. The full per-symbol list is in the [API Reference](./topic--05-api-reference.md).

---

[<- Back to README](../README.md) | [Next: 02. Core Concepts ->](./topic--02-core-concepts.md)
