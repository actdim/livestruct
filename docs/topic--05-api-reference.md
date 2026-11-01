---
protocol: along
slug: 05-api-reference
title: API Reference
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [05-api-reference, api, contracts, exports]
---

# API Reference

[<- Back to 04. Integration Guide](./topic--04-integration-guide.md) | [Back to Main README](../README.md)

---

## Entry Points

| Import path | Re-exports |
|---|---|
| `@actdim/livestruct` | `createLiveStruct` + engine module + lens module + document module (+ deprecated `LiveSqliteEngine`). |
| `@actdim/livestruct/engine` | engine module + document module + lens module (no `createLiveStruct`). |
| `@actdim/livestruct/document` | document module (via the `./*` wildcard export). |
| `@actdim/livestruct/lens` | lens module (via the `./*` wildcard export). |
| `@actdim/livestruct/worker` | Side-effect worker script: `makeWorker({ schema })`. No exports. |
| `@actdim/livestruct/shared-worker` | Side-effect SharedWorker script: imports `@livestore/adapter-web/shared-worker`. No exports. |

Below, symbols are grouped by module. All of them are available from the root import `@actdim/livestruct`.

---

## Store Factory (`src/index.ts`)

| Symbol | Signature | Purpose |
|---|---|---|
| `createLiveStruct` | `(config: LiveStructConfig) => Promise<LiveStoreInstance>` | Creates engine, overlay channel and commit scheduler; returns the store with collection access, flush and close. |

---

## Document Module (`src/document/`)

### Contracts (`types.ts`)

| Symbol | Kind | Summary |
|---|---|---|
| `Disposable` | interface | `dispose(): void`, `readonly isDisposed: boolean`. |
| `PatchPayload<T>` | type | Recursive RFC 7396 patch: optional keys, nested objects partial or `null`, arrays replaced whole, leaves `T[K] \| null`. |
| `CommitPolicy` | type | `'lazy' \| 'immediate'`. |
| `LiveStructEventType` | type | `'local_patch' \| 'overlay_sent' \| 'overlay_received' \| 'commit' \| 'remote_commit'`. |
| `LiveStructEvent` | interface | `type`, `collection`, `id`, `timestamp`, optional `rev`, `overlayId`, `senderSessionId`, `origin`, `patch`. |
| `LiveDocumentOptions` | interface | `commitPolicy?`, `commitDelayMs?`, `maxCommitWaitMs?` - per-collection commit settings. |
| `LiveDocument<T>` | interface | High-level document (members below). |
| `ILiveDocument<T>` | type | Alias of `LiveDocument<T>`. |
| `LiveCollection<T>` | interface | High-level collection (members below). |
| `LiveStructConfig` | interface | Store configuration (fields below). |
| `LiveStoreInstance` | interface | Store returned by `createLiveStruct` (members below). |
| `ObservableLiveDocument<T>` | type | `LiveDocument<T> & T` - result of `toObservableDocument`. |

#### `LiveDocument<T>` members

| Member | Type | Purpose |
|---|---|---|
| `id`, `collectionName` | `string` | Identity. |
| `data` | `Readonly<T>` | Deeply frozen current snapshot; MobX-tracked read. |
| `$` | `Observable<Readonly<T>>` | Current value plus every verified change. |
| `errors$` | `Observable<Error>` | Deferred commit errors. |
| `events$` | `Observable<LiveStructEvent>` | Store events filtered to this document. |
| `isPending` | `boolean` | Local uncommitted patches exist. |
| `isTentative` | `boolean` | Showing another context's uncommitted overlay. |
| `patch(partial)` | `(partial: PatchPayload<T>) => Promise<void>` | RFC 7396 merge patch; instant locally, resolves when committed. |
| `patchUnchecked(patch)` | `(patch: Record<string, unknown>) => Promise<void>` | Untyped `patch`. |
| `patchPath(path, value)` | `<P extends NestedPath<T>>(path: P, value: PathValue<T, P>) => Promise<void>` | SET at a dot path (committed as `DocPathSet`). |
| `replace(value)` | `(value: T) => Promise<void>` | Replaces the committed body (engine `updateDoc`), pending patches re-applied on top. |
| `flush()` | `() => Promise<void>` | Commits this document's pending patches now. |
| `subscriptionCount` | `number \| undefined` | 1 while the CDC subscription is active, else 0. |
| `engine` | `LiveEngineAccess<T>` | Per-collection low-level access. |
| `dispose()`, `isDisposed` | - | From `Disposable`. |

