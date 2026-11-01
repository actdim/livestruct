# @actdim/livestruct

> **Ergonomic, Reactive Document and Record Abstraction over LiveStore (SQLite WASM & Event-Sourcing) for TypeScript Applications**

[![npm version](https://img.shields.io/npm/v/@actdim/livestruct.svg)](https://www.npmjs.com/package/@actdim/livestruct)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 1. What is LiveStruct?

**`@actdim/livestruct`** is an ergonomic document abstraction layer built on top of LiveStore (`@livestore/livestore`). It bridges relational SQLite tables, background event-sourcing workers, and reactive UI state managers (such as `@actdim/dynstruct` and MobX).

### The Problem It Solves

Raw LiveStore provides robust persistence and multi-tab synchronization using embedded SQLite (WASM and OPFS) and event-sourcing. However, using it directly in interactive UI applications creates friction:

1. **CQRS & Event-Sourcing Overhead:** Updating a single property requires declaring an Effect-TS schema, defining an event, writing a SQL materializer, committing the event, and subscribing to a SQL query.
2. **Object-Relational Mismatch:** UI cards and CAD/GIS entities are hierarchical documents, whereas SQLite operates on flat tables and rows.
3. **Ephemeral UI State vs Durable Commits:** High-frequency interactions (such as 60-120 fps mouse dragging or transient focus) cannot be committed to disk logs without freezing the browser and bloating storage.
4. **Lack of Encapsulation:** Raw LiveStore separates data tables from mutation events, resulting in logic scattered across components.

### What LiveStruct Provides

- **RxDB-like Ergonomics:** Clean document-oriented API (`collection.get(id)`, `doc.patch({ title: 'New' })`, `doc.$`).
- **Reactive Engine (RxJS & MobX):** First-class RxJS Observables (`doc.$`) for streams, with seamless MobX bindings for zero-boilerplate UI reactivity.
- **Built-in Universal Schema:** Out-of-the-box `docs` table with native RFC 7396 `json_patch()` materializers. No manual schema authoring required.
- **OPFS Leader Dedicated Worker:** Storage I/O and SQLite event logging run off the main thread in a dedicated leader worker (`@actdim/livestruct/worker`).
- **SharedWorker Synchronization:** Multiple tabs and same-origin iframes share a single leader writer via `@actdim/livestruct/shared-worker`.
- **Content-Addressed BlobStore:** Heavy binary arrays (`Float32Array`, `Uint8Array`) are stored out-of-band in OPFS (`livestruct-blobs/<sha256>`), keeping eventlog commits compact.
- **Dual-Level Architecture:** High-level ergonomic documents for forms, plus an explicit low-level escape hatch (`doc.engine`) for raw SQL queries, Change Data Capture (CDC), and binary BLOB access.

---

## 2. Quick Code Example

```typescript
import { createLiveStruct } from '@actdim/livestruct';

// 1. Initialize store (defaults to OPFS leader worker in browser, in-memory in Node)
const store = await createLiveStruct({ name: 'cad_workspace' });

// 2. Obtain collection
interface PartEntity {
    id: string;
    name: string;
    color: string;
    layerId: string;
}
const parts = await store.collection<PartEntity>('parts');

// 3. Read or create live document
const doc = await parts.create('part-101', {
    id: 'part-101',
    name: 'Bracket A',
    color: 'blue',
    layerId: 'structural',
});

// 4. Reactive stream (RxJS)
doc.$.subscribe((state) => {
    console.log('Part updated:', state.name, state.color);
});

// 5. Ergonomic mutation (commits to SQLite and syncs across tabs automatically)
await doc.patch({ color: 'red' });
```

---

## 3. Worker Configuration (Vite)

In browser applications bundled with Vite, configure your app to import the shipped workers:

```typescript
// vite.config.ts
export default defineConfig({
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        exclude: ['@livestore/wa-sqlite'],
    },
});
```

And pass the worker constructors when initializing:

```typescript
import { createLiveStruct } from '@actdim/livestruct';
import LiveWorker from '@actdim/livestruct/worker?worker';
import LiveSharedWorker from '@actdim/livestruct/shared-worker?sharedworker';

const store = await createLiveStruct({
    name: 'my_app',
    worker: LiveWorker,
    sharedWorker: LiveSharedWorker,
});
```

---

## 4. Dual-Level Architecture

LiveStruct separates application concerns into two distinct tiers:

```text
+--------------------------------------------------------------------------+
|                                LiveStruct                                |
+--------------------------------------------------------------------------+
|  HIGH-LEVEL API (UI Components & Dynstruct Forms)                        |
|  - Mutable MobX properties & getters: `doc.data.name`                    |
|  - Ergonomic mutations: `doc.patch({ color: 'red' })`                    |
|  - Reactive observable stream: `doc.$`                                   |
|  - Automatic echo cancellation and optimistic updates                    |
+--------------------------------------------------------------------------+
|  LOW-LEVEL ENGINE API (msgmesh-store & Worker Bridges)                   |
|  - Raw SQLite queries: `doc.engine.queryRaw(sql, params)`                |
|  - Raw Event Commit: `doc.engine.commitRaw(event)`                       |
|  - Change Data Capture (CDC) stream: `doc.engine.cdc$`                   |
|  - Content-addressed binary BLOB access (Float32Array / Uint8Array)      |
+--------------------------------------------------------------------------+
```

---

## 5. CAD & GIS Document Model

In engineering and geospatial applications, thousands of primitives exist alongside high-frequency user interactions:

1. **Two-Tier Storage:**
   - **Metadata & Properties:** Managed by LiveStruct documents (stored as JSON in SQLite `docs` table).
   - **Geometry Coordinates:** Stored as content-addressed binary BLOBs (`Float32Array`), passed directly to WebGL/WebGPU without serialization overhead.
2. **Interaction Separation:**
   - Interactive drag operations (60-120 fps) stay strictly in-memory over `@actdim/msgmesh`.
   - On `mouseUp`, a single `doc.patch()` commit persists the finalized state to SQLite.
3. **Document as a File:**
   - The SQLite database on OPFS represents the native document file. Exporting is a direct binary stream copy, avoiding massive JSON dumps.

---

## 6. Integration with @actdim/msgmesh

When crossing worker boundaries or decoupling modules:
- Use `@actdim/msgmesh-store` to bridge `doc.engine.cdc$` into typed message bus channels.
- Dispatch business commands over MsgMesh (`cad.command.extrude`) rather than invoking storage operations directly from UI toolbars.

---

## 7. Installation

```bash
pnpm add @actdim/livestruct @actdim/msgmesh @actdim/utico mobx rxjs
```
