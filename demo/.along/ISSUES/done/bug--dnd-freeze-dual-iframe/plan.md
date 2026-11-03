# Living Plan: dnd-freeze-dual-iframe

## Revision 1 (2026-10-31T22:50:35Z, ExitPlanMode)

# DnD freeze in livestruct-demo (dual iframe): tickets + implementation plan

On approval this session ONLY creates the 8 tickets below (each ticket file gets its full section
of this plan as `## Plan`), sets `blocked_by` links, and syncs the boards. No source edits here;
another agent implements from the tickets.

| # | Package | Key | Prio | Blocked by |
|---|---|---|---|---|
| T1 | livestruct | `bug--lazy-coalesced-persistence` | high | - |
| T2 | livestruct-demo | `bug--dnd-freeze-dual-iframe` (exists) | high | T1 |
| T3 | livestruct | `bug--cross-context-last-writer-wins` | high | T1 |
| T4 | livestruct | `bug--engine-correctness-batch` | medium | T1 (T3 for errors$ `replication` kind) |
| T5 | livestruct | `debt--test-coverage-and-naming` | low | T3, T4 |
| T6 | msgmesh-store | `bug--bridge-sync-correctness` | high | T1 (livestruct) |
| T7 | msgmesh-store | `bug--worker-transport-lifecycle` | medium | T6 (shared core modules) |
| T8 | msgmesh-store | `debt--perf-tests-and-types` | low | T6 (step 1 is done inside T6) |

Recommended execution order: T1 -> T2 (fixes the user-visible freeze) -> T3 -> T4 -> T6 -> T7 -> T8 -> T5.
Note: once T3 lands, the demo's own BroadcastChannel mutation replication (`cad/broadcast.ts`
`cad.cdc.mutation`) becomes redundant with engine coordination; T3 must add a follow-up note to
the demo ticket board (drag stream stays in the demo, it is ephemeral and never persisted).

Review baseline: livestruct 67/67 tests pass, msgmesh-store 30/30 pass (several tests weak).

## Context
"Dual iframe Split" mode: host shell + iframe A + iframe B are same-origin, so all three run on
ONE main thread, share one BroadcastChannel (`livestruct_cad_mesh`) and one OPFS file (`cad_store.db`).
Root causes (verified in code):

1. **Double publish per mousemove** - `VectorCanvas.tsx` publishes from canvas `onMouseMove`
   (L199-229) AND the global `window` mousemove listener (L280-306). Each physical move = 2 bus
   messages = 2 BroadcastChannel posts = 4 peer deliveries.
2. **Drag stream not coalesced** - every mouse event (120+ Hz on many mice) -> `bus.send` ->
   BroadcastChannel -> host + other iframe -> their bus -> React `setState` + redraw, plus a
   TelemetryMonitor event on host. All on the shared thread.
3. **Peer churn** - per message: `setRemotePeerDraggingShapeId`, `clearTimeout/setTimeout`
   (VectorCanvas L139-150); in `broadcast.ts` a signature string + `Set.add` + `setTimeout(3000)`
   per message (L68-75). The ghost is cleared on ANY doc update (VectorCanvas L106-112), e.g. a late
   `selectShape` CDC -> flicker.
4. **Write storm per commit** - `LiveSqliteEngine` is an in-memory Map (not SQLite). Every
   insert/update/patch/delete awaits `persistToStorage()` = `JSON.stringify` of the whole store +
   all blobs + OPFS `createWritable` (`sqliteEngine.ts:81,122,168,195,395-436`), and CDC is emitted
   only AFTER the disk write. Peers apply the remote delta via `doc.patch` and rewrite the same
   OPFS file -> 3 contexts contend for the file lock (retry 25..125 ms x5 in `storage.ts:95-108`,
   failure swallowed). Mousedown `selectShape` triggers another full round.

Target: persistence and cross-peer sync deferred/coalesced ("lazy"), interaction path never waits
for disk or for peers.

---

## T1 - livestruct: `bug--lazy-coalesced-persistence` (livestruct `.along/`, priority high)

Requirements
- REQ-1: Engine MUST coalesce writes: a burst of N mutations within the debounce window -> 1 `storage.write` of the db file.
- REQ-2: Engine MUST emit CDC synchronously after the in-memory mutation, before any disk I/O.
- REQ-3: `close()` MUST flush pending state; public `flush()` MUST persist pending state and resolve after the write.
- REQ-4: A write with `persist: false` MUST update memory + emit CDC without scheduling a write.
- REQ-5: LiveDocument MUST NOT produce unhandled rejections from its CDC refresh path.

Steps
1. `src/engine/types.ts`
   - `EngineConfig.persistDebounceMs?: number` (doc: default 150; `0` = flush on next macrotask).
   - `export interface WriteOptions { persist?: boolean }`.
