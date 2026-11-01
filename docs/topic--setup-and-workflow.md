---
protocol: along
protocol_version: "4.5.4"
slug: setup-and-workflow
title: Setup, Installation & Agent Workflows
type: setup-workflow
created: 2026-10-30
updated: 2026-11-01
tags: [setup, workflow, installation, lifecycle, quality-gates, playwright, testing]
---

# Setup, Installation & Agent Workflows

Core technical specification and documentation for livestruct.

## Overview

LiveStruct is an ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite and event sourcing) for TypeScript applications.

For consuming the package in an application, see the [Integration Guide](./topic--04-integration-guide.md). This page covers working on the package itself inside the monorepo (`src/packages/livestruct`).

## Package Layout

| Path | Contents |
|---|---|
| `src/index.ts` | Root entry: `createLiveStruct` and re-exports of engine, lens and document modules. |
| `src/engine.ts`, `src/document.ts`, `src/lens.ts` | Subpath entries (`/engine`, `/document`, `/lens`). |
| `src/worker.ts`, `src/shared-worker.ts` | Worker entries (`/worker`, `/shared-worker`). |
| `src/engine/` | `LiveDocEngine`, built-in schema, adapter resolution, BlobStore, storage adapters, legacy v1 migration. |
| `src/document/` | `LiveDocumentImpl`, `LiveCollectionImpl`, `CommitScheduler`, `OverlayChannel`, helpers. |
| `src/lens/` | `NestedPath` / `PathValue` types and immutable path helpers. |
| `tests/*.test.ts` | Vitest node suites (document, collection, engine, engine correctness, lazy commit, lens, LiveStore engine). |
| `tests/types/` | Type-level tests (`*.test-d.ts`). |
| `tests/browser/` | Playwright specs run against `livestruct-demo`. |
| `spikes/` | LiveStore integration spikes (also picked up by the node Vitest config). |
| `docs/` | Knowledge Base (this folder). |

## Scripts

All scripts are defined in `package.json` and run from `src/packages/livestruct` (or with `pnpm --filter @actdim/livestruct <script>` from the workspace root):

| Script | Command | Purpose |
|---|---|---|
| `pnpm test` | `vitest --config=vitest.node.config.ts --no-cache` | Node unit and correctness suites (in-memory LiveStore). |
| `pnpm test:w` | `vitest --config=vitest.node.config.ts --watch` | Same, in watch mode. |
| `pnpm test:browser` | `playwright test` | Chromium suite against the `livestruct-demo` preview server. |
| `pnpm build` | `tsc -b tsconfig.json && vite build` | Type-check, then build ES modules and `.d.ts` files into `dist/` (one output file per source file, `preserveModules`). |
| `pnpm typecheck` | `tsc -b tsconfig.json` | Type-check only. |
| `pnpm lint` | `eslint src` | Lint sources. |
| `pnpm format` / `pnpm format:check` | `prettier --write .` / `prettier --check .` | Formatting. |
| `pnpm docs:dev` / `docs:build` / `docs:preview` | `vitepress dev docs` / `vitepress build docs` / `vitepress preview docs` | Documentation site (published at https://actdim.github.io/livestruct/). |

Peer dependencies are externalized by the build (`packageConfig.ts` `externals`), so `dist/` contains no LiveStore, Effect, MobX or RxJS code.

## Development and Testing

### Vitest Node Tests

Unit and correctness test suites run in Node environment using in-memory LiveStore engine adapters:

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test:w
```

`vitest.node.config.ts` aliases `@livestore/wa-sqlite/dist/wa-sqlite.mjs` to the Node build `wa-sqlite.node.mjs`; without it LiveStore tries to load the browser WASM loader in Node. Tests run in the `forks` pool with `isolate: false` and include both `tests/**` and `spikes/**` (browser specs under `tests/browser/**` are excluded). `tests/helpers.ts` provides `nextEmission(obs$, predicate, timeoutMs)` for awaiting stream emissions without fixed sleeps.

### Browser Tests

Browser integration tests run with Playwright against Chromium and exercise real OPFS storage, SharedWorkers, background synchronization, and ephemeral overlay channels using the `livestruct-demo` harness.

#### Browser Prerequisites

Ensure Playwright Chromium is installed:

```bash
pnpm exec playwright install chromium
```

#### Running Browser Tests

```bash
# Run Playwright browser suite
pnpm test:browser
```

`playwright.config.ts` starts `pnpm --filter @actdim/livestruct-demo preview --port 4173 --strictPort` as its web server (reused locally when already running), so build `livestruct-demo` first. Tests run serially (`workers: 1`) in Desktop Chrome at 1440x900.

The browser integration test suite covers:
- `boot.spec.ts`: Verifies store initialization with `storageMode === 'persisted'` and zero console/runtime errors.
- `replication.spec.ts`: Validates that mutations in Viewport A propagate to Viewport B and the host shell within 500ms.
- `overlay.spec.ts`: Tests that uncommitted rapid patches stream tentative state (`isTentative = true`), and transition to committed state (`isTentative = false`) upon document flush.
- `reload.spec.ts`: Proves that persisted OPFS SQLite state survives full page reload across all active context frames.
