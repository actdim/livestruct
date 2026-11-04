# @actdim/livestruct-demo

> **Interactive Showcase & Laboratory for @actdim/livestruct, @actdim/msgmesh, and Local-First SQLite OPFS Living Documents**

[![Live demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://actdim.github.io/livestruct/demo/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Documentation](https://img.shields.io/badge/Docs-actdim.github.io%2Flivestruct-blue.svg)](https://actdim.github.io/livestruct/)

- **Live Demo Site**: https://actdim.github.io/livestruct/demo/
- **LiveStruct Documentation**: https://actdim.github.io/livestruct/

---

## 1. Purpose of the Showcase

While `@actdim/dynstruct` provides UI component models and `@actdim/msgmesh` provides asynchronous communication, **`@actdim/livestruct`** transforms local-first storage into a living, synchronized document.

This demonstration application showcases the critical differences between in-memory message streaming and durable storage commits:

1. **Separation of Concerns:** 60fps mouse drag operations stream exclusively in RAM over `MsgMesh`, while final state updates commit once to SQLite OPFS.
2. **Zero-Server Multi-Tab Replication:** Mutating properties in one tab synchronizes with all other tabs via `BroadcastChannel` and OPFS without a backend server.
3. **Decoupled Architecture:** UI components interact with documents and the message mesh through strict contracts, avoiding tight coupling to database drivers.
4. **Time-Travel & File Portability:** Integrated Undo/Redo history via event-sourcing and direct export/import of the SQLite project database.

---

## 2. Interactive Zones

The application layout is structured into three coordinated viewports:

```
+------------------------------------+------------------------------------+
| ZONE 1: Interactive Canvas         | ZONE 2: LiveDocument Inspector     |
| (2D HTML5 Canvas / Vector Sheet)   | (Dynstruct Reactive Property Form) |
|                                    |                                    |
| - CAD Primitive (Rectangle/Part)   | - Part Name (text input)           |
| - Vertices / Transform Handles     | - Layer Selection (dropdown)       |
| - Interactive Drag & Rotation      | - Fill Color (color picker)        |
| - Real-time Coordinate Display     | - Bounding Box (X, Y, Width, H)    |
| - In-Memory Drag Stream (60fps)    | - Undo / Redo Controls (Ctrl+Z/Y)  |
+------------------------------------+------------------------------------+
| ZONE 3: Telemetry & Protocol Monitor (Bus Traffic & Storage Engine Log) |
|                                                                         |
| [RAM] MsgMesh Stream: cad.cursor.drag (60fps, 0 disk I/O)               |
| [DISK] LiveStruct Commit: json_patch transaction in SQLite (OPFS)       |
| [CDC] MsgMesh-Store Broadcast: STORE.ENTITY_PATCHED across tabs         |
+-------------------------------------------------------------------------+
```

---

## 3. Key Scenarios Demonstrated

### Scenario A: Ephemeral Drag vs Durable Commit
- **Interaction:** Dragging a primitive on the canvas.
- **Data Flow:** Coordinates stream at 60fps via MsgMesh channel `cad.cursor.drag` (green telemetry badge, 0 disk I/O).
- **Commit:** On `mouseUp`, a single `doc.patch()` transaction commits final coordinates to SQLite OPFS (blue telemetry badge).

### Scenario B: Split-View Simulation via Isolated iframes
- **Interaction:** Clicking "Simulate Dual Tab" renders two isolated same-origin `<iframe>` instances side-by-side.
- **Verification:** Because each iframe possesses an independent JavaScript heap, DOM tree, and window context, the synchronization between them proves genuine local-first coordination over `BroadcastChannel` and OPFS without shared in-memory state.
- **Single-Screen & Mobile:** Users witness real multi-window synchronization immediately on a single monitor or mobile device without opening separate browser tabs.

### Scenario C: Project File Export and Import
- **Export:** Clicking "Download Project (.cad)" streams the SQLite binary file directly from OPFS.
- **Import:** Dropping an existing `.cad` SQLite database loads all entities and restores undo/redo history.

---

## 4. Development & Running

```bash
# Start development server
pnpm dev

# Build production bundle
pnpm build

# Run unit tests
pnpm test
```

---

## 5. Documentation

- [Architecture](../docs/topic--demo-architecture.md): zones, RAM streaming vs SQLite commits, worker topology, multi-tab sync, undo/redo, export/import.
- [Domain Model](../docs/topic--demo-domain-model.md): CAD shapes and document, bus channels, LiveStore schema usage, telemetry records.
- [Setup & Workflow](../docs/topic--demo-setup-and-workflow.md): running inside mempart, scripts, tests, browser requirements, GitHub Pages CI.
- Library documentation: [livestruct](https://actdim.github.io/livestruct/), [msgmesh-store](https://actdim.github.io/msgmesh-store/).
