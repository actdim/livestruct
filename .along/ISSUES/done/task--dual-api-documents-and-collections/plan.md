# Living Plan: Dual-Level API: LiveDocument and LiveCollection

Status: Approved
Date: 2026-10-30
Milestone: v2.0.0-along-transition
Issue: task--dual-api-documents-and-collections

## 1. Objectives & Requirements
- REQ-1: `LiveDocument` MUST expose synchronous `.data`, RxJS `.$`, and asynchronous `.patch(partial)`.
- REQ-2: `LiveDocument` MUST implement optimistic updates with echo suppression for local mutations.
- REQ-3: `LiveCollection` MUST provide `get(id)`, `create(id, initialData)`, and reactive `query$`.
- Acceptance Criteria:
  - `LiveDocument` updates emit on `.$` and update MobX observable getters.
  - Concurrent mutations from neighboring tabs update local state without cursor jumps.
  - `engine` property exposes low-level SQLite driver.

## 2. Architecture & File Layout
- `src/engine/types.ts`: Add optional `mutationId?: string` to `CDCEvent` and `RawCommitEvent`.
- `src/engine/sqliteEngine.ts`: Propagate `mutationId` in `patchDoc`, `insertDoc`, `updateDoc`, `deleteDoc`, and `getEngineAccess`.
- `src/document/types.ts`: Define `LiveDocument<T>`, `LiveCollection<T>`, `Disposable`, `PatchPayload<T>`, and `ObservableLiveDocument<T>`.
- `src/document/patchHelper.ts`: Path-to-patch conversion helper leveraging `setNestedPath` and RFC 7396 merge patch conventions.
- `src/document/liveDocument.ts`: `LiveDocumentImpl<T>` implementing snapshot `.data`, `.$`, `.patch()`, `.patchPath()`, optimistic updates with echo suppression, MobX atom integration, and `.engine` escape hatch.
- `src/document/liveCollection.ts`: `LiveCollectionImpl<T>` implementing cached document instances, `get()`, `create()`, `delete()`, `find()`, and reactive `query$`.
- `src/document/observable.ts`: `toObservableDocument(doc)` MobX helper proxy exposing reactive getters and mutators.
- `src/document/index.ts`: Document module barrel exporting types, classes, and helpers.
- `src/document.ts`: Top-level `./document` alias for package exports.
- `src/index.ts`: Re-export document, engine, and lens subsystems; updated `createLiveStruct` factory.
- `tests/document.test.ts`: Vitest test suite for document creation, snapshot, RxJS stream, type-safe path patch, optimistic updates, echo suppression, MobX reactivity, and engine escape hatch.
- `tests/collection.test.ts`: Vitest test suite for collection CRUD, cache identity, reactive `query$`, and lifecycle disposal.

## 3. Step-by-Step Implementation Steps
1. Enhance `src/engine/types.ts` and `src/engine/sqliteEngine.ts` to support optional `mutationId` in CDC events for echo suppression.
2. Create `src/document/types.ts` with complete type definitions.
3. Create `src/document/patchHelper.ts` for path-to-patch transformation.
4. Create `src/document/liveDocument.ts` implementing `LiveDocument<T>` with optimistic updates, echo suppression, MobX atom, and low-level engine access.
5. Create `src/document/liveCollection.ts` implementing `LiveCollection<T>` with document cache, CRUD, and reactive `query$`.
6. Create `src/document/observable.ts` implementing MobX reactive proxy `toObservableDocument()`.
7. Create `src/document/index.ts` and `src/document.ts`.
8. Update `src/index.ts` to integrate and export all modules cleanly.
9. Implement comprehensive tests in `tests/document.test.ts`.
10. Implement comprehensive tests in `tests/collection.test.ts`.
11. Run tests (`pnpm --filter @actdim/livestruct test`), typecheck (`pnpm --filter @actdim/livestruct typecheck`), and build (`pnpm --filter @actdim/livestruct build`).
12. Review typography, gate compliance, and finalize with `along wrap` and git commits.
