---
protocol: along
slug: 02-core-concepts
title: Core Concepts
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [02-core-concepts, document, collection, lens, cdc, overlays]
---

# Core Concepts

[<- Back to 01. Overview](./topic--01-overview-and-advantages.md) | [Next: 03. Architecture & Wiring ->](./topic--03-architecture-and-wiring.md)

---

LiveStruct has a small set of abstractions, layered from the top (what UI code touches) to the bottom (what talks to LiveStore):

| Layer | Abstraction | Source |
|---|---|---|
| Store | `LiveStoreInstance` created by `createLiveStruct(config)` | `src/index.ts`, `src/document/types.ts` |
| Collection | `LiveCollection<T>` (`LiveCollectionImpl`) | `src/document/liveCollection.ts` |
| Document | `LiveDocument<T>` (`LiveDocumentImpl`) | `src/document/liveDocument.ts` |
| Paths | `NestedPath<T>`, `PathValue<T, P>`, lens helpers | `src/lens/` |
| Write pipeline | `CommitScheduler`, `OverlayChannel` | `src/document/commitScheduler.ts`, `src/document/overlayChannel.ts` |
| Engine | `LiveDocEngine`, `LiveEngineAccess<T>`, `CDCEvent<T>` | `src/engine/liveStoreEngine.ts`, `src/engine/types.ts` |
| Storage | built-in `schema`, `BlobStore`, adapter resolution | `src/engine/schema.ts`, `src/engine/blobStore.ts`, `src/engine/adapter.ts` |

---

## 1. The Store (`createLiveStruct`)

`createLiveStruct(config: LiveStructConfig): Promise<LiveStoreInstance>` creates the engine (and the underlying LiveStore), one shared `OverlayChannel`, one shared `CommitScheduler`, and registers `pagehide` / `visibilitychange` flush listeners.

```typescript
import { createLiveStruct, type LiveStructConfig } from '@actdim/livestruct';

const config: LiveStructConfig = {
    name: 'cad_store',          // LiveStore storeId and overlay channel id
    sessionId: `session_${crypto.randomUUID()}`, // unique per tab/iframe
    commitPolicy: 'lazy',       // 'lazy' (default) | 'immediate'
    commitDelayMs: 150,         // trailing debounce (default 150)
    maxCommitWaitMs: 1000,      // upper bound (default 1000)
    overlayTtlMs: 1500,         // tentative overlay lifetime (default 1500)
};

const store = await createLiveStruct(config);
console.log(store.storageMode); // 'persisted' | 'single-tab' | 'in-memory'
```

`LiveStructConfig` fields:

| Field | Default | Meaning |
|---|---|---|
| `name` | required | LiveStore `storeId`; also names the overlay `BroadcastChannel` (`livestruct:<name>:overlay`). |
| `storagePath` | - | `':memory:'` forces the in-memory adapter; also the legacy v1 file path (default `<name>.db`). |
| `forceMemory` | `false` | Always use the in-memory LiveStore adapter and in-memory blob store. |
| `sessionId` | generated | LiveStore session id; also the overlay sender id. Pass a unique value per same-origin context. |
| `disableDevtools` | `true` (engine default) | Passed to `createStorePromise`. |
| `confirmUnsavedChanges` | `false` (engine default) | Passed to `createStorePromise`; `false` avoids a `beforeunload` prompt on the host page. |
| `worker` | - | Dedicated worker constructor (for example from a `?worker` import). |
| `sharedWorker` | - | SharedWorker constructor (for example from a `?sharedworker` import). |
| `commitPolicy` | `'lazy'` | Global commit policy. |
| `commitDelayMs` | `150` | Trailing debounce window. |
| `maxCommitWaitMs` | `1000` | Maximum time a patch may wait before it is committed. |
| `overlayTtlMs` | `1500` | How long a received tentative overlay survives without updates. |
| `disableOverlay` | `false` | Disable `BroadcastChannel` overlay sharing. |

`LiveStoreInstance` members: `engine`, `storageMode`, `errors$`, `events$`, `collection(name, options?)`, `flush()`, `close()`.

`store.collection(name)` caches collections by name; calling it twice returns the same instance unless it was disposed.

---

