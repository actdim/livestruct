---
protocol: along
protocol_version: "4.5.4"
slug: split-tab-simulator
type: task
status: done
completed: 2026-10-31
priority: medium
created: 2026-10-30
updated: 2026-10-31
agent: antigravity
tags: [split-tab, multi-tab, iframe, broadcastchannel, simulation, opfs]
blocked_by: []
related: []
plan_status: approved
---

# Dual-Viewport Split Simulation via Isolated iframes & SQLite File Portability

## Objective
Implement a dual-viewport split-screen simulation using isolated same-origin `<iframe>` instances to demonstrate genuine cross-window zero-server synchronization on a single screen (including mobile and tablet displays), alongside project SQLite database export/import.

## Technical Architecture: iframe vs Native Tabs

While native tabs prove cross-window synchronization, requiring the user to resize browser windows or use dual monitors creates friction. Using two same-origin `<iframe>` viewports (`<iframe src="/viewport?id=A">` and `<iframe src="/viewport?id=B">`) offers key advantages:
1. Genuine Context Isolation: Each iframe operates with its own `window`, independent JavaScript heap, and dedicated DOM tree. No shared in-memory React/MobX references are possible.
2. Identical Browser Mechanics: BroadcastChannel, Web Locks API, and OPFS SQLite instances operate between same-origin iframes identically to separate browser tabs.
3. Mobile & Touch Screen Ready: Single-screen side-by-side demonstration works seamlessly on mobile devices where multi-windowing is restricted by the OS.

```text
+-------------------------------------------------------------------------+
| HOST SHELL (Main Window Controller)                                     |
| Controls: [View: Single / Dual iframe / New Tab] | [Export .cad]        |
+------------------------------------+------------------------------------+
| Left <iframe src="/viewport?id=1"> | Right <iframe src="/viewport?id=2">|
| (Context A)                        | (Context B)                        |
|                                    |                                    |
| - Independent JS Heap & Window     | - Independent JS Heap & Window     |
| - Canvas & Dynstruct Inspector     | - Canvas & Dynstruct Inspector     |
| - Local BroadcastChannel Listener  | - Local BroadcastChannel Listener  |
+------------------------------------+------------------------------------+
| GLOBAL TELEMETRY SPY (Host MsgMesh Monitor)                             |
| Listens to BroadcastChannel and visualizes cross-iframe CDC deltas      |
+-------------------------------------------------------------------------+
```

## Requirements
- REQ-1: The application MUST support a split-screen mode rendering two isolated same-origin `<iframe>` elements (`allow-scripts allow-same-origin`) sharing OPFS and BroadcastChannel.
- REQ-2: Mutating an entity in iframe A (via Canvas drag or property form) MUST update the view in iframe B synchronously via BroadcastChannel/OPFS.
- REQ-3: The host shell MUST provide viewport mode toggles: "Single Viewport", "Dual iframe Split", and "Open Native Tab".
- REQ-4: Hotkey and focus handling MUST ensure Undo/Redo commands (Ctrl+Z / Ctrl+Y) are routed correctly whether triggered inside an iframe or from the host shell.
- REQ-5: "Export Project (.cad)" MUST stream the active binary SQLite database directly out of OPFS and trigger a browser download.
- REQ-6: "Import Project" MUST allow dropping a `.cad` / `.db` SQLite file to mount it into the live session across all active iframes.

## Acceptance Criteria
- [x] Toggling split view renders two side-by-side `<iframe>` viewports.
- [x] Moving a primitive in the left iframe immediately moves the primitive and updates property inputs in the right iframe.
- [x] Telemetry monitor confirms events flow through BroadcastChannel and OPFS rather than shared in-memory objects.
- [x] Exported SQLite file can be inspected using standard SQLite CLI tools.
- [x] Drag-and-drop import replaces the active database and refreshes both iframes synchronously.
