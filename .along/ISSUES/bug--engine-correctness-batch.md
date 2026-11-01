---
protocol: along
protocol_version: "4.5.4"
slug: engine-correctness-batch
type: bug
status: open
priority: medium
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [correctness]
blocked_by: [feat--transparent-lazy-commit]
related: []
---
# API-layer correctness batch: instance races, unhandled rejections, patchPath, replace, cloning

## Problem

the review found API-layer correctness bugs in LiveDocument/LiveCollection/lens (instance
races and subscription leaks, unhandled rejections, wrong `patchPath` semantics, replace merged as
patch, live internal objects leaking, optional-but-required mobx, silent Date/typed-array loss).

Launch position: **5** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Requirements
- REQ-1: LiveCollection MUST return one instance per id under concurrent `get`/`create`/`find` and MUST NOT leak subscriptions.
- REQ-2: The package MUST produce no unhandled rejections (proxy setters, collection refresh, remote rebase).
- REQ-3: `patchPath` MUST set (not merge) object values and MUST NOT rebuild arrays from stale snapshots (`DocPathSet` event).
- REQ-4: A full replace (`updateDoc`) MUST NOT be merged as a patch into a pending overlay; the pending patch is re-applied on the replaced value.
- REQ-5: Callers MUST NOT receive live internal objects (frozen copies), and CDC `delta` MUST NOT alias the caller's patch object.
- REQ-6: mobx MUST be a required peer (or moved behind `@actdim/livestruct/mobx`), and `reportChanged` usage stays valid.
- REQ-7: Date and typed-array values MUST either round-trip through events or be rejected at `patch()` time with a clear error (no silent `{}`).

## Acceptance Criteria
- [ ] Each REQ has a test that failed before its fix (or a recorded "not reproducible after LiveStore move" with the test proving it).
- [ ] Suite green; `unhandledRejection` spy silent across the whole suite.
- [ ] CHANGELOG lists behaviour changes.

## Plan

## 5. livestruct: `bug--engine-correctness-batch` (medium, blocked by feat--transparent-lazy-commit)

Problem: the review found API-layer correctness bugs in LiveDocument/LiveCollection/lens (instance
races and subscription leaks, unhandled rejections, wrong `patchPath` semantics, replace merged as
patch, live internal objects leaking, optional-but-required mobx, silent Date/typed-array loss).

Rewritten after the LiveStore move: items tied to the old Map/JSON engine are gone (persist/load
errors, blob files on delete, deepClone/null loss, `/` in OPFS paths, regex `queryRaw`). Each remaining
row MUST be re-verified against the new code first; a row that no longer reproduces is closed with
the failing-before test showing it passes.

Requirements
- REQ-1: LiveCollection MUST return one instance per id under concurrent `get`/`create`/`find` and MUST NOT leak subscriptions.
- REQ-2: The package MUST produce no unhandled rejections (proxy setters, collection refresh, remote rebase).
- REQ-3: `patchPath` MUST set (not merge) object values and MUST NOT rebuild arrays from stale snapshots (`DocPathSet` event).
- REQ-4: A full replace (`updateDoc`) MUST NOT be merged as a patch into a pending overlay; the pending patch is re-applied on the replaced value.
- REQ-5: Callers MUST NOT receive live internal objects (frozen copies), and CDC `delta` MUST NOT alias the caller's patch object.
- REQ-6: mobx MUST be a required peer (or moved behind `@actdim/livestruct/mobx`), and `reportChanged` usage stays valid.
- REQ-7: Date and typed-array values MUST either round-trip through events or be rejected at `patch()` time with a clear error (no silent `{}`).

Steps
1. Re-verify: for each REQ write the failing test first in `tests/document.test.ts` / `tests/collection.test.ts` / `tests/lens.test.ts`; run it against the post-#3 code; record "reproduces" or "not reproducible" per REQ in the session log before touching `src/`.
2. REQ-1 `src/document/liveCollection.ts`: one `Map<id, Promise<LiveDocument>>` of in-flight loads shared by `get`/`create`/`find`; the entry is set synchronously before the first await and removed on rejection; each instance owns exactly one engine CDC subscription, released in `doc.dispose()` / `collection.close()`; a `subscriptionCount` debug getter for tests.
3. REQ-2: every fire-and-forget Promise in `src/document/observable.ts` (proxy setters), `liveCollection.ts` (`query$` refresh) and the rebase path from #3 ends in `.catch(err => errors$.next(...))`; add a helper `reportAsync(p, ctx)` in `src/document/types.ts` (or a new `errors.ts`) and use it everywhere instead of `void p`.
4. REQ-3 `src/document/patchHelper.ts` + `liveDocument.ts`: `patchPath(path, value)` maps to `DocPathSet` (set semantics, no merge); arrays are addressed by index in the path, never rebuilt from `doc.data` snapshots; pending overlay update uses the same set semantics (`setAtPath` on a structural clone of the overlay branch).
5. REQ-4 `liveDocument.ts`: `replace(value)` / engine `updateDoc` clears `committed` to the new value and re-applies the pending merge patch on top; it is never merged into the overlay as a patch.
6. REQ-5: `getDoc`/`queryDocs`/`doc.data` return deep-frozen copies (one `structuredClone` + freeze per committed version, cached by `rev`); CDC `delta` is cloned from the caller's patch before freezing; `src/lens/lens.ts` writes go through `patch`, never mutate `doc.data`.
7. REQ-6: move mobx from `peerDependenciesMeta.optional` to a required peer OR move `toObservableDocument` and atom wiring to the subpath `@actdim/livestruct/mobx` (`src/mobx.ts`, `package.json#exports`, `vite.config.ts` entry). Choose the subpath if the core imports mobx only for the atom; record the choice in CHANGELOG.
8. REQ-7 `patchHelper.ts`: `assertJsonSafe(value, path)` walks the patch once; `Date` -> ISO string is NOT done implicitly: throw `LiveStructValueError('Date at shapes.a.createdAt: convert to ISO string or number')`; typed arrays / `ArrayBuffer` / `Map` / `Set` / functions / class instances -> same error type; blobs keep going through `BlobStore`.
9. CHANGELOG: one line per behaviour change (frozen results, strict values, patchPath set semantics, mobx peer/subpath).

Acceptance
- [ ] Each REQ has a test that failed before its fix (or a recorded "not reproducible after LiveStore move" with the test proving it).
- [ ] Suite green; `unhandledRejection` spy silent across the whole suite.
- [ ] CHANGELOG lists behaviour changes.

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
