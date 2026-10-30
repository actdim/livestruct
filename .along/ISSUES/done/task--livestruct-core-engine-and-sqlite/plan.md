# Living Plan: LiveStruct Core Engine and SQLite Storage Driver

Status: Approved
Date: 2026-10-30
Milestone: v2.0.0-along-transition
Issue: task--livestruct-core-engine-and-sqlite

## 1. Objectives & Requirements
- REQ-1: Embedded SQLite storage engine initializing in browser OPFS with memory fallback.
- REQ-2: Universal document schema maintaining collections, id, rev, JSON data, and binary BLOBs (Float32Array / Uint8Array).
- REQ-3: RFC 7396 JSON merge patch implementation for atomic and partial document updates.
- REQ-4: Change Data Capture (CDC) observable streams (`cdc$`) emitting insert, update, and delete events matching `LiveEngineAccess`.
- REQ-5: Raw query (`queryRaw`) and raw event commit (`commitRaw`) execution matching `LiveEngineAccess`.

## 2. Architecture & File Layout
- `src/engine/types.ts`: Core type definitions for storage adapter, document records, CDC events, and engine config.
- `src/engine/patch.ts`: Pure RFC 7396 compliant JSON merge patch implementation.
- `src/engine/blobs.ts`: Binary serialization and deserialization for Float32Array (CAD/GIS geometry) and Uint8Array BLOBs.
- `src/engine/storage.ts`: Storage adapters for browser OPFS and universal in-memory fallback.
- `src/engine/sqliteEngine.ts`: LiveSqliteEngine implementing universal document tables, raw query execution, commit handling, and CDC streams.
- `src/engine/index.ts`: Engine entry point exporting factory function and utilities.
- `src/engine.ts`: Top-level `./engine` entry alias for build and export map compatibility.
- `src/index.ts`: Main package entry integrating engine with `createLiveStruct` and `createLiveEngine`.
- `tests/engine.test.ts`: Vitest test suite verifying engine initialization, CRUD, RFC 7396 merge patch, binary BLOBs, CDC streams, and raw SQL queries.

## 3. Step-by-Step Implementation Steps
1. Create `src/engine/types.ts` with complete type contracts.
2. Create `src/engine/patch.ts` with RFC 7396 JSON merge patch algorithm.
3. Create `src/engine/blobs.ts` supporting Float32Array and Uint8Array binary buffers.
4. Create `src/engine/storage.ts` implementing OPFS adapter and in-memory storage fallback.
5. Create `src/engine/sqliteEngine.ts` implementing document tables, CDC observables, and `LiveEngineAccess`.
6. Create `src/engine/index.ts` and `src/engine.ts` with clean exports.
7. Update `src/index.ts` connecting `createLiveStruct` with the live engine.
8. Implement comprehensive tests in `tests/engine.test.ts`.
9. Validate with `pnpm --filter @actdim/livestruct test`, `typecheck`, and `build`.
10. Verify ASCII typography, wrap issue, and commit changes across submodule and root.