## 2. Collections

A `LiveCollection<T>` is a named group of documents stored in the shared `docs` table (rows are keyed by `makeDocKey(collection, id)`, that is `` `${collection}\u0001${id}` ``).

```typescript
interface Shape {
    id: string;
    name: string;
    x: number;
    y: number;
    style?: { fill?: string; stroke?: string };
}

const shapes = await store.collection<Shape>('shapes');

const rect = await shapes.create('rect-1', { id: 'rect-1', name: 'Rect', x: 10, y: 20 });
const same = await shapes.get('rect-1');          // cached instance (same object as rect)
const missing = await shapes.get('nope');         // null
const wide = await shapes.find((s) => s.x > 100); // predicate over document data
await shapes.delete('rect-0');                    // deletes the row, disposes a cached document

shapes.query$.subscribe((docs) => console.log('count', docs.length));
```

Behavior grounded in `LiveCollectionImpl`:

- `get(id)` returns the cached `LiveDocument` if it is alive, deduplicates concurrent loads of the same id, and returns `null` when the row does not exist.
- `create(id, data)` validates `data` with `assertJsonSafe`, throws if the id already exists (`Document with id '...' already exists in collection '...'`), and resolves after the insert is committed.
- `find(predicate?)` queries all rows of the collection; without a predicate it also disposes cached documents whose rows disappeared.
- `query$` is a `BehaviorSubject`-backed stream of all documents; it is refreshed on every CDC event of the collection (refreshes are coalesced while one is in flight).
- `flush()` commits all pending patches of this collection; `subscriptionCount` counts the collection's CDC subscription plus its live documents.
- `dispose()` disposes all cached documents and completes `query$` and `errors$`.

---

## 3. Documents

`LiveDocument<T>` is the central object. It keeps three layers of state:

```text
committedData   - last state known to be in SQLite (frozen)
+ localPending  - this context's uncommitted merge patch and path sets
+ remoteOverlay - another context's tentative patch (only when nothing is pending locally)
= data          - the frozen snapshot you read
```

### 3.1 Reading

```typescript
const snapshot = rect.data;        // Readonly<Shape>, deeply frozen
rect.$.subscribe((s) => draw(s));  // emits current value, then each verified change
rect.isPending;                    // true while local patches are not yet committed
rect.isTentative;                  // true while showing another context's uncommitted overlay
```

`doc.data` is deeply frozen (`deepFreeze`); mutate through the API, never in place. Reading `doc.data` also calls `reportObserved()` on the document's MobX atom.

### 3.2 Writing

```typescript
// RFC 7396 merge patch: nested objects merge, arrays replace, null deletes a key
void rect.patch({ x: 120, style: { fill: 'red' } });
void rect.patch({ style: { stroke: null } });

// Type-checked path write (SET semantics on the target subtree)
void rect.patchPath('style.fill', 'blue');

// Untyped escape hatch
void rect.patchUnchecked({ dynamicKey: 42 });

// Replace the committed body; pending local patches are re-applied on top
await rect.replace({ id: 'rect-1', name: 'Rect', x: 0, y: 0 });

// Wait for durability
await rect.flush();
```

Every `patch` / `patchPath` call does, synchronously and in this order: update the pending patch, recompute `data`, emit on `doc.$` and the MobX atom, schedule the commit, emit a local CDC event (`origin: 'local'`), emit a `local_patch` diagnostic event, and queue a tentative overlay broadcast. The returned Promise resolves when the patch is committed to SQLite; it is safe to ignore it with `void` during high-frequency interactions and `await doc.flush()` at the end of the gesture.

`PatchPayload<T>` is the typed patch shape: every property optional, objects recursively partial or `null`, arrays replaced whole.

### 3.3 Remote changes and rebasing

When the engine's CDC stream reports a remote insert/update for this document, the document:

1. drops a matching tentative overlay,
2. updates `committedData` and the committed revision,
3. recomputes `data = committed + local pending patches`,
4. emits only if the result differs structurally from the previous snapshot (`deepEquals`).

Echoes of the document's own pending commits are suppressed by `mutationId` / overlay id. A remote `delete` disposes the document.

### 3.4 Lifecycle and errors