2. `src/document/types.ts`: `LiveStructConfig.persistDebounceMs?: number`;
   `export interface PatchOptions { persist?: boolean; mutationId?: string }`;
   `LiveDocument.patch(partial, options?: PatchOptions)`.
   `src/index.ts`: pass `persistDebounceMs` to `createLiveEngine`; export new types.
3. `src/engine/sqliteEngine.ts`
   - Fields: `private persistTimer: ReturnType<typeof setTimeout> | null`, `private dirty = false`,
     `private persistInFlight: Promise<void> | null`, `lastPersistError: unknown` (public readonly getter).
   - `private schedulePersist(): void` - set `dirty = true`; if no timer, `setTimeout(() => void this.flush(), debounceMs)`.
   - `async flush(): Promise<void>` - clear timer; if `persistInFlight` await it; if `!dirty` return;
     `dirty = false`; `persistInFlight = this.persistToStorage()`; await; null it. If writes arrive during
     the flush, `dirty` becomes true again and the timer re-arms (loop until clean).
   - `insertDoc/updateDoc/patchDoc/deleteDoc`: add trailing `options?: WriteOptions`; replace
     `await this.persistToStorage()` with `if (options?.persist !== false) this.schedulePersist();`
     and move `cdcSubject.next(...)` to right after `documents.set/delete`. Keep methods `async`
     (signature compatible).
   - `persistToStorage`: set `lastPersistError` in the catch (still no throw); only write blob
     files whose doc changed since last flush (track `dirtyBlobKeys: Set<string>` filled when a write
     passes `blobs`).
   - `close()`: `this._isClosed = true; await this.flush();` (flush must bypass `assertNotClosed`).
   - `commitRaw` passes through to the same methods (unchanged semantics).
4. `src/document/liveDocument.ts`
   - `patch(partial, options?)`: `mutationId = options?.mutationId ?? 'mut_...'`; pass
     `{ persist: options?.persist }` to `patchDoc`.
   - CDC refresh path (L80): add `.catch(() => {})` (engine closed / doc deleted).
5. Tests
   - `tests/engine.test.ts`: spy `engine.storage.write` (MemoryStorageAdapter):
     a) 20 `patchDoc` calls -> 0 writes synchronously, 1 write after `await engine.flush()`;
     b) CDC observed before `flush()`;
     c) `close()` persists -> reopen with the same adapter instance sees data;
     d) `{ persist: false }` -> `flush()` performs 0 writes;
     e) fake timers: after `persistDebounceMs` one write happens without explicit flush.
   - `tests/document.test.ts`: `patch(x, { mutationId: 'rmt_1' })` -> CDC carries `rmt_1`; echo suppression still works.
   - Existing tests reading storage right after a write: add `await engine.flush()` where needed.
6. Docs: `README.md` / `docs/` - document lazy persistence, `flush()`, `persistDebounceMs`, `persist:false`.

Acceptance: `pnpm test` + `tsc -b` green in livestruct; msgmesh-store tests still green (consumes the engine).

---

## T2 - livestruct-demo: `bug--dnd-freeze-dual-iframe` (exists, in-progress; `blocked_by: [livestruct bug--lazy-coalesced-persistence]`)

Requirements (already in the ticket) + steps:
1. New `src/cad/frameCoalescer.ts`:
   `createFrameCoalescer<T>(flush: (value: T) => void): { push(v: T): void; flushNow(): void; cancel(): void }` -
   keeps the latest value, schedules one `requestAnimationFrame` (fallback `setTimeout(16)` when RAF is
   undefined, e.g. node tests), calls `flush(latest)` once per frame.
2. `src/components/VectorCanvas.tsx`
   - Remove drag handling from canvas `onMouseMove` (keep only hover cursor when no drag); the window
     listener is the single source.
   - Window mousemove: update `drag.currentDx/Dy`, `requestDraw()`, `dragPublisher.push(payload)`
     where `dragPublisher = createFrameCoalescer(p => store.publishCursorDrag(p))` (in a ref).
   - mouseup: `dragPublisher.flushNow()` before commit; `cancel()` on unmount.
   - Remote drag listener: write payload to `remoteDragRef`, `requestDraw()`; call
     `setRemotePeerDraggingShapeId` only when the id differs from the current ref value; replace
     per-message `setTimeout` with `lastRemoteAt` timestamp + ONE interval/timeout armed only while a
     ghost is visible (checks `Date.now() - lastRemoteAt > 800`).
   - Doc `$` subscription: clear the ghost only if `updatedDoc.shapes[id] !== prevDoc.shapes[id]`
     (the shape itself changed), not on any update.
3. `src/cad/store.ts`
   - `publishCursorDrag`: stamp `senderId: payload.senderId ?? this.senderId`.
   - Add `applyRemotePatch(delta)` -> `doc.patch(delta, { persist: false, mutationId: 'rmt_' + ... })`;
     do not touch undo stack / commit counters.
   - Remote undo/redo (`applySnapshot` when triggered by a peer): use `persist: false` too
     (add a `{ remote?: boolean }` arg to `undo/redo`).
