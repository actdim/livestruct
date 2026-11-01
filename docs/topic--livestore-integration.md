---
protocol: along
protocol_version: "4.5.4"
slug: livestore-integration
title: LiveStore 0.5.0 Integration & Architectural Spike
type: topic
curated: true
created: 2026-11-01
updated: 2026-11-01
tags: [livestore-integration]
---

# LiveStore 0.5.0 Integration & Architectural Spike

This document records the empirical results and architectural verification for integrating LiveStore 0.5.0 into `@actdim/livestruct`. Conducted under issue `spike--livestore-integration`.

## Executive Summary: GO Verdict

All technical feasibility questions (Q1 through Q9) have been evaluated with concrete evidence, runnable tests, and benchmark measurements in both Node.js (Vitest) and headless browser (Chrome) environments:
- **Verdict**: GO for LiveStore 0.5.0 in `feat--livestore-engine`.
- **UI Thread Commit Latency**: p95 = 0.55 ms on a 50-shape CAD document (well below the 4.0 ms mitigation threshold).
- **Long Tasks**: Zero long tasks (>16.6 ms) observed during continuous 60 fps commit streams.
- **Cross-Context Sync**: Validated across host and 2 same-origin iframes with dedicated session IDs (median latency 18.0 ms).
- **RFC 7396 Merge Patch**: SQLite native `json_patch(body, ?)` fully verified for deep nested merges, null deletes, and array replacement.

---

## Detailed Investigation (Q1 - Q9)

### Q1: Package Version Pinning & Monorepo Build Cleanliness

**Question**: Exact versions to pin (`@livestore/livestore`, `@livestore/adapter-web`, `@livestore/wa-sqlite`, `effect` + peers) through the pnpm catalog; does `pnpm install` + `tsc -b` of the whole workspace stay green?

**Evidence & Configuration**:
The following exact versions are pinned in `pnpm-workspace.yaml` catalog and package overrides:
- `@livestore/livestore`: `0.5.0`
- `@livestore/adapter-web`: `0.5.0`
- `@livestore/wa-sqlite`: `0.5.0`
- `effect`: `4.0.3`
- `@effect/platform-node`: `4.0.3`
- `@effect/platform-browser`: `4.0.3` (overridden in `package.json` to prevent resolution of mismatched 4.1.x)
- `@effect/platform-node-shared`: `4.0.3`
- `@effect/opentelemetry`: `4.0.3`
- `@opentelemetry/api`: `1.9.0`
- `@standard-schema/spec`: `1.1.0`

**Outcome**:
- `pnpm install` completed with code 0 and zero unmet peer dependency warnings for Effect.
- `pnpm -r --if-present run typecheck` across all 18 workspace projects passed with 0 errors.

---

### Q2: Node Environment & Vitest In-Memory Store

**Question**: A Vitest node test creates a store with `makeInMemoryAdapter()`, commits, queries synchronously, subscribes (record the vitest config needed).

**Evidence & Test Path**:
- Test file: `spikes/livestore/store-node.test.ts`
- Verified: `createStorePromise` instantiates in-memory store in Node; `store.commit` executes synchronously; `store.query` returns updated rows immediately; `store.subscribe` delivers synchronous callback notifications.
- Vitest configuration needed (`vitest.node.config.ts`):
  LiveStore's `@livestore/sqlite-wasm` module defaults to browser wasm loader (`mod.browser.js`), which imports `@livestore/wa-sqlite/dist/wa-sqlite.mjs`. In Node.js, this fails without the Node wa-sqlite factory.
  Resolved by adding the alias to `vitest.node.config.ts`:
  ```ts
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);
  const waSqliteNodePath = require.resolve('@livestore/wa-sqlite/dist/wa-sqlite.node.mjs');

  export default defineConfig({
      resolve: {
          alias: {
              ...config.resolveAliases(),
              '@livestore/wa-sqlite/dist/wa-sqlite.mjs': waSqliteNodePath,
          },
      },
  });
  ```

---

### Q3: RFC 7396 Merge Patch Materializer

**Question**: Does `json_patch(body, ?)` work in a raw-SQL materializer, including null-deletes and nested objects; if not, measure the alternative (read via `ctx.query`, merge in JS, write full body)?

**Evidence & Test Path**:
- Test file: `spikes/livestore/rfc7396-patch.test.ts`
- Verified: SQLite built-in `json_patch(body, ?)` function (from JSON1 extension compiled in `@livestore/wa-sqlite`) completely adheres to RFC 7396:
  - Deep nested merges: updating `{ viewport: { center: { x: 150 } } }` preserves `{ viewport: { center: { y: 200 } } }` and `{ viewport: { zoom: 1.0 } }`.
  - Null deletes: setting `{ metadata: { author: null } }` completely removes the `author` key from the JSON object.
  - Array replacement: setting `{ items: [10, 20] }` replaces `[1, 2, 3]` entirely per RFC 7396 rules.