- `doc.errors$` emits deferred commit errors; the failed pending patch is rolled back to the committed state and the pending Promises reject.
- `doc.events$` filters the store-wide `events$` to this document.
- `doc.dispose()` unsubscribes from CDC, unregisters from scheduler and overlay channel, and completes `$` and `errors$`. Patching a disposed document throws.

---

## 4. Commit Policies and the CommitScheduler

The `CommitScheduler` turns many in-memory patches into few SQLite commits:

- Patches for the same document are merged with `mergePatches` (null tombstones preserved); path writes are queued as path sets.
- `'lazy'` policy: a trailing debounce (`commitDelayMs`) restarts on each patch; a `maxCommitWaitMs` timer guarantees an upper bound.
- `'immediate'` policy: the commit is started right away.
- Due entries are committed through `LiveDocEngine.commitBatchedPatches`, which issues a single `store.commit(...events)` for the batch.
- `flushDoc`, `flushCollection` and `flushAll` commit immediately and also broadcast a `commit` message on the overlay channel so other contexts can drop their tentative state.

Policy is set globally in `LiveStructConfig` or per collection through `LiveDocumentOptions`:

```typescript
const cursors = await store.collection<{ id: string; x: number; y: number }>('cursors', {
    commitPolicy: 'lazy',
    commitDelayMs: 300,
    maxCommitWaitMs: 2000,
});

const settings = await store.collection<{ id: string; theme: string }>('settings', {
    commitPolicy: 'immediate',
});
```

---

## 5. Tentative Overlays (`OverlayChannel`)

Uncommitted patches are shared with other same-origin contexts (tabs, iframes) that opened the same store `name`:

- The sender coalesces outgoing patches per document and posts at most one `overlay` message per animation frame (`requestAnimationFrame`, 16 ms timer fallback).
- The receiver applies the patch on top of its committed state and reports `isTentative === true`, unless it has local pending edits (local edits always win).
- Overlays never touch SQLite or the eventlog. They are dropped when a matching commit arrives (by overlay id), when a `commit` message is received, or after `overlayTtlMs` without updates.
- Messages from the same `sessionId` are ignored, so each context needs its own session id.

Set `disableOverlay: true` to turn the channel off (for example in tests).

---

## 6. Paths and Lenses

`NestedPath<T>` generates all dot paths of `T` (array indices as `${number}` segments) up to depth 4 (`DefaultMaxDepth`). Leaf types such as `Date`, typed arrays, `Map`, `Set`, `Blob` and functions are not descended into. `PathValue<T, P>` resolves the value type at a path.

```typescript
import {
    getNestedPath,
    hasNestedPath,
    setNestedPath,
    deleteNestedPath,
    createDocLens,
    type NestedPath,
} from '@actdim/livestruct';

type ShapePath = NestedPath<Shape>; // 'id' | 'name' | 'x' | 'y' | 'style' | 'style.fill' | 'style.stroke'

const fill = getNestedPath(rect.data, 'style.fill');        // string | undefined
const exists = hasNestedPath(rect.data, 'style.stroke');    // boolean
const moved = setNestedPath({ ...rect.data }, 'x', 5);      // new object, original untouched
const plain = deleteNestedPath({ ...rect.data }, 'style');  // new object without 'style'

const fillLens = createDocLens(rect, 'style.fill');
fillLens.get();                // reads rect.data
await fillLens.set('green');   // routes through rect.patchPath
```

`createLens` is an alias of `createDocLens`. Lenses never mutate `doc.data` directly.

---

## 7. JSON Safety

Document bodies are stored as JSON text. `assertJsonSafe(value)` runs on `create`, `patch`, `patchPath` and `replace` and throws `LiveStructValueError` (with a `path` property) for:

- `NaN` / `Infinity`, functions, symbols, bigints,
- `Date` (use ISO strings or numbers), `Map` (use plain objects), `Set` (use arrays),
- typed arrays and `ArrayBuffer` (use the BlobStore),
- class instances and circular references.

```typescript
import { LiveStructValueError } from '@actdim/livestruct';

try {
    await rect.patchUnchecked({ createdAt: new Date() });
} catch (err) {
    if (err instanceof LiveStructValueError) {
        console.warn(err.path, err.message); // 'createdAt', 'Date at createdAt: convert to ISO string or number'
    }
}
```