4. `src/cad/broadcast.ts`
   - Drag forward: skip when `payload.senderId !== senderId` (it is a re-sent remote message) -
     replaces `remoteDragSignatures` Set + per-message `setTimeout`; delete `recordRemoteSignature`.
   - Remote `cad.cdc.mutation` / `cad.project.imported`: `store.applyRemotePatch(...)`.
   - Remove `remoteMutationDepth` and `recentRemoteMutationIds` (dead: keys never match). The CDC
     forwarder already rebroadcasts only `mut_` ids, so `rmt_` patches are never re-broadcast and
     concurrent local edits are no longer suppressed.
   - Add `.catch` to fire-and-forget patches (log via `console.warn`).
5. `src/components/TelemetryMonitor.tsx`: move timestamp trimming (`filter` over 5 s window) out of
   `addEvent` into `flushBuffer` / the 1 s interval (now O(1) per event).
6. Root `.claude/launch.json` (in write scope): add
   `{ "name": "livestruct-demo", "runtimeExecutable": "pnpm", "runtimeArgs": ["--dir", "src/packages/livestruct-demo", "dev"], "port": 4173 }`.
7. Tests (node env, no React rendering available):
   - `tests/frameCoalescer.test.ts`: 100 pushes -> 1 flush with the last value; `flushNow`; `cancel`.
   - `tests/splitSimulator.test.ts`: remote mutation on B does not rebroadcast back to A (spy
     BroadcastChannel / count A's received mutations) and causes 0 `storage.write` on B after
     `engine.flush()`; update `toEqual(dragPayload)` -> `toMatchObject` (payload now carries `senderId`).
   - Existing vectorCanvas/telemetry tests stay green.
8. Browser verification (mandatory): `preview_start livestruct-demo` -> Dual iframe Split -> scripted
   drag in iframe A (dispatch mousedown/mousemove x200/mouseup); `PerformanceObserver('longtask')` in
   host: no task > 50 ms; B shows ghost moving and final position after mouseup; console clean;
   screenshot as proof.

Acceptance: as in the ticket + steps 7-8.

Commit order: livestruct (T1) -> livestruct-demo (T2) via `/along-commit`, then root submodule
pointers + launch.json in one root commit. No version bump.

---

## T3 - livestruct: `bug--cross-context-last-writer-wins` (high, blocked by T1)

Problem: each same-origin context (host + iframes / tabs) holds its own Map and dumps it to the same
OPFS file -> last writer erases other contexts' documents; no coordination, no reload on external change.

Decision: **single leader orders all writes**. Followers forward writes to the leader; the leader
assigns per-doc `rev` + global `seq` and broadcasts the committed record. Conflict policy = LWW in
leader receive order; insert uniqueness enforced globally. (Rejected: multi-writer timestamp LWW -
cannot enforce uniqueness, duplicate revs.)
Default `coordination.mode: 'auto'` = on when storage is OPFS and `BroadcastChannel` + `navigator.locks`
exist; off for memory storage unless a transport is injected (existing tests unchanged). OPFS without
locks -> sole writer + `coordination-degraded` error event.

Requirements
- REQ-1 At most one context per `lockName` MUST write the storage file.
- REQ-2 Followers MUST apply replicated commits with `persist:false` and never write the file.
- REQ-3 Every write MUST carry a `mutationId` (`${contextId}:${n}` if absent); `mutationId` + `origin` MUST reach every context's CDC unchanged (keeps LiveDocument echo suppression working).
- REQ-4 Leader MUST release the lock only after its final flush settled.
- REQ-5 Late joiner MUST converge to `seq >=` leader state at join time, no missing/duplicated mutations.
- REQ-6 Forwarded write MUST reject after `writeTimeoutMs` (5000); on leader change it MUST be resent with the same `mutationId`; leader dedups.
- REQ-7 MUST be testable in node via injected `transport` and `locks`.

Steps
1. `src/engine/coordination/types.ts`: `ReplicationTransport { post; subscribe(h) => unsub; close }`,
   `TransportFactory`, `LockProvider { request(name, cb: () => Promise<void>) }`, `ReplicationMessage`
   union: `hello{from}`, `sync{to,epoch,seq}`, `leader{from,epoch,seq}`, `resign{from,epoch}`,
   `req{from,mutationId,op}`, `nack{to,mutationId,error}`,
   `commit{epoch,seq,origin,mutationId,kind,collection,id,rev,updatedAt,data?,delta?,path?,blobs?}`.
2. Defaults: `broadcastChannelTransport` (channel `livestruct:${config.name}`), `webLocksProvider`
   (`navigator.locks.request(name,{mode:'exclusive'},cb)`), `soleWriterLockProvider`.
3. `EngineConfig.coordination?: { mode?: 'auto'|'on'|'off'; channelName?; lockName?; transport?; locks?; writeTimeoutMs?; syncTimeoutMs? }`
   (+ pass-through in `LiveStructConfig` / `createLiveStruct`).
4. `sqliteEngine.ts`: all state changes go through sync `private applyOp(op, meta{rev,seq,updatedAt,mutationId,origin}, opts)`
   (emits CDC). Public writes call `submit(op)`: leader/sole -> validate, `applyOp`, `seq++`,
   broadcast `commit`, `schedulePersist()`; follower -> post `req`, await matching `commit` / `nack` / timeout.
5. `src/engine/coordination/coordinator.ts`: on init subscribe + buffer commits, post `hello`, queue
   lock request (not awaited). On lock grant: `epoch = maxSeen+1`, `seq = max(fileSeq, seenSeq)`,
   broadcast `leader`, enable persistence and `schedulePersist()` immediately (recovers unflushed
   state of a crashed leader), re-submit own pending reqs locally. Leader on `hello`: `await flush()`,
   reply `sync{seq}`. Follower on `sync`: reload from storage, apply buffered commits with
   `seq > fileSeq`; fallback after `syncTimeoutMs`. Ignore stale epochs; apply commit only if
   `rev > localRev` (replay-safe).
6. Storage header v2: `{version:2, seq, epoch, documents}` (read v1).
7. `close()`: leader -> flush, `resign`, release lock; follower -> reject pending, close transport.
   `pagehide` -> best-effort `flush()`.
8. `CDCEvent` += `kind`, `rev`, `origin`, `data` (post-write state), `remote`; pass `rev` through
   `getEngineAccess` (currently dropped, `sqliteEngine.ts:249`).
9. `tests/helpers/fakeBus.ts`: microtask delivery to all endpoints except sender, `structuredClone`
   payloads; `FakeLockManager` (FIFO, `crash(ctx)`).

Tests (`tests/multiContext.test.ts`, 3 engines on one MemoryStorageAdapter + fake bus + fake locks)
- A inserts d1, B inserts d2, C patches d1 -> after flush a fresh engine loads d1 and d2 (the data-loss case).
- Same-id insert from two followers -> one succeeds, the other rejects "already exists".
- Echo: B's `LiveDocument.patch` emits once in B; A's LiveDocument for the doc emits the remote change.
- Leader close -> B leads; A's in-flight req resent and committed exactly once; file complete.
- Leader crash without flush -> new leader persists full state.
- Late joiner with file N commits behind catches up from buffer, no duplicate CDC.
- Stalled leader -> follower write rejects after timeout (fake timers).
- `mode:'off'` / memory storage behave exactly as today.

Acceptance: data-loss scenario passes; write spy proves no non-leader writes the file; existing suite green.
Risks: frozen/bfcached leader stalls follower writes until timeout (consider takeover when leader
hidden); large blobs in `commit` messages - send blobs only when changed; follower writes cost one
round trip (hidden by optimistic UI).

---

## T4 - livestruct: `bug--engine-correctness-batch` (medium, blocked by T1)

Each row lands with a test that fails before the fix. Order: 8 -> 12 -> 4 -> 9 -> 3 -> 1 -> 2 -> 11 -> 5 -> 6 -> 7 -> 10.

| # | Problem (verified) | Fix | Test |
|---|---|---|---|
| 1 | Persist/load errors swallowed (`sqliteEngine.ts:433,479`); `OpfsStorageAdapter.read` returns `null` on any error (`storage.ts:69,83`) so I/O failure = "empty store", then overwritten | Adapter returns `null` only for `NotFoundError`, throws otherwise. `engine.errors$: Observable<EngineError{kind:'persist'|'load'|'load-corrupt'|'handler'|'replication', error, path?}>`; `flush()` rejects on failure; I/O error on load -> `init()` throws; parse error -> quarantine (`${dbPath}.corrupt-${ts}`), emit `load-corrupt`, start empty. Config `onCorruptFile:'quarantine'|'throw'` | corrupt file quarantined, original not overwritten; read-throwing adapter rejects `init`; failing write -> `errors$` + `flush` rejects |
| 2 | `deleteDoc` never deletes blob files; reload resurrects them on reinsert | delete blob file on delete / when blobs become empty (T1 dirty set); store `hasBlobs` per entry, read blob files only when true (v1 fallback `exists`) | delete doc with blobs, reinsert without, reload -> no blobs |
| 3 | Rollback restores pre-patch snapshot, discarding later optimistic patches and merged external deltas (`liveDocument.ts:107-113`) | Rebase model: `committed`, `committedRev`, `pending: {mutationId, apply(b)}[]`; view = pending folded over committed; on success/failure drop that entry and recompute; external CDC sets `committed = event.data` when `rev > committedRev`; emit only on structural change | slow failing patch A + succeeding patch B -> B kept; external patch during A survives |
| 4 | Full replace (`updateDoc`, `type:'update'` with full data) merged while a patch is pending -> removed fields survive | use `kind:'replace'|'patch'|'setPath'` + post-write `data` (from T3 step 8, or add here if T3 not landed); document uses `data`, never `delta`; keep `type` for compat | pending patch + external replace removing `x` -> `x` absent |
| 5 | `get`/`get` and `create` vs CDC->`find` races build duplicate instances, leak CDC subscriptions; `create()` may return an instance not in `query$` (`liveCollection.ts:57-101`) | single `getOrCreate(record)` re-checking cache after each await + `inflight: Map<id, Promise>`; refresh coalesced per microtask, only on insert/delete | `Promise.all([get,get])` same instance; `create()` result is the one in `query$`; subscription count via `cdc$` spy |
| 6 | Unhandled rejections: `observable.ts:44` `void target.patch`, `liveCollection.ts:27` `refreshQuery`, `liveDocument.ts:95` `getDoc().then` | route to `errors$` (proxy setter `patch().catch(report)`) | `unhandledRejection` spy silent after proxy write on closed store |
| 7 | `queryRaw` binds params as id-then-collection regardless of SQL, ignores other WHERE terms; double-quote regex (`:343`) missing closing quote cuts last char | split WHERE on `AND` into `field op (?|literal)` for `id, collection, rev, updated_at` with `= != < <= > >=`; bind `?` in order; `OR`/`LIKE`/parens/`ORDER BY` -> throw `Unsupported SQL` | `collection=? AND id=?` binds right; `"abc"` matches; `OR` throws |
| 8 | `deepClone` turns Date into `{}` and non-Float32/Uint8 typed arrays into objects; insert/update via `jsonMergePatch({},data)` (and LiveDocument ctor) drop `null`s | `cloneValue` (Date, any `ArrayBuffer.isView`); insert/replace use `cloneValue`; lossless persist via tagged replacer/reviver (`{$ls:'date',...}`) | Date + Int32Array survive write+reload; `{a:null}` kept on insert |
| 9 | `buildPathPatch` merges object values instead of setting; index paths rebuild whole array from stale snapshot (`patchHelper.ts:18-28`) | engine `setPath` op (+ `RawCommitEvent.type:'setPath'`) applied to current engine data at execution time; `patchPath` uses it; pending entry `b => setNestedPath(b,path,v)` | `patchPath('profile',{name})` replaces object; index path + concurrent change to another element keeps both |
| 10 | mobx imported unconditionally (`liveDocument.ts:9`) but peer marked optional. ("reportChanged outside action" dropped: atoms are allowed outside actions) | short term: remove `optional` in `peerDependenciesMeta`; next major: `ReactivityAdapter` + `@actdim/livestruct/mobx` entry | package.json check |
| 11 | `/` in collection/id becomes OPFS directory segments for blob files (`sqliteEngine.ts:429`) | name `${dbPath}.blobs.${encodeURIComponent(col)}~${encodeURIComponent(id)}` (hash if > ~200 chars); read legacy path as fallback, delete on next persist | id containing `/` round-trips blobs |
| 12 | CDC delta is the caller's patch object; insert/update deltas, `getDoc`, `queryDocs` hand out live internal objects; `liveDocument.ts:100` freezes engine internals | store records deep-frozen with structural sharing; `delta` = frozen copy; `getDoc` returns frozen record | mutating caller's patch after `patchDoc` has no effect |

Acceptance: every row has a previously-failing test; suite green, no unhandled rejections.
Risks (minor-breaking, note in CHANGELOG): `query$` no longer emits on plain updates; `queryRaw`
throws on unsupported SQL; frozen records break callers that mutate them.

---

## T5 - livestruct: `debt--test-coverage-and-naming` (low, blocked by T3, T4)

Requirements
- REQ-1 `OpfsStorageAdapter` MUST be covered with an in-memory fake handle tree.
- REQ-2 No test MAY use a fixed `setTimeout` sleep.
- REQ-3 Old public names MUST keep working, marked `@deprecated`.
- REQ-4 No `any` in `observable.ts`, `patchHelper.ts`, `lens.ts` or the engine Map.

Steps
1. `tests/helpers/fakeOpfs.ts`: `FakeDir/FakeFile/FakeWritable`, `failCreateWritable(n, name='NoModificationAllowedError')`, `readError`; install via `vi.stubGlobal('navigator', {storage:{getDirectory}})`.
2. `tests/opfs.test.ts`: 2 failures then success (`vi.useFakeTimers`, `advanceTimersByTimeAsync(75)`); 5 failures reject; concurrent writes serialized in call order; nested paths, delete, missing file -> `null`, read error (post-T4); `resolveStorageAdapter` selects OPFS.
3. Replace sleeps (`collection.test.ts` ~164/175/181, `document.test.ts` 202/247) with `firstValueFrom(x$.pipe(filter(...)))` / `vi.waitFor`; T1 debounce via fake timers; exact `query$` sequence `[0,1,2,1]` + instance identity.
4. Add two-engine-shared-adapter (T3), `errors$` path and concurrent-patch tests.
5. Renames: `LiveSqliteEngine` -> `LiveDocEngine` (`engine/docEngine.ts`), `sqliteEngine.ts` re-exports deprecated alias (value + type); `queryRaw` -> `querySubset` with deprecated `queryRaw` alias on engine and `LiveEngineAccess`; drop LiveStore/SQLite claims from package description, README, keywords. Remove aliases next major.
6. Types: `JsonValue/JsonObject`; engine Map `Map<string, DocumentRecord<JsonObject>>`; recursive `PatchPayload<T>` (leaf/array or nested; `null` only for optional keys), drop `| Record<string, unknown>`, add `patchUnchecked(p: JsonObject)` escape hatch; `lens.ts`/`patchHelper.ts` use `unknown` + `isRecord`/`Array.isArray`; `observable.ts` index via `Record<string, unknown>` after `prop in data`.
7. Type tests (`expectTypeOf`): misspelled patch key fails, `null` on a required key fails.

Acceptance: adapter line coverage >= 90%; `grep -n "setTimeout(resolve" tests` empty; `tsc` green with zero `any` in the four files; `LiveSqliteEngine` imports still compile.
Risk: stricter `PatchPayload` breaks loose callers (livestruct-demo `as Partial<CadDocument>` casts, msgmesh-store) - migrate them via `patchUnchecked` in the same change.

---

## T6 - msgmesh-store: `bug--bridge-sync-correctness` (high, blocked by livestruct T1)

Corrections to the review: the re-broadcast bug is specifically that a command whose payload declares
`origin:'remote'|'local'` is recorded under that origin (`storeBridge.ts:311,323`), so its CDC fails the
`origin==='bus'` check (`:208-211`) and is re-published; publishing genuine local changes is intended.
"Bad CDC event ends the stream" is real but low severity (only non-object items; engine never emits them).
Extra finding: `engineAccess.commitRaw` honours `raw.collection` (`livestruct sqliteEngine.ts:282`), so it
is not collection-scoped either. Optional dependency: livestruct `engine.upsertDoc` (not required - the per-doc queue removes the race).

Requirements
- REQ-1 Commands for the same `collection:id` MUST run strictly in arrival order, one at a time (different docs MAY run concurrently).
- REQ-2 Two concurrent commands for a new id MUST NOT lose a write (one insert, then patches).
- REQ-3 "CDC came from a bus command" MUST be decided by `mutationId` membership, not time.
- REQ-4 Changes applied from a bus command MUST NOT be re-published whatever the declared origin; engine `local`/`remote` changes published per `publishOrigins` (default `['local','remote']`).
- REQ-5 `correlationId` MUST NOT be used as mutation id; absent -> `crypto.randomUUID()`.
- REQ-6 Replay dedup MUST be deterministic (bounded count-based ledger).
- REQ-7 One malformed CDC item MUST NOT end the stream; `isConnected` MUST be false after source error/complete.
- REQ-8 Bus and `cdc$` subscribers MUST receive a deep-cloned, deep-frozen `delta`.
- REQ-9 No unhandled rejections; every `bus.send` caught and routed to `errors$`.
- REQ-10 A bridge on a LiveCollection MUST reject commands for other collections and MUST NOT touch private `rawEngine`.

Steps
1. `src/core/keyedQueue.ts`: `KeyedSerialQueue { run<T>(key, task): Promise<T>; size; drain() }` - `Map<string, Promise>`, chain `prev.then(task, task)`, per-task error isolation, delete key when tail settles.
2. `src/core/mutationLedger.ts`: `MutationLedger(capacity=4096)` - `inFlight: Map<id, origin>` (`begin/end`), `applied` insertion-ordered Map (`markApplied` evicts oldest O(1), `wasApplied`).
3. `src/core/applyMutation.ts` (this is T8's dedup extraction): `resolveMutationTarget(store, {boundCollection?}) => MutationTarget{get, insert, patch, remove, boundCollection?}` with adapters for engine, LiveStoreInstance (public `engine`), LiveCollection (`col.get` + `col.engineAccess.commitRaw` with collection forced to `col.name`, throw on mismatch), else `UnsupportedStoreError`; `applyStoreCommand(target, cmd)` - one semantics: CREATE/PATCH/PATCH_PATH create when missing, PATCH_PATH builds nested patch, DELETE on missing = no-op, use `upsertDoc` when available; `normalizeCommand(msg, defaults)` (moves topic/type parsing from `storeBridge.ts:269-309`).
4. `storeBridge.ts` `handleCommand`: synchronously normalize, assign mutationId, drop if `wasApplied || inFlight.has`; then `queue.run(`${c}:${id}`, ...)` with `ledger.begin` / `applyStoreCommand` / catch -> `errors$.next({kind:'command', collection, id, mutationId, correlationId, error})` / finally `end` + `markApplied`.
5. CDC handler: `viaBus = ledger.inFlight.has(mid)` (relies on T1 synchronous CDC); `origin = viaBus ? inFlight.get(mid) ?? 'bus' : raw.origin`; always emit on `cdc$`; publish only if `!viaBus && publishOrigins.includes(origin)`; stamp `sourceId` (bridge UUID) on published events and ignore commands with `payload.sourceId === self` (relay ping-pong guard).
6. `cdcStream.ts`: normalize inside `mergeMap(raw => { try { return of(norm(raw)) } catch(e) { onInvalid?.(e, raw); return EMPTY } })`; `delta: deepFreeze(structuredClone(delta))`, freeze event; `safeSend(bus, params, onError)` = `Promise.resolve().then(() => bus.send(params)).catch(onError)`, used in `publishCdcToBus` and the bridge.
7. Controller: `errors$`; `isConnected = !disposed && sourceAlive`; `dispose()` stops accepting commands; `whenIdle()` = `queue.drain()`.
8. Remove `EchoTracker` usage; `echoSuppressionMs` becomes a `@deprecated` no-op.

Tests (`tests/bridge.test.ts`, new `tests/applyMutation.test.ts`, `tests/keyedQueue.test.ts`)
- 2 PATCH for a new id in one tick -> both fields, one insert CDC then one update.
- PATCH (slowed mock target) then DELETE -> doc deleted.
- `origin:'remote'` command -> `cdc$` origin `remote`, bus spy 0 `ENTITY_CHANGED`.
- Direct engine `local` write -> published exactly once.
- Two commands sharing a `correlationId`, no mutationId -> both applied.
- Same mutationId twice -> second dropped even after `vi.advanceTimersByTime(10_000)`.
- Source emits `null` then valid -> valid delivered, `onInvalid` once; erroring source -> `isConnected === false`.
- Subscriber mutating `payload.delta` throws (frozen), engine doc unchanged.
- Rejecting `bus.send` -> `errors$` emission, no `unhandledRejection`.
- Bridge on `users` collection receiving `orders` topic -> rejected via `errors$`, `orders` empty.

Acceptance: above green; `grep rawEngine src/` = 0; `grep "void .*send" src/` = 0; no "nothing happened" assertions based on `setTimeout`.
Risks: suppression correctness depends on T1's synchronous CDC (mitigation: keep id in `inFlight` until the microtask after apply resolves); one `structuredClone` per event (opt-out `freezeEvents:false`); ledger capacity bounds replay dedup (document it).

---

## T7 - msgmesh-store: `bug--worker-transport-lifecycle` (medium, blocked by T6)

Correction: `messageerror` carries no request id, so "reject only the affected request" is impossible
as stated -> make it non-fatal and catch clone errors per request on the sending side.

Requirements
- REQ-1 Client states `'idle'|'initializing'|'ready'|'dead'|'disposed'`; in `dead` every call MUST reject immediately with `WorkerDeadError`.
- REQ-2 Fatal `error` MUST reject pending, set `dead`, reset `initPromise`; optional `reconnect(port?)` -> `idle` + re-INIT.
- REQ-3 `messageerror` MUST be non-fatal (log + `errors$`); sender MUST validate cloneability per message (client rejects that request; host answers ERROR with that request's id).
- REQ-4 Host and client `dispose()` MUST post `{type:'CLOSE', reason}`; client on CLOSE -> `dead`; `InMemoryMessagePort.close()` MUST deliver `close` to the peer.
- REQ-5 Lazy store factory MUST be memoized while pending (exactly one call under concurrency); failure clears memo, retried at most `factoryRetries` (default 1), then permanent ERROR.
- REQ-6 `safelyClone` MUST use `structuredClone` strictly (no JSON fallback).
- REQ-7 Host MUST serialize commands per `collection:docId`, enqueuing synchronously on receipt (reuse `KeyedSerialQueue`).

Steps
1. `types.ts`: `WorkerCloseMessage {type:'CLOSE'; reason?}` in both unions; `state`, `errors$`, optional `reconnect` on `WorkerStoreClient`; `errorPolicy?: 'fatal'|'log'` (default `'fatal'`).
2. `channel.ts`: strict `safelyClone`; throw synchronously inside `postMessage` (browser behavior); `close()` -> `queueMicrotask(() => peer._dispatch('close', {}))` if peer open.
3. `workerClient.ts`: `state` replaces `isReady` (keep `isReady` getter); fatal `handleError` -> reject pending, `dead`, `initPromise = null`; separate `handleMessageError`; CLOSE message / `close` event handled as fatal; `sendRequest` checks state first; `dispose()` posts CLOSE in try/catch.
4. `workerHost.ts`: `storePromise` + failure counter; COMMAND branch -> `queue.run(key, async () => applyStoreCommand(resolveMutationTarget(await resolveStoreInstance()), cmd))`; `reply(msg)` helper catching clone errors -> ERROR with same id; `dispose()` posts CLOSE; CDC stream error -> `{type:'ERROR', error}` without id -> client `errors$`.

Tests (`tests/worker.test.ts`)
- fatal error then call -> `state==='dead'`, `client.patch` rejects with no timer fired (fake timers).
- host dispose -> pending request rejects with CLOSE reason, state `dead`; `port1.close()` -> client `dead`.
- `messageerror` leaves other pending requests resolvable.
- deferred factory + 5 concurrent `ready()`/`query` -> factory called once; failing factory retried once then permanent ERROR.
- command with a function in payload -> `DataCloneError`, client stays `ready`.
- 20 PATCH to a new id run in order, all fields present.

Acceptance: no call waits for a timeout after fatal error / close; factory called exactly once under concurrency; no `JSON.parse` in `channel.ts`.
Risks: browser Worker `error` can be non-fatal (`errorPolicy:'log'`); strict cloning breaks callers relying on silent JSON drops (CHANGELOG).

---

## T8 - msgmesh-store: `debt--perf-tests-and-types` (low, blocked by T6)

Correction: the fatal-error test DOES reach `handleError` (microtask ordering), but depends on that
ordering and asserts nothing about client state afterwards. Dispose test and 60fps test findings confirmed.

Requirements
- REQ-1 Mutation logic MUST exist once (`src/core/applyMutation.ts`, done in T6 step 3); bridge and host identical (PATCH_PATH on missing doc creates it; unsupported store throws).
- REQ-2 `EchoTracker` removed; if exported from `src/index.ts` keep `@deprecated` with fixes (`record` deletes key before set; `prune` stops at first unexpired).
- REQ-3 Optional opt-in batching: `WorkerStoreClientOptions.batch?: 'none'|'microtask'|((flush)=>void)` (function form allows RAF); client sends `{type:'BATCH', id, payload: WorkerClientRequest[]}`, host answers `BATCH_OK` with per-item result/error; host buffers CDC into `CDC_BATCH` per microtask and posts CDC only after `CDC_SUBSCRIBE` (client sends on `cdc$` refcount 0->1, `CDC_UNSUBSCRIBE` on 1->0); host still accepts unbatched messages.
- REQ-4 Typed public API: `MsgMeshBusLike` with typed `send({channel, group:'in'|'out', topic, payload}): Promise<void>` and `on(params) => (() => void) | void`; `attachStoreBridge(bus: MsgMeshBusLike, store: StoreTarget, ...)` with structural `StoreTarget` interfaces in `src/core/targets.ts`; no `any` in `src/` (`@typescript-eslint/no-explicit-any`).
- REQ-5 Deprecate (keep, normalize internally): `action` (use `type`), `data` (use `delta`), `disconnect` (use `dispose`); remove unused `WorkerHostOptions.channelPrefix`; `isConnected` keeps T6 meaning.

Steps
1. Delete `executeStoreMutation` (`storeBridge.ts:27-150`) and `executeWorkerMutation` (`workerHost.ts:30-164`) in favor of `applyMutation` (if not already done in T6/T7).
2. EchoTracker per REQ-2.
3. Types (REQ-4/5), `tsc --noEmit`; keep `unknown` overloads `@deprecated` for one release.
4. Batching (REQ-3) as a separate final commit.
5. Tests rework: replace fixed sleeps (`bridge.test.ts` 221/245/271/329/392/526, `cdc.test.ts` 157/230/238/249/276/348) with `await bridge.whenIdle()` + synchronous spy assertions or `vi.useFakeTimers()` + `vi.runAllTimersAsync()`; two-store sync test asserts exact `send` count per channel (one per original local write); 60fps test -> deterministic `postMessage` count (100, or 1 with `batch:'microtask'`), timing only as `describe.skipIf(process.env.CI)` benchmark; dispose test awaits one microtask so the request is registered, asserts rejection via pending loop + `clearTimeout` spy; fatal-error test registers request explicitly, asserts `state==='dead'`.

Tests to add: table-driven `applyMutation` parity across engine/store/collection adapters through both bridge and host; `KeyedSerialQueue` (per-key order, cross-key parallelism, error doesn't break chain, key cleanup); `MutationLedger` eviction; batch with mixed success/failure; CDC suppressed with no subscribers; type test `attachStoreBridge(123, ...)` fails to compile.

Acceptance: no duplicated mutation code (`grep buildNestedPathPatch src` = 1 definition); no fixed sleeps; `tsc` with `no-explicit-any` green; suite < 3 s.
Risks: stricter types break downstream `unknown` callers (deprecated overloads); batching is a wire-protocol change (host stays backward compatible).