#### `LiveCollection<T>` members

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string` | Collection name. |
| `subscriptionCount` | `number` | Collection CDC subscription plus document subscriptions. |
| `get(id)` | `(id: string) => Promise<LiveDocument<T> \| null>` | Cached or loaded document; `null` if absent. |
| `create(id, initialData)` | `(id: string, initialData: T) => Promise<LiveDocument<T>>` | Inserts; throws if the id exists. |
| `delete(id)` | `(id: string) => Promise<void>` | Deletes the row and disposes the cached document. |
| `find(predicate?)` | `(predicate?: (item: T) => boolean) => Promise<Array<LiveDocument<T>>>` | All (or matching) documents. |
| `query$` | `Observable<Array<LiveDocument<T>>>` | All documents, refreshed on collection CDC. |
| `errors$` | `Observable<Error>` | Query refresh errors. |
| `flush()` | `() => Promise<void>` | Commits all pending patches of the collection. |
| `dispose()`, `isDisposed` | - | From `Disposable`. |

#### `LiveStructConfig` fields

`name: string`; optional `storagePath`, `forceMemory`, `sessionId`, `disableDevtools`, `confirmUnsavedChanges`, `worker`, `sharedWorker`, `commitPolicy` (default `'lazy'`), `commitDelayMs` (150), `maxCommitWaitMs` (1000), `overlayTtlMs` (1500), `disableOverlay`.

#### `LiveStoreInstance` members

| Member | Signature | Purpose |
|---|---|---|
| `engine` | `LiveDocEngine` | Low-level engine. |
| `storageMode` | `string` | `'persisted'`, `'single-tab'` or `'in-memory'` (from LiveStore), else storage adapter mode. |
| `errors$` | `Observable<Error>` | Commit scheduler errors. |
| `events$` | `Observable<LiveStructEvent>` | Diagnostic events. |
| `collection(name, options?)` | `<T extends object>(name: string, options?: LiveDocumentOptions) => Promise<LiveCollection<T>>` | Cached collection by name. |
| `flush()` | `() => Promise<void>` | Commits all pending patches. |
| `close()` | `() => Promise<void>` | Flushes, disposes everything and closes the engine. |

### Implementations

| Symbol | Signature | Purpose |
|---|---|---|
| `LiveDocumentImpl<T>` | `class implements LiveDocument<T>, CommitSchedulerDocumentTarget, OverlayDocumentTarget` | Document implementation; constructed by collections (`(collectionName, id, initialData, initialRev, rawEngine, engineAccess, commitScheduler?, overlayChannel?, options?, onEvent?, allEvents$?)`). |
| `LiveCollectionImpl<T>` | `class implements LiveCollection<T>` | Collection implementation (`(name, rawEngine, commitScheduler?, overlayChannel?, options?, onEvent?, allEvents$?)`). |
| `toObservableDocument` | `<T extends object>(doc: LiveDocument<T>) => ObservableLiveDocument<T>` | Cached Proxy: property reads from `doc.data`, property writes call `patchUnchecked`. |

### Commit scheduling (`commitScheduler.ts`)

| Symbol | Kind | Summary |
|---|---|---|
| `CommitSchedulerDocumentTarget` | interface | `onCommitSuccess(newRev, committedData, overlayId, committedPatch)`, `onCommitError(failedPatch, err)`. |
| `CommitSchedulerConfig` | interface | `commitPolicy?`, `commitDelayMs?`, `maxCommitWaitMs?`, `overlayChannel?`, `onEvent?`. |
| `CommitScheduler` | class | `new CommitScheduler(engine: LiveDocEngine, config?)`. |

`CommitScheduler` members: `defaultPolicy`, `defaultDelayMs`, `defaultMaxWaitMs`, `errors$`, `reportError(err)`, `registerDocument(collection, id, doc)`, `unregisterDocument(collection, id)`, `hasPending(collection, id)`, `getPendingPatch(collection, id)`, `getPendingOverlayId(collection, id)`, `schedulePatch(collection, id, patch, blobs?, options?) => { promise, overlayId }`, `schedulePathSet(collection, id, path, value, options?) => { promise, overlayId }`, `commitBatch(docKeys, isFlush?)`, `flushDoc(collection, id)`, `flushCollection(collection)`, `flushAll()`, `dispose()`.

### Overlays (`overlayChannel.ts`)

| Symbol | Kind | Summary |
|---|---|---|
| `OverlayMessage` | interface | `{ type: 'overlay', collection, id, patch, overlayId, senderSessionId, timestamp }`. |
| `CommitMessage` | interface | `{ type: 'commit', collection, id, overlayId, patch?, rev?, senderSessionId, timestamp }`. |
| `OverlayChannelMessage` | type | `OverlayMessage \| CommitMessage`. |
| `OverlayDocumentTarget` | interface | `applyRemoteOverlay(patch, overlayId)`, `clearRemoteOverlay(overlayId)`, optional `applyRemoteCommit(patch, rev, overlayId)`. |
| `OverlayChannelOptions` | interface | `storeId`, `sessionId?`, `overlayTtlMs?` (1500), `disabled?`, `onEvent?`. |
| `OverlayChannel` | class | `BroadcastChannel` named `livestruct:<storeId>:overlay`. |

`OverlayChannel` members: `storeId`, `sessionId`, `overlayTtlMs`, `registerDocument(collection, id, doc)`, `unregisterDocument(collection, id)`, `sendTentative(collection, id, patch, overlayId)`, `flushOutgoing()`, `broadcastCommit(collection, id, overlayId, patch?, rev?)`, `dropOverlay(collection, id, overlayId?)`, `dispose()`.

### Helpers

| Symbol | Signature | Purpose |
|---|---|---|
| `LiveStructValueError` | `class extends Error { readonly path?: string }` | Thrown by `assertJsonSafe`. |
| `ErrorSink` | `{ next(err: Error): void } \| ((err: Error) => void) \| undefined` | Target for `reportAsync`. |
| `reportAsync` | `<T>(promise: Promise<T> \| undefined \| null, context: string, errors$?: ErrorSink) => Promise<T \| undefined>` | Swallows a rejection and routes it to an error sink. |
| `deepFreeze` | `<T>(obj: T) => Readonly<T>` | Recursive `Object.freeze`. |
| `deepEquals` | `(a: unknown, b: unknown) => boolean` | Structural equality (arrays, plain objects, `Uint8Array`, `Float32Array`). |
| `assertJsonSafe` | `(value: unknown, path?: string, seen?: Set<unknown>) => void` | Rejects non-JSON values with `LiveStructValueError`. |
| `toSqliteJsonPath` | `(path: string) => string` | `'items.0.title'` -> `'$.items[0].title'`. |
| `setAtPath` | `<T extends object>(target: T, path: string, value: unknown) => T` | SET at a path on a `structuredClone`. |
| `buildPathPatch` | `<T extends object, P extends NestedPath<T>>(target: T, path: P, value: PathValue<T, P>) => Record<string, unknown>` | Builds a merge patch equivalent to a path write. |

---

## Lens Module (`src/lens/`)

| Symbol | Signature | Purpose |
|---|---|---|
| `Primitive` | type | `string \| number \| boolean \| bigint \| symbol \| null \| undefined`. |
| `LeafTypes` | type | Types not descended into by `NestedPath` (primitives, `Function`, `Date`, `RegExp`, typed arrays, `ArrayBuffer`, `DataView`, `Blob`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`). |
| `IsLeaf<T>` | type | `true` if `T` is a leaf (or `any`). |
| `DepthCounter` | type | `readonly unknown[]` recursion counter. |
| `DefaultMaxDepth` | type | `4`. |
| `NestedPath<T, Depth?>` | type | Union of all dot paths of `T` up to `DefaultMaxDepth`. |
| `PathValue<T, P>` | type | Value type at path `P`. |
| `PatchPayload<T>` | type | Re-exported from the document types. |
| `getNestedPath` | `<T, P extends NestedPath<T>>(obj: T, path: P) => PathValue<T, P> \| undefined` | Safe read. |
| `hasNestedPath` | `<T>(obj: T, path: string) => boolean` | Own-property / index existence check. |
| `setNestedPath` | `<T, P extends NestedPath<T>>(obj: T, path: P, value: PathValue<T, P>) => T` | Immutable set; creates missing objects or arrays. |
| `deleteNestedPath` | `<T, P extends NestedPath<T>>(obj: T, path: P) => T` | Immutable delete (array items are spliced). |
| `LensDocumentTarget<T>` | interface | `{ readonly data: Readonly<T>; patchPath(path, value): Promise<void> }`. |
| `createDocLens` | `<T extends object, P extends NestedPath<T>>(doc: LensDocumentTarget<T>, path: P) => { path; get(); set(value): Promise<void> }` | Lens bound to a document path; writes go through `patchPath`. |
| `createLens` | same as `createDocLens` | Alias. |

