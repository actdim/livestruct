---
protocol: along
slug: 04-integration-guide
title: Integration Guide
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [04-integration-guide, setup, vite, worker, react, mobx, msgmesh, vitest]
---

# Integration Guide

[<- Back to 03. Architecture & Wiring](./topic--03-architecture-and-wiring.md) | [Next: 05. API Reference ->](./topic--05-api-reference.md)

---

This guide wires `@actdim/livestruct` into a Vite + React application step by step. Every snippet follows the shipped API and the `livestruct-demo` application (`demo/` of this repository, `src/packages/livestruct/demo` in the monorepo; live at https://actdim.github.io/livestruct/demo/).

---

## Step 1. Install

```bash
pnpm add @actdim/livestruct @actdim/utico mobx rxjs \
    @livestore/livestore@0.5.0 @livestore/adapter-web@0.5.0 @livestore/wa-sqlite@0.5.0 effect@4.0.3
```

Peer dependencies declared by `@actdim/livestruct` (`package.json` `peerDependencies`):

| Peer | Version | Required |
|---|---|---|
| `@livestore/livestore` | `0.5.0` (exact) | yes |
| `@livestore/adapter-web` | `0.5.0` (exact) | yes |
| `effect` | `4.0.3` (exact) | yes |
| `mobx` | `>=6.10.0` | yes |
| `rxjs` | `>=7.8.0` | yes |
| `@actdim/utico` | `>=1.12.0` | yes |
| `@actdim/msgmesh` | `>=1.12.0` | optional |

Notes:

- The LiveStore and `effect` versions are pinned exactly; mismatched `effect` 4.x minors break LiveStore resolution (see [LiveStore Integration](./topic--livestore-integration.md), section Q1).
- `@livestore/adapter-web` declares its own peers (`@opentelemetry/api`, `@standard-schema/spec`, `@effect/*` platform packages). Install the ones your package manager reports as missing; LiveStruct's own development setup installs `@opentelemetry/api` and `@standard-schema/spec`.
- `@livestore/wa-sqlite` is listed explicitly (as in `livestruct-demo`) because the Vite and Vitest configuration below reference it by name.
- For React views add `react`, `react-dom` and `mobx-react-lite`; for messaging add `@actdim/msgmesh`.

---

## Step 2. Configure Vite for the workers

LiveStore's workers are ES modules and its SQLite loader must not be pre-bundled:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        exclude: ['@livestore/wa-sqlite'],
    },
});
```

Workers are consumed with Vite's `?worker` / `?sharedworker` import suffixes, which make Vite emit dedicated worker chunks (the reasoning is recorded in [LiveStore Integration](./topic--livestore-integration.md), section Q4).

---

## Step 3. Provide the worker constructors

**Option A - use the shipped workers.** `@actdim/livestruct/worker` runs `makeWorker({ schema })` with the built-in schema; `@actdim/livestruct/shared-worker` re-hosts LiveStore's shared worker.

```typescript
import LiveWorker from '@actdim/livestruct/worker?worker';
import LiveSharedWorker from '@actdim/livestruct/shared-worker?sharedworker';
```

**Option B - an app-local worker file** (what `livestruct-demo` does in `src/livestore/worker.ts`), useful when the app needs its own worker entry:

```typescript
// src/livestore/worker.ts
import '@livestore/adapter-web/worker-vite-dev-polyfill';
import { makeWorker } from '@livestore/adapter-web/worker';
import { schema } from '@actdim/livestruct/engine';

makeWorker({ schema });
```

```typescript
// imported where the store is created
const workerMod = await import('./livestore/worker?worker');
const sharedMod = await import('@livestore/adapter-web/shared-worker?sharedworker');
```

Whichever option you choose, the worker must register the **same** built-in `schema` that the UI context uses.

---

## Step 4. Create the store

```typescript
// src/store.ts
import { createLiveStruct, type LiveStoreInstance } from '@actdim/livestruct';

export async function openStore(): Promise<LiveStoreInstance> {
    const isNode = typeof window === 'undefined';

    let worker: unknown;
    let sharedWorker: unknown;
    if (!isNode) {
        worker = (await import('@actdim/livestruct/worker?worker')).default;
        sharedWorker = (await import('@actdim/livestruct/shared-worker?sharedworker')).default;
    }

    return createLiveStruct({
        name: 'cad_store',
        // Same-origin iframes share sessionStorage: give every context its own session id.
        sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        forceMemory: isNode,
        worker,
        sharedWorker,
    });
}
```

Check `store.storageMode` after startup:

| `storageMode` | Meaning |
|---|---|
| `'persisted'` | OPFS + leader worker + SharedWorker: durable and multi-tab. |
| `'single-tab'` | OPFS + leader worker, no SharedWorker (SharedWorker unavailable or not passed). |
| `'in-memory'` | No persistence: Node/SSR, `forceMemory`, `storagePath: ':memory:'`, no OPFS (for example some private windows), or worker construction failed. |

---

## Step 5. Open a collection and a document

```typescript
import type { LiveDocument } from '@actdim/livestruct';

interface CadShape {
    id: string;
    type: 'rect' | 'circle' | 'line';
    x: number;
    y: number;
    name?: string;
}

interface CadDocument {
    id: string;
    title: string;
    selectedShapeId?: string | null;
    shapes: Record<string, CadShape>;
}

const store = await openStore();
const documents = await store.collection<CadDocument>('cad_documents');

const doc: LiveDocument<CadDocument> =
    (await documents.get('doc-default')) ??
    (await documents.create('doc-default', {
        id: 'doc-default',
        title: 'Mechanical Assembly',
        selectedShapeId: null,
        shapes: {},
    }));
