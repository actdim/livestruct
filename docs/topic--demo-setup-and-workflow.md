---
protocol: along
protocol_version: "4.5.4"
slug: demo-setup-and-workflow
title: "Demo: Setup, Build & Workflow"
type: topic
created: 2026-11-01
updated: 2026-11-03
tags: [setup, workflow, vite, vitest, opfs, github-pages, ci, monorepo]
---

# @actdim/livestruct-demo Setup, Build & Workflow

> The demo app lives in [`demo/`](../demo/README.md) of this repository; file paths in this article are relative to `demo/`.

## 1. Prerequisites

- **Node.js**: 22 (the version the Pages workflow uses).
- **Package manager**: `pnpm` (CI pins 10.30.3).
- **Workspace**: the demo lives in `demo/` of the livestruct repository. It depends on `@actdim/livestruct` as `workspace:*`, declares `catalog:` versions for `@livestore/livestore`, `@livestore/adapter-web`, `@livestore/wa-sqlite` and `effect`, and `>=1.12.0` ranges for `@actdim/msgmesh` and `@actdim/utico`. It installs inside a pnpm workspace that provides that catalog: the livestruct repository root (`pnpm-workspace.yaml` with packages `.` and `demo`, the other `@actdim` packages from npm) or the mempart monorepo (`src/pnpm-workspace.yaml` lists `packages/livestruct/demo`, all `@actdim` packages from their folders).
- **Browser** (persistent mode): a secure context (`localhost` or HTTPS) with OPFS (`navigator.storage.getDirectory`), module `Worker`, `SharedWorker` and `BroadcastChannel`. A browser without `SharedWorker` cannot run the persisted multi-tab setup. Same-origin iframes need storage access, so private or third-party-cookie-restricted modes can block the dual view.

## 2. Running Inside mempart

The demo is the folder `src/packages/livestruct/demo` (inside the livestruct submodule) and a member of the mempart pnpm workspace; the nested `pnpm-workspace.yaml` of livestruct is ignored there. mempart's `src/package.json` has `dev:demo` / `build:demo` shortcuts only for `@actdim/dynstruct-demo`, so address this package with a filter from `src/`:

```bash
cd src
pnpm install
pnpm --filter @actdim/livestruct-demo dev     # Vite dev server on http://localhost:4173
pnpm --filter @actdim/livestruct-demo build
pnpm --filter @actdim/livestruct-demo test
```

The workspace links `@actdim/livestruct`, `msgmesh` and `utico` from their sibling folders (the demo does not depend on `dynstruct` or `msgmesh-store`). Their `exports` point at `dist/`, so build a library (`pnpm --filter @actdim/livestruct build`) after changing it before the demo sees the change.

Useful URLs on the dev server: `/` (host shell), `/?split=dual` (two isolated iframes), `/?viewport=A` (single child viewport), `/?spike=livestore` (raw LiveStore benchmark). In the browser console `window.__cadStore` is the active `CadStore`.

## 3. Runner Commands

Run from the package folder (or with `pnpm --filter @actdim/livestruct-demo <script>` from mempart `src/`).

| Command | Action | Description |
|---|---|---|
| `pnpm run dev` | `vite` | Dev server on port 4173 with the dedicated LiveStore worker and shared worker. |
| `pnpm run build` | `tsc -b tsconfig.json && vite build` | Typechecks, then bundles the SPA into `dist/` (base path from `DEMO_BASE`, default `/`). |
| `pnpm run preview` | `vite preview` | Serves the built `dist/`. |
| `pnpm run test` | `npx vitest --config=vitest.node.config.ts --no-cache` | Runs `tests/**/*.test.ts` once in Node. |
| `pnpm run typecheck` | `tsc -b tsconfig.json` | Type checks without bundling. |
| `pnpm run format` | `prettier --write .` | Formats the package. |
| `pnpm run format:check` | `prettier --check .` | Verifies formatting. |

## 4. Tests