---

## Engine Module (`src/engine/`)

### Types (`types.ts`)

| Symbol | Kind | Summary |
|---|---|---|
| `StorageMode` | type | `'opfs' \| 'single-tab' \| 'memory' \| 'persisted' \| 'in-memory'`. |
| `StorageAdapter` | interface | `mode`, `read(path)`, `write(path, data)`, `delete(path)`, `exists(path)`, `close?()`. |
| `BlobMap` | type | `Record<string, Uint8Array \| Float32Array>`. |
| `DocumentRecord<T>` | interface | `collection`, `id`, `rev`, `data`, `blobs`, `updatedAt`. |
| `CDCEventType` | type | `'insert' \| 'update' \| 'delete'`. |
| `CDCEventKind` | type | `CDCEventType \| 'replace'`. |
| `CDCEvent<T>` | interface | `type`, `kind?`, `collection`, `id`, `rev`, `delta`, `data?`, `timestamp`, `mutationId?`, `overlayId?`, `origin?`. |
| `RawCommitEvent<T>` | interface | `type: 'insert' \| 'update' \| 'patch' \| 'delete'`, `collection`, `id`, `data?`, `blobs?`, `rev?`, `mutationId?`, `overlayId?`, `origin?`. |
| `EngineConfig` | interface | `name`, `storagePath?`, `forceMemory?`, `sessionId?`, `disableDevtools?`, `confirmUnsavedChanges?`, `worker?`, `sharedWorker?`. |
| `LiveEngineAccess<T>` | interface | `tableName`, `commitRaw(event)`, `queryRaw<R>(sql, params?)`, `cdc$`. |