```

Mutations follow the "instant in memory, durable on flush" pattern used by the demo's `CadStore`:

```typescript
async function moveShape(shapeId: string, x: number, y: number): Promise<void> {
    void doc.patch({ shapes: { [shapeId]: { x, y } } }); // instant, coalesced commit
}

async function endDrag(): Promise<void> {
    await doc.flush(); // durable now; other tabs drop their tentative overlay
}

async function removeShape(shapeId: string): Promise<void> {
    void doc.patch({ shapes: { [shapeId]: null } }); // RFC 7396: null deletes the key
    await doc.flush();
}
```

---

## Step 6. Pair the store with a msgmesh bus

LiveStruct does not import `@actdim/msgmesh`; a bus is created next to the store for commands and ephemeral signals. The demo does exactly this:

```typescript
import { createMsgBus } from '@actdim/msgmesh/core';
import type { MsgBus } from '@actdim/msgmesh/contracts';

type CadMsgStruct = {
    'cad.cursor.drag': {
        in: { shapeId: string; x: number; y: number; timestamp: number };
    };
};

const bus: MsgBus<CadMsgStruct> = createMsgBus<CadMsgStruct>();

const abort = new AbortController();
bus.on({
    channel: 'cad.cursor.drag',
    options: { abortSignal: abort.signal },
    callback: (msg) => {
        void doc.patch({ shapes: { [msg.payload.shapeId]: { x: msg.payload.x, y: msg.payload.y } } });
    },
});
```

To publish storage changes onto a bus, subscribe to the public CDC stream and forward events in your own bridge (or use `@actdim/msgmesh-store`):

```typescript
const cdcSub = store.engine.cdc$.subscribe((event) => {
    if (event.origin === 'remote') {
        // forward { collection, id, rev, delta } to a bus channel of your choice
    }
});
```

---

## Step 7. Render with React (MobX)

`doc.data` reports to a MobX atom, so a `mobx-react-lite` `observer` re-renders when the document changes - this is how the demo's `PropertyInspector` and `VectorCanvas` read state:

```tsx
import React from 'react';
import { observer } from 'mobx-react-lite';
import type { LiveDocument } from '@actdim/livestruct';

export const DocumentTitle: React.FC<{ doc: LiveDocument<CadDocument> }> = observer(({ doc }) => {
    const data = doc.data; // tracked read
    return (
        <h2>
            {data.title}
            {doc.isTentative && <small> (live edit from another tab)</small>}
            {doc.isPending && <small> (saving...)</small>}
        </h2>
    );
});
```

Without MobX, subscribe to the RxJS stream:

```tsx
import { useEffect, useState } from 'react';

function useLiveData<T extends object>(doc: LiveDocument<T>): Readonly<T> {
    const [data, setData] = useState(doc.data);
    useEffect(() => {
        const sub = doc.$.subscribe(setData);
        return () => sub.unsubscribe();
    }, [doc]);
    return data;
}
```

**With `@actdim/dynstruct`:** dynstruct components are MobX-reactive, so the same rule applies - read `doc.data` (or a `toObservableDocument(doc)` proxy) inside the component's view and call document methods from its actions. Keep the store instance outside the component tree (or in a service) and close it on shutdown.

---

## Step 8. Observe errors and diagnostics

```typescript
store.errors$.subscribe((err) => console.error('[livestruct] commit failed', err));

store.events$.subscribe((evt) => {
    if (evt.type === 'commit') {
        console.debug('committed', evt.collection, evt.id, 'rev', evt.rev);
    }
});
```

`events$` drives the demo's telemetry panel (`local_patch`, `overlay_sent`, `overlay_received`, `commit`, `remote_commit`).

---

## Step 9. Shut down cleanly

```typescript
// Before a programmatic navigation or export that needs everything on disk:
await store.flush();

// On app teardown (HMR dispose, unmount of a standalone editor, tests):
await store.close(); // flushes, disposes collections, closes the LiveStore session
```

`pagehide` and `visibilitychange` (hidden) flushes are registered automatically by `createLiveStruct`, so no `beforeunload` handler is needed.

---

## Testing in Node (Vitest)

In Node the engine always uses LiveStore's in-memory adapter. LiveStore's SQLite package resolves the browser `wa-sqlite` build by default, so alias it to the Node build (this is LiveStruct's own `vitest.node.config.ts`):

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const waSqliteNodePath = require.resolve('@livestore/wa-sqlite/dist/wa-sqlite.node.mjs');

export default defineConfig({
    test: {
        environment: 'node',
        pool: 'forks',
    },
    resolve: {
        alias: {
            '@livestore/wa-sqlite/dist/wa-sqlite.mjs': waSqliteNodePath,
        },
    },
});
```

```typescript
import { it, expect } from 'vitest';
import { createLiveStruct } from '@actdim/livestruct';

it('patches and commits', async () => {
    const store = await createLiveStruct({ name: 'test_store', forceMemory: true, disableOverlay: true });
    const items = await store.collection<{ id: string; n: number }>('items');
    const doc = await items.create('a', { id: 'a', n: 1 });

    void doc.patch({ n: 2 });
    expect(doc.data.n).toBe(2);
    expect(doc.isPending).toBe(true);

    await doc.flush();
    expect(doc.isPending).toBe(false);
    await store.close();
});
```

---

## Checklist

- Vite: `worker.format: 'es'` and `optimizeDeps.exclude: ['@livestore/wa-sqlite']`.
- Worker and UI use the same built-in `schema`.
- Unique `sessionId` per tab and per iframe.
- Document bodies are JSON-safe; binary data goes through engine blobs.
- `await doc.flush()` where durability matters; `store.close()` on teardown.
- Subscribe to `store.errors$`.

---

[<- Back to 03. Architecture & Wiring](./topic--03-architecture-and-wiring.md) | [Next: 05. API Reference ->](./topic--05-api-reference.md)