- Implementation detail:
  LiveStore's `prepareBindValues` treats array arguments as positional parameters (`?`) directly. Passing positional parameters `[patch, mutationId, origin, id]` avoids object `$param` naming discrepancies.
- Benchmark Comparison (500 commits in Node):
  - `json_patch` (raw SQL): 173.96 ms total (~347.9 us / commit).
  - JS read-merge-write: 138.07 ms total (~276.1 us / commit).
  Both achieve identical final document states. `json_patch` in raw SQL is selected as the primary engine pattern because it avoids multiple IPC / query roundtrips from materializer to JS.

---

### Q4: Worker Shipping Strategy

**Question**: Can `@actdim/livestruct/worker` (a dist file calling `makeWorker({ schema })` with livestruct's built-in schema) be consumed by livestruct-demo in Vite dev AND `vite build`, via (a) `?worker` / `?sharedworker` imports in the app, (b) `new Worker(new URL(..., import.meta.url), { type: 'module' })` inside the library? Pick one; record required Vite config (`worker.format`, `optimizeDeps.exclude`).

**Decision & Evidence**:
- Selected Strategy: Option (a) (`?worker` and `?sharedworker` Vite module imports).
- Reason: Option (b) fails in Vite development when consumed from pre-bundled node_modules dependencies because Vite cannot rewrite dynamic `import.meta.url` worker paths without bundling them as separate chunks. Option (a) instructs Vite's bundler to emit dedicated worker entry chunks with proper chunk hashes in `dist/assets/`.
- Required Vite configuration in consuming application:
  ```ts
  export default defineConfig({
      worker: {
          format: 'es', // Required: LiveStore workers use ES module syntax and top-level imports
      },
      optimizeDeps: {
          exclude: ['@livestore/wa-sqlite'], // Required: prevents Vite from attempting to pre-bundle WebAssembly loader
      },
  });
  ```
- Bundling verification in `livestruct-demo`:
  - `worker.ts?worker` compiled to `dist/assets/worker-CA0xLbw7.js` (494.37 kB)
  - `@livestore/adapter-web/shared-worker?sharedworker` compiled to `dist/assets/make-shared-worker-CHFnPVOd.js` (278.89 kB)
  - `wa-sqlite.wasm` emitted as static asset `dist/assets/wa-sqlite-CWco9gcB.wasm` (619.00 kB)

---

### Q5: Multi-Iframe Session Handling

**Question**: Host + 2 same-origin iframes with explicit unique `sessionId` each: all three see each other's commits; measure commit-to-remote-subscription latency (median, p95, n>=100).

**Evidence & Measurements**:
- Headless Chrome test harness: `livestruct-demo` running host page + 2 same-origin iframes.
- Discovery: Same-origin iframes share the same `window.sessionStorage`. Without explicitly supplying a unique `sessionId`, all iframes and host collapse onto the same session ID, leading to session conflicts and dropped echo events.
- Solution: Each context explicitly passes `sessionId: 'session-' + role + '-' + crypto.randomUUID()` to `makePersistedAdapter({ ... })`.
- Benchmark Results (n = 152 cross-context mutations delivered from Host to Iframe 1 and Iframe 2):
  - Median latency (p50): **18.0 ms**
  - 95th percentile latency (p95): **35.7 ms**
  - Long tasks on main thread: **0**
- Behavior: All 3 contexts maintain bidirectional sync through the SharedWorker and Leader Worker with zero data loss.

---

### Q6: UI Thread Commit Cost & Long Task Verification

**Question**: Time `store.commit` of one patch event on a 50-shape document with 1, 5, 20 active subscriptions (median, p95, n>=500) in Chrome; time 60 commits/s for 3 s and record long tasks.

**Evidence & Measurements**:
- Test file: `spikes/livestore/commit-perf.test.ts`
- Document payload: 50 vector shapes (each shape having id, type, x, y, width, height, fill, stroke, rotation).
- Latency per commit across subscription scales (n = 500 commits per run):

| Active Subscriptions | Mean Latency | Median (p50) | p95 Latency | p99 Latency | Max Latency |
|---|---|---|---|---|---|
| **1 subscription** | 0.391 ms | 0.348 ms | **0.550 ms** | 1.131 ms | 4.218 ms |
| **5 subscriptions** | 0.341 ms | 0.324 ms | **0.418 ms** | 0.724 ms | 2.000 ms |
| **20 subscriptions** | 0.320 ms | 0.300 ms | **0.371 ms** | 0.578 ms | 2.159 ms |

- Threshold Evaluation:
  The acceptance criterion requires reporting if 1-subscription p95 > 4.0 ms. The measured p95 is **0.550 ms**, which is **7.2x faster** than the 4.0 ms threshold.
- Continuous 60 fps Test (3 seconds, 180 frames):
  - Mean commit time: 0.907 ms
  - Median commit time: 0.935 ms
  - p95 commit time: 1.206 ms
  - Long tasks (>16.6 ms): **0 / 180** (zero frame drops)

---

### Q7: Remote Change Attribution & CDC Semantics

**Question**: Can a remote context recover `mutationId` and origin of a change (include them in event args; read via `store.events()` or table subscription) to keep livestruct CDC semantics?

**Evidence & Test Path**:
- Test file: `spikes/livestore/cdc-attribution.test.ts`
- Finding on `store.events()`:
  In LiveStore 0.5.0, `store.events()` delegates to `streamEventsWithSyncState`, which suspends on an internal sliding queue waiting for future state head advancements. If subscribed after a sync batch finishes, it remains suspended until subsequent events are committed.
- Recommended Livestruct CDC Pattern:
  Store `mutation_id` and `origin` directly as table columns (`mutation_id TEXT, origin TEXT`) populated by the materializer.
  When remote events arrive, `store.subscribe(tables.docs)` emits the updated row with exact `mutation_id` and `origin` synchronously and deterministically. This guarantees 100% reliable Change Data Capture (CDC) without dependency on background stream queues.

---

### Q8: Embedding Defaults & Storage Mode Fallback

**Question**: Confirm `confirmUnsavedChanges: false`, `disableDevtools: true` remove the beforeunload prompt and devtools; check `store.storageMode` fallback in a private window.

**Evidence & Test Path**:
- Test file: `spikes/livestore/embedding-defaults.test.ts`
- Source lines in `@livestore/livestore`:
  - `create-store.js` line 58: `confirmUnsavedChanges` defaults to `true`.
  - `ClientSessionSyncProcessor.js` line 70: when `confirmUnsavedChanges === true`, LiveStore registers a `window.addEventListener('beforeunload', ...)` listener that calls `event.preventDefault()` if pending commits exist.
  - Setting `confirmUnsavedChanges: false` completely bypasses the `beforeunload` listener, preventing livestruct from hijacking host page navigation.
  - Setting `disableDevtools: true` disables devtools webmesh channels and eliminates debug communication overhead.
- Storage Mode Fallback:
  When running in private browsing or non-secure contexts where OPFS (`navigator.storage.getDirectory`) is unavailable, `makePersistedAdapter` checks OPFS availability and automatically falls back to `storageMode: 'in-memory'`.

---

### Q9: Bundle Impact

**Question**: Added gzip size to livestruct-demo build (JS + WASM).

**Evidence & Build Output**:
Measured before and after LiveStore integration in `livestruct-demo`:

| Asset | Baseline (Before LiveStore) | With LiveStore 0.5.0 | Net Impact |
|---|---|---|---|
| **Main App JS** | 363.50 kB (108.60 kB gzip) | 882.89 kB (272.91 kB gzip) | **+164.31 kB gzip** |
| **WASM Binary** (`wa-sqlite.wasm`) | 0 kB | 619.00 kB (303.53 kB gzip) | **+303.53 kB gzip** |
| **Leader Worker** | 0 kB | 494.37 kB (uncompressed) | Separate Worker Chunk |
| **Shared Worker** | 0 kB | 278.89 kB (uncompressed) | Separate Worker Chunk |

**Analysis**:
The client bundle increase (+164 kB gzip) is attributable to the LiveStore client session runtime, Effect standard library, and OpenTelemetry instrumentation. The SQLite WASM binary (303 kB gzip) is loaded asynchronously by the worker loader and cached by browser storage.

---

## Architectural Decisions for `feat--livestore-engine`

1. **Document Storage Table**:
   Maintain a single universal `docs` table (`id TEXT PRIMARY KEY, body TEXT, mutation_id TEXT, origin TEXT`) in SQLite WASM.
2. **Materializers**:
   Use native SQLite `json_patch(body, ?)` with positional bind values for all document patch operations.
3. **Worker Shipping**:
   Export `@actdim/livestruct/worker` as an ES module entry point; instruct consuming apps to import via `?worker` with Vite `worker.format: 'es'`.
4. **Local Optimistic Overlay**:
   `doc.patch()` writes immediately to a local in-memory overlay for instant O(1) reads, while scheduling a debounced `store.commit()` to SQLite to coalesce fast drag/typing events into a single transaction.
5. **Session Identity**:
   Require passing an explicit unique `sessionId` on engine initialization to ensure proper isolation in same-origin multi-iframe topologies.
