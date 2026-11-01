---
protocol: along
slug: livestore-architecture
type: decision
title: "LiveStore 0.5.0 Architecture and Engine Integration"
date: 2026-11-01
status: accepted
tags: [adr, architecture, decision]
---

# ADR-2026-11-01--livestore-architecture - LiveStore 0.5.0 Architecture and Engine Integration

- Date: 2026-11-01
- Status: accepted
- Context: livestruct requires a reactive local-first embedded SQLite engine with OPFS persistence and cross-tab sync. LiveSqliteEngine previously used an in-memory Map rewriting whole JSON files on every mutation. Spike spike--livestore-integration tested LiveStore 0.5.0 capabilities across Q1-Q9 including install, node tests, RFC 7396 merge patch, worker shipping, multi-iframe sessions, UI thread latency, CDC attribution, embedding defaults, and bundle size.
- Decision: Adopt LiveStore 0.5.0 as the core reactive SQLite engine for livestruct (GO verdict). 1. Pin exact versions: @livestore/livestore 0.5.0, @livestore/adapter-web 0.5.0, @livestore/wa-sqlite 0.5.0, effect 4.0.3 cohort (@effect/platform-node 4.0.3, @effect/platform-browser 4.0.3, @opentelemetry/api 1.9.0, @standard-schema/spec 1.1.0). 2. Use SQLite native json_patch(body, ?) in raw SQL materializers for RFC 7396 merge patch with positional parameters. 3. Ship @actdim/livestruct/worker dist file consumed via Vite ?worker import and worker.format: es. 4. Explicitly assign unique sessionId per context to prevent iframe sessionStorage collision. 5. Require confirmUnsavedChanges: false and disableDevtools: true for embedded usage. 6. UI thread commit latency is p95 = 0.55 ms (<= 4 ms threshold), with zero long tasks at 60 fps; use optimistic local overlay for instant UI mutations and debounced LiveStore commits for drag operations.
- Consequences: Positive: True multi-tab reactive OPFS SQLite with Leader worker; zero UI main-thread blocking; strict RFC 7396 merge patch without JS roundtripping; clean CDC attribution via table columns; robust fallback to in-memory mode in private browsing. Negative: livestruct-demo bundle size increases by 164 kB gzip JS and 303 kB gzip WASM; apps using Vite must configure worker.format: es and optimizeDeps.exclude for wa-sqlite.
