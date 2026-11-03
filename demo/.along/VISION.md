# Vision

_North star: scope, boundaries, non-goals, roadmap. Evolves slowly; slims as features ship._

## Scope

- A runnable, browser-only showcase of `@actdim/livestruct` living documents: in-memory patch streaming and tentative overlays vs single SQLite (OPFS) commits on flush.
- Zero-server multi-context sync made visible on one screen: dual isolated same-origin iframes and native tabs sharing one LiveStore database through the dedicated and shared workers.
- A CAD-style editing surface (canvas drag, property inspector, undo/redo, `.cad` export/import) that exercises the library APIs the way an application would.
- A telemetry monitor that classifies RAM, SQLite and cross-context traffic so the cost of each interaction is observable.
- A laboratory for the library stack: the `?spike=livestore` harness and the Vitest suite pin behaviour (commit counts, overlay propagation, echo suppression) that the libraries must keep.
- Public deployment on GitHub Pages next to the livestruct docs (`/livestruct/demo/`), built from the livestruct repository workspace.

## Non-goals

- Not a CAD product: no real geometry kernel, constraints, layers management, multi-document projects or file-format compatibility beyond the demo's own `.cad` layout.
- Not an npm package or reusable component library; nothing here is imported by other packages.
- No backend, accounts or remote sync server; replication stays within one browser origin.
- No reimplementation of library behaviour (commit scheduling, overlay TTL, echo suppression, worker protocol); those belong to livestruct, msgmesh and msgmesh-store and are documented on their sites.
- No independent versioning: the version follows the mempart monorepo.

## Roadmap

- Route canvas drag streams over the typed msgmesh channel `cad.cursor.drag` in addition to `doc.patch`, so the RAM bus path shown in the monitor is driven by real interactions.
- Exercise `@actdim/msgmesh-store` (bus commands to the store, CDC published back on the bus, worker host/client); add it as a dependency together with the first import.
- Move the property inspector onto the `@actdim/dynstruct` component model to match the other `@actdim` demos; add `@actdim/dynstruct` as a dependency then.
- Browser-level tests (OPFS, dual iframes, native tab) alongside the Node Vitest suite.
- Export and import the actual LiveStore OPFS database (with event history) in addition to the current single-row `.cad` file.
