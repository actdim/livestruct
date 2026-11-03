# Plan: Real-Time Telemetry & Protocol Monitor

Execution Mode: Direct

## Steps
1. Create `src/telemetry/types.ts`:
   - Define `TelemetryCategory` ('ephemeral' | 'sqlite' | 'cdc').
   - Define `TelemetryEvent` (id, timestamp, category, channel, latencyUs, sizeBytes, updatedFields, rev, origin, payloadSummary, rawPayload).
   - Define `TelemetryMetrics` (messagesPerSec, diskWriteCount, totalEphemeralCount, totalSqliteCount, totalCdcCount).
   - Implement `calculateThroughput(timestamps, windowMs, now)`.
   - Implement `filterTelemetryEvents(events, filterQuery)`.
2. Create `src/components/TelemetryMonitor.tsx`:
   - Subscribe to `cadStore.bus.on({ channel: CAD_DRAG_CHANNEL, callback })` -> generate green ephemeral events with microsecond latency.
   - Subscribe to `cadStore.doc.engine.cdc$` (or `doc.$`) -> distinguish local SQLite commits (blue badge, transaction size, updated fields, rev) vs external CDC replication (orange badge, origin, timestamp).
   - Render Metrics Bar: Throughput (msg/s), Disk Writes (count), Ephemeral Stream events (count), CDC events (count).
   - Render Filter Bar: Quick filter buttons ('ALL', 'cad.*', 'sqlite.*', 'cdc.*') + text filter input.
   - Stream controls: Pause/Resume toggle, Clear Log button.
   - Simulation buttons: "Simulate Remote CDC", "Simulate Ephemeral Drag", "Simulate SQLite Commit".
   - Event Log Feed: scrollable list with colored badges (`[RAM 60fps]`, `[SQLITE COMMIT]`, `[CDC REPLICA]`), payload summary, expandable details.
3. Mount `<TelemetryMonitor cadStore={store} />` in `src/App.tsx` replacing the footer placeholder.
4. Create `tests/telemetryMonitor.test.ts`:
   - REQ-1: Verify event categorization and colored badge assignments (green ephemeral, blue sqlite, orange cdc).
   - REQ-2: Verify throughput calculation (`calculateThroughput`) and disk write tracking.
   - REQ-3: Verify channel prefix filtering (`filterTelemetryEvents` for `cad.*`, `sqlite.*`, `cdc.*`).
   - Test simulate buttons and pause/clear stream controls.
5. Format code with Prettier, verify ASCII cleanliness.
6. Run vitest and build:
   `pnpm --dir src --filter @actdim/livestruct-demo test`
   `pnpm --dir src --filter @actdim/livestruct-demo build`
7. Commit changes to livestruct-demo git: `git -C src/packages/livestruct-demo add -A; git -C src/packages/livestruct-demo commit -m "feat(telemetry): implement real-time protocol and bus monitor"`
8. Mark acceptance criteria in `.along/ISSUES/task--telemetry-protocol-monitor.md` with `[x]`.
9. Complete issue: `along issue done telemetry-protocol-monitor` and `along issue sync`.
