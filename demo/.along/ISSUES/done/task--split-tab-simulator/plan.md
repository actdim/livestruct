# Plan: Dual-Viewport Split Simulation via Isolated iframes & SQLite File Portability

Execution Mode: Direct

## Steps
1. In `src/cad/store.ts`:
   - Implement `exportCadDatabase(store: CadStore): Promise<Uint8Array>` streaming raw SQLite binary from storage.
   - Implement `downloadCadProject(store: CadStore, filename?: string): Promise<void>` triggering browser download.
   - Implement `importCadDatabase(store: CadStore, binaryData: Uint8Array): Promise<void>` mounting imported database into store.
2. In `src/cad/broadcast.ts`:
   - Setup cross-tab / cross-iframe `BroadcastChannel` bridge syncing `cad.cursor.drag` and document mutation notifications.
3. In `src/components/SplitSimulator.tsx`:
   - Dual-viewport container rendering two isolated same-origin `<iframe>` elements (`allow-scripts allow-same-origin`) pointing to `?viewport=A` and `?viewport=B`.
   - Viewport mode toggle in host shell: "Single Viewport", "Dual iframe Split", "Open Native Tab".
   - Import/Export toolbar buttons in header: "Export Project (.cad)", "Import Project (.cad / .db)" with file input and drag-and-drop.
   - Hotkey handling for Undo/Redo (Ctrl+Z / Ctrl+Y) with focus awareness.
4. Update `src/App.tsx`:
   - Inspect `window.location.search` for `?viewport=A` or `?viewport=B` (iframe mode) vs Host Shell mode.
   - When in iframe mode, render standalone viewport (Canvas + Inspector) connected to shared BroadcastChannel.
   - When in Host Shell mode with Split View, render `SplitSimulator` with dual iframes + global TelemetryMonitor.
5. Create `tests/splitSimulator.test.ts`:
   - REQ-1 & REQ-2: Verify cross-tab / cross-iframe communication via BroadcastChannel and OPFS.
   - REQ-3: Viewport mode state toggles ("Single Viewport", "Dual iframe Split", "Open Native Tab").
   - REQ-4: Undo/Redo routing.
   - REQ-5: Export project binary verification.
   - REQ-6: Import project binary and document mounting verification.
6. Verify formatting, ASCII compliance, vitest tests and build:
   `pnpm --dir src --filter @actdim/livestruct-demo test`
   `pnpm --dir src --filter @actdim/livestruct-demo build`
7. Commit changes to livestruct-demo git: `git -C src/packages/livestruct-demo add -A; git -C src/packages/livestruct-demo commit -m "feat(split): dual-viewport isolated iframe simulation and sqlite export-import"`
8. Check all acceptance criteria in `.along/ISSUES/task--split-tab-simulator.md` with `[x]`.
9. Complete issue: `along issue done split-tab-simulator` and `along issue sync`.