`vitest.node.config.ts` runs in the `node` environment with globals, `pool: 'forks'`, `isolate: false`, setup file `vitest.setup.ts` (defines `globalThis.self`) and typecheck config `tsconfig.dev.json`. In Node `initCadStore` defaults to `forceMemory`, so no OPFS or worker is used.

| File | Covers |
|---|---|
| `tests/vectorCanvas.test.ts` | Geometry (bounding boxes, hit testing, translation, handles), drag patches without synchronous writes, one commit on flush, 300-move drag benchmark with at most 4 commits, reaction to external `doc.$` updates, renderer routines. |
| `tests/propertyInspector.test.ts` | MobX observer rendering, per-field patch commits, canvas-to-inspector sync, shape selector, 200 ms name debounce and flush. |
| `tests/splitSimulator.test.ts` | Cross-viewport overlays and commits, echo suppression, mode switching and iframe sandbox, undo/redo replication, `.cad` export as valid SQLite, import of SQLite and JSON payloads with peer propagation. |
| `tests/telemetryMonitor.test.ts` | Badges per category, throughput metrics, channel and text filters, field and size extraction, live `CadStore` event capture, simulation controls. |

## 5. GitHub Pages CI

The livestruct repository workflow `.github/workflows/pages.yml` publishes one site: the docs at [https://actdim.github.io/livestruct/](https://actdim.github.io/livestruct/) and the demo at [https://actdim.github.io/livestruct/demo/](https://actdim.github.io/livestruct/demo/). It runs on push to `main` (docs, `src/`, `demo/`, `pnpm-workspace.yaml`, the workflow) and on manual dispatch.

After the docs build, the `Build demo` step (with `DEMO_BASE=<base_path>/demo/`):

1. Runs `pnpm install --no-frozen-lockfile` in the repository workspace (`.` and `demo`; the catalog lives in `pnpm-workspace.yaml`).
2. Builds the library (`pnpm run build`), because the demo imports `@actdim/livestruct` through its `dist/` exports.
3. Builds the demo (`pnpm --filter @actdim/livestruct-demo build`) and copies `demo/dist` to `.dist-docs/demo`.

`@actdim/msgmesh` and `@actdim/utico` come from npm. Until they are published at `>=1.12.0` the step fails; it is `continue-on-error`, so the docs still deploy without the demo.

### 5.1. Local reproduction

From the livestruct repository root (bash, outside mempart):

```bash
pnpm install --no-frozen-lockfile
pnpm run build
DEMO_BASE=/livestruct/demo/ pnpm --filter @actdim/livestruct-demo build
pnpm --filter @actdim/livestruct-demo preview -- --base /livestruct/demo/
```

PowerShell:

```powershell
$env:DEMO_BASE = '/livestruct/demo/'; pnpm --filter @actdim/livestruct-demo build
```

## 6. Quality Gates

1. `pnpm run typecheck` and `pnpm run test` pass.
2. `pnpm run format:check` is clean.
3. `pnpm run build` succeeds with and without `DEMO_BASE`; relative links (`?viewport=A`) keep working under `/livestruct/demo/`.
4. A manual check in a browser with OPFS: drag a shape in `/?split=dual`, confirm the peer shows the tentative ghost and then the committed position, and that the monitor shows one `sqlite.commit` per drag.
5. Docs stay ASCII, with fenced code languages and relative links (checked at commit time in the livestruct repository).
6. Versioning: the package version follows the mempart monorepo. Change it only with `pnpm run version:sync <version>` from mempart `src/`, never by editing this `package.json` alone.

## 7. Cross-Links

- [Architecture](./topic--demo-architecture.md)
- [Domain Model](./topic--demo-domain-model.md)
- [README](../demo/README.md)
- livestruct docs: [https://actdim.github.io/livestruct/](https://actdim.github.io/livestruct/)
- msgmesh-store docs: [https://actdim.github.io/msgmesh-store/](https://actdim.github.io/msgmesh-store/)
