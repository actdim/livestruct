# Vision

_North star: scope, boundaries, non-goals, roadmap. Evolves slowly; slims as features ship._

## Scope

- Demo: a runnable, browser-only showcase (`demo/`, `@actdim/livestruct-demo`) of living documents: in-memory patch streaming and tentative overlays vs single SQLite (OPFS) commits on flush.
- Demo: zero-server multi-context sync made visible on one screen: dual isolated same-origin iframes and native tabs sharing one LiveStore database through the dedicated and shared workers.
- Demo: a CAD-style editing surface (canvas drag, property inspector, undo/redo, `.cad` export/import) that exercises the library APIs the way an application would.
- Demo: a telemetry monitor that classifies RAM, SQLite and cross-context traffic so the cost of each interaction is observable.
- Demo: a laboratory for the library stack: the `?spike=livestore` harness, the Vitest suite and the library Playwright suite pin behaviour (commit counts, overlay propagation, echo suppression).
- Demo: public deployment on GitHub Pages next to the docs (https://actdim.github.io/livestruct/demo/).

## Non-goals

- Demo: not a CAD product: no real geometry kernel, constraints, layers management, multi-document projects or file-format compatibility beyond the demo's own `.cad` layout.
- Demo: not an npm package or reusable component library; nothing in `demo/` is imported by other packages.
- Demo: no backend, accounts or remote sync server; replication stays within one browser origin.
- Demo: no reimplementation of library behaviour (commit scheduling, overlay TTL, echo suppression, worker protocol).
- Demo: no independent versioning; the version follows the mempart monorepo.

## Roadmap

- Demo: route canvas drag streams over the typed msgmesh channel `cad.cursor.drag` in addition to `doc.patch`, so the RAM bus path shown in the monitor is driven by real interactions.
- Demo: exercise `@actdim/msgmesh-store` (bus commands to the store, CDC published back on the bus, worker host/client); add it as a dependency together with the first import.
- Demo: move the property inspector onto the `@actdim/dynstruct` component model to match the other `@actdim` demos; add `@actdim/dynstruct` as a dependency then.
- Demo: browser-level tests (OPFS, dual iframes, native tab) alongside the Node Vitest suite.
- Demo: export and import the actual LiveStore OPFS database (with event history) in addition to the current single-row `.cad` file.
