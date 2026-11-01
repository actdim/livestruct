---
protocol: along
protocol_version: "4.5.4"
slug: cross-context-last-writer-wins
type: bug
status: superseded
completed: 2026-11-01
priority: high
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [sync, opfs, multi-context]
blocked_by: [feat--livestore-engine]
related: []
superseded_by: feat--livestore-engine
---
# Cross-context last-writer-wins on shared OPFS file: leader election + replication

## Problem

Each same-origin context (host page, iframes, tabs) writes the same OPFS file, so the last writer erases other contexts' documents, and only one worker can hold the OPFS sync handle. Elect a leader worker via navigator.locks and replicate committed batches between workers over BroadcastChannel.

## Requirements
- REQ-1: At most one worker per store name MUST hold the OPFS handle (lock `livestruct:${name}:leader`).
- REQ-2: Follower workers MUST forward UI batches to the leader and apply committed batches without touching storage.
- REQ-3: Replication MUST be batched (one BroadcastChannel message per leader commit batch) and MUST carry `mutationId`, `rev`, `seq`, `epoch`, origin context id.
- REQ-4: The leader MUST release the lock only after its final flush; a new leader MUST rebuild from snapshot+log plus buffered commits and persist anything not yet durable.
- REQ-5: A late joiner MUST converge to the leader state (`seq`) without gaps or duplicates.
- REQ-6: A forwarded batch MUST be retried with the same `mutationId`s on leader change and deduplicated by the leader; UI promises reject after `writeTimeoutMs` (5000).
- REQ-7: Testable in node via injected `LockProvider` and BroadcastChannel-like transport.

## Acceptance Criteria
- [ ] Data-loss scenario passes; write spy proves single writer.
- [ ] One BroadcastChannel message per leader commit batch.
- [ ] Single-context behaviour from T1 unchanged.

## Plan

Execution order: T1 livestruct `feat--worker-engine-lazy-sync` -> T3 livestruct `bug--cross-context-last-writer-wins` -> T2 livestruct-demo `bug--dnd-freeze-dual-iframe` -> T4 livestruct `bug--engine-correctness-batch` -> T6 msgmesh-store `bug--bridge-sync-correctness` -> T7 msgmesh-store `bug--worker-transport-lifecycle` -> T8 msgmesh-store `debt--perf-tests-and-types` -> T5 livestruct `debt--test-coverage-and-naming`.

## T3 - livestruct: `bug--cross-context-last-writer-wins` (high, blocked by T1)

Problem: every same-origin context (host, iframes, tabs) has its own worker; only one may own the
OPFS sync handle, and all must see each other's writes.

Decision: **leader election among workers via `navigator.locks`; the leader worker orders all writes
and is the only one touching OPFS; workers replicate over BroadcastChannel; UI threads never take
part in replication.** Conflict policy: LWW in leader receive order, global insert uniqueness.

Requirements
- REQ-1: At most one worker per store name MUST hold the OPFS handle (lock `livestruct:${name}:leader`).
- REQ-2: Follower workers MUST forward UI batches to the leader and apply committed batches without touching storage.
- REQ-3: Replication MUST be batched (one BroadcastChannel message per leader commit batch) and MUST carry `mutationId`, `rev`, `seq`, `epoch`, origin context id.
- REQ-4: The leader MUST release the lock only after its final flush; a new leader MUST rebuild from snapshot+log plus buffered commits and persist anything not yet durable.
- REQ-5: A late joiner MUST converge to the leader state (`seq`) without gaps or duplicates.
- REQ-6: A forwarded batch MUST be retried with the same `mutationId`s on leader change and deduplicated by the leader; UI promises reject after `writeTimeoutMs` (5000).
- REQ-7: Testable in node via injected `LockProvider` and BroadcastChannel-like transport.

Steps
1. `src/engine/worker/coordination/`: `LockProvider` (`webLocksProvider`, `soleWriterLockProvider`), `ReplicationTransport` (`broadcastChannelTransport('livestruct:'+name)`), messages `hello`, `sync{seq,epoch}`, `leader{epoch,seq}`, `resign`, `fwd{from, batch}`, `commit{epoch, seq, mutations}`, `nack{mutationIds, error}`.
2. `WorkerEngine` roles: `leader` (validate, assign rev/seq, persist via driver, broadcast `commit`, answer own UI), `follower` (send `fwd`, apply `commit`, answer own UI from `commit`/`nack`).
3. Startup: subscribe + buffer, `hello`, request lock (not awaited). Leader answers `hello` with `flush()` then `sync`. Follower loads read-only snapshot (OPFS `getFile()` read, no sync handle) and applies buffered commits with `seq > snapshotSeq`; fallback after `syncTimeoutMs`.
4. On lock grant: `epoch = maxSeen+1`, open sync handle, rebuild, persist in-memory state if ahead of disk, broadcast `leader`, re-send own pending forwards locally.
5. `close()`/`pagehide`: leader flushes, sends `resign`, releases lock; followers reject pending.
6. Ignore stale epochs; apply commits only when `rev > local rev`.
7. `tests/helpers/fakeBus.ts` + `FakeLockManager` (FIFO, `crash(ctx)`), `tests/multiContext.test.ts`.

Tests: three contexts (UI client + worker engine each) on one memory driver: A inserts d1, B inserts d2, C patches d1 -> fresh open sees both; same-id insert from two followers -> one rejected; leader close -> new leader, in-flight batch committed once; leader crash before flush -> new leader persists; late joiner catches up; stalled leader -> UI promise rejects after timeout; only the leader's driver is ever written (spy).

Acceptance
- [ ] Data-loss scenario passes; write spy proves single writer.
- [ ] One BroadcastChannel message per leader commit batch.
- [ ] Single-context behaviour from T1 unchanged.

Risks: bfcached/frozen leader tab stalls followers until timeout (take over when `document.hidden` leader stops heartbeating - optional heartbeat 1 s); large blobs in `commit` - send only changed blobs.