### Engine (`liveStoreEngine.ts`)

| Symbol | Signature | Purpose |
|---|---|---|
| `LiveStoreInstanceLike` | interface | Minimal LiveStore surface used by the engine: `query`, `commit`, `subscribe`, optional `storageMode`, `shutdownPromise`, `isClosed`. |
| `LiveDocEngine` | `class` - `new LiveDocEngine(config: EngineConfig, storeOrStorage?: unknown, blobStore?: BlobStore)` | Document engine over a LiveStore instance. |
| `LiveSqliteEngine` | alias of `LiveDocEngine` | Deprecated name, kept for compatibility. |
| `createLiveEngine` | `(config: EngineConfig) => Promise<LiveDocEngine>` | Resolves adapter and blob store, creates the LiveStore with the built-in schema, initializes the engine. |

`LiveDocEngine` members:

| Member | Signature | Purpose |
|---|---|---|
| `config`, `store`, `blobStore`, `storage` | properties | Configuration and collaborators. |
| `isClosed`, `storageMode`, `subscriptionCount` | getters | State. |
| `cdc$` | `Observable<CDCEvent<unknown>>` | Full CDC stream (local and remote). |
| `init()` | `() => Promise<this>` | Migrates legacy v1 data, seeds known rows, subscribes to `tables.docs`. |
| `insertDoc` | `<T>(collection, id, data: T, blobs?, mutationId?) => Promise<DocumentRecord<T>>` | `DocInserted`; throws on duplicate id. |
| `updateDoc` | `<T>(collection, id, data: T, blobs?, mutationId?) => Promise<DocumentRecord<T>>` | `DocReplaced` (upsert, full body). |
| `patchDoc` | `<T>(collection, id, patch, blobs?, mutationId?) => Promise<DocumentRecord<T>>` | `DocPatched` (RFC 7396). |
| `setPathDoc` | `<T>(collection, id, path, value, mutationId?) => Promise<DocumentRecord<T>>` | `DocPathSet` (`json_set`). |
| `commitBatchedPatches` | `(entries: Array<{ collection; id; patch?; pathSet?; pathSets?; blobs?; mutationId?; overlayId?; emitCDC? }>) => Promise<DocumentRecord[]>` | Many patches in one `store.commit`. |
| `deleteDoc` | `(collection, id, mutationId?) => Promise<boolean>` | `DocDeleted`; `false` if absent. |
| `getDoc` | `<T>(collection, id) => Promise<DocumentRecord<T> \| null>` | Snapshot with rehydrated blobs. |
| `queryDocs` | `<T>(collection, predicate?: (doc: DocumentRecord<T>) => boolean) => Promise<DocumentRecord<T>[]>` | All rows of a collection (blobs not loaded). |
| `emitCDC` | `(event: CDCEvent<unknown>) => void` | Pushes an event to `cdc$`. |
| `getEngineAccess` | `<T>(collection) => LiveEngineAccess<T>` | Collection-scoped access (used as `doc.engine`). |
| `commitRaw` | `(event: unknown, defaultCollection?) => Promise<void>` | Dispatches a `RawCommitEvent` to insert/update/patch/delete. |
| `queryRaw` | `<R>(sql, params?, defaultCollection?) => Promise<R[]>` | Read-only SQL (`SELECT` / `PRAGMA`); collection names in `FROM` are rewritten to a `docs` subquery. |
| `close()` | `() => Promise<void>` | Completes `cdc$`, writes the legacy JSON snapshot to `storage`, closes blobs, shuts down LiveStore. |