---

## 8. MobX Integration

Each document owns a MobX atom named `LiveDocument:<collection>:<id>`. Reading `doc.data` inside a MobX reaction or an `observer` component subscribes to it; every verified change calls `reportChanged()`.

For property-style access, `toObservableDocument(doc)` returns a cached `Proxy`: unknown property reads fall through to `doc.data`, and property writes call `doc.patchUnchecked({ [prop]: value })` asynchronously.

```typescript
import { autorun } from 'mobx';
import { toObservableDocument } from '@actdim/livestruct';

const shape = toObservableDocument(rect);
autorun(() => console.log(rect.data.x)); // re-runs on every change of rect
shape.name = 'Renamed';                  // schedules a patch; errors go to the error stream
```

---

## 9. The Engine and Change Data Capture

`LiveDocEngine` is the low-level layer (one per store, `store.engine`). Each document exposes a per-collection view of it as `doc.engine` (`LiveEngineAccess<T>`):

```typescript
// Read-only SQL. SELECT and PRAGMA only; other statements throw.
// A FROM clause naming a collection is rewritten into a subquery over the docs table.
// Rewritten rows expose id, collection, rev, data (JSON text), blobs, updated_at.
const rows = await rect.engine.queryRaw<{ id: string; rev: number; data: string }>(
    'SELECT * FROM shapes WHERE id = ?',
    ['rect-1']
);
const body = JSON.parse(rows[0].data) as Shape;

// Aggregates get a convenience 'count' alias for COUNT(*)
const [{ count }] = await store.engine.queryRaw<{ count: number }>('SELECT COUNT(*) FROM shapes');

// Raw commits: type 'insert' | 'update' (replace) | 'patch' | 'delete'
await rect.engine.commitRaw({ type: 'patch', id: 'rect-1', data: { x: 1 } });

// Change Data Capture for the collection
const sub = rect.engine.cdc$.subscribe((e) => console.log(e.type, e.id, e.delta));
```

`store.engine.cdc$` is the full `CDCEvent<T>` stream: `type` (`insert` / `update` / `delete`), `kind` (adds `replace`), `collection`, `id`, `rev`, `delta`, `data`, `timestamp`, `mutationId`, `overlayId`, `origin` (`local`, `remote`, `migration`). Local events are emitted synchronously; remote events come from LiveStore's `docs` table subscription by comparing revisions.

---

## 10. Binary Blobs

Binary payloads are not allowed in document bodies. The engine accepts a `BlobMap` (`Record<string, Uint8Array | Float32Array>`) on `insertDoc`, `updateDoc`, `patchDoc` and through `commitRaw({ ..., blobs })`. Each blob is stored in the `BlobStore` under the SHA-256 of a 1-byte type tag plus the bytes; the row's `blobs` column stores the name-to-hash map. `engine.getDoc()` rehydrates blobs as the original typed array type.

```typescript
const geometry = new Float32Array([0, 0, 10, 0, 10, 10]);
await store.engine.patchDoc('shapes', 'rect-1', { name: 'Poly' }, { vertices: geometry });

const record = await store.engine.getDoc<Shape>('shapes', 'rect-1');
const vertices = record?.blobs.vertices; // Float32Array
```

`LiveDocument` does not expose blobs on `doc.data`; use the engine for blob reads and writes.

---

## 11. Diagnostic Events

`store.events$` (and per document `doc.events$`) emit `LiveStructEvent` objects:

| `type` | Emitted when |
|---|---|
| `local_patch` | `patch` / `patchPath` applied locally. |
| `overlay_sent` | A coalesced overlay frame was posted. |
| `overlay_received` | A tentative overlay from another session arrived. |
| `commit` | The scheduler committed a document to SQLite (carries `rev`, `overlayId`, `patch`). |
| `remote_commit` | A remote commit was observed through LiveStore CDC or an overlay `commit` message (deduplicated). |

---

[<- Back to 01. Overview](./topic--01-overview-and-advantages.md) | [Next: 03. Architecture & Wiring ->](./topic--03-architecture-and-wiring.md)