### Schema (`schema.ts`)

| Symbol | Summary |
|---|---|
| `docs` | `State.SQLite.table` `docs`: `key` (PK), `collection`, `id`, `body`, `rev`, `updatedAt`, `blobs`, `mutationId`, `overlayId`, `origin`; index `idx_docs_collection_updatedAt`. |
| `tables` | `{ docs }`. |
| `events` | `DocInserted`, `DocReplaced`, `DocPatched`, `DocPathSet`, `DocDeleted` (names `livestruct.v1.*`, `Events.synced`). |
| `makeDocKey` | `(collection: string, id: string) => string` - `` `${collection}\u0001${id}` ``. |
| `state` | `State.SQLite.makeState({ tables, materializers })`. |
| `schema` | `makeSchema({ state, events })` - pass to `makeWorker({ schema })`. |

### Patching (`patch.ts`)

| Symbol | Signature | Purpose |
|---|---|---|
| `jsonMergePatch` | `<T>(target: unknown, patch: unknown) => T` | Applies an RFC 7396 merge patch. |
| `mergePatches` | `(basePatch, newPatch) => Record<string, unknown>` | Combines two merge patches, keeping `null` tombstones. |

### Adapters and storage

| Symbol | Signature | Purpose |
|---|---|---|
| `ResolvedLiveStoreConfig` | interface `{ adapter, sessionId, storageMode: 'persisted' \| 'single-tab' \| 'in-memory' }` | Result of adapter resolution. |
| `resolveLiveStoreAdapter` | `(config: EngineConfig) => ResolvedLiveStoreConfig` | Picks persisted / single-tab / in-memory LiveStore adapter. |
| `MemoryStorageAdapter` | `class implements StorageAdapter` | In-memory file storage (`mode: 'memory'`). |
| `OpfsStorageAdapter` | `class implements StorageAdapter` | OPFS file storage with serialized, retried writes (`mode: 'opfs'`). |
| `resolveStorageAdapter` | `(config: EngineConfig) => Promise<StorageAdapter>` | OPFS when available, else memory. |
| `migrateLegacyV1` | `(config, store: { commit }, blobStore, storageOverride?) => Promise<boolean>` | Imports a v1 `<name>.db` JSON file once and renames it to `.migrated`. |

### Blobs

| Symbol | Signature | Purpose |
|---|---|---|
| `BlobStore` | interface `put(data) => Promise<string>`, `get(hash)`, `delete?(hash)`, `close?()` | Content-addressed binary store. |
| `MemoryBlobStore` | `class implements BlobStore` | In-memory map. |
| `OpfsBlobStore` | `class implements BlobStore` | OPFS directory `livestruct-blobs/<sha256>` with in-memory fallback. |
| `resolveBlobStore` | `(forceMemory?: boolean) => BlobStore` | OPFS when available and not forced to memory. |
| `serializeBlobs` | `(blobs?: BlobMap \| null) => Uint8Array \| null` | Legacy `LSB1` container format (used by v1 migration). |
| `deserializeBlobs` | `(buffer?: Uint8Array \| null) => BlobMap` | Reads the `LSB1` container format. |

---

[<- Back to 04. Integration Guide](./topic--04-integration-guide.md) | [Back to Main README](../README.md)
