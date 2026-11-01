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

## Development and Testing

### Vitest Node Tests

Unit and correctness test suites run in Node environment using in-memory LiveStore engine adapters:

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test:w
```

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

The browser integration test suite covers:
- `boot.spec.ts`: Verifies store initialization with `storageMode === 'persisted'` and zero console/runtime errors.
- `replication.spec.ts`: Validates that mutations in Viewport A propagate to Viewport B and the host shell within 500ms.
- `overlay.spec.ts`: Tests that uncommitted rapid patches stream tentative state (`isTentative = true`), and transition to committed state (`isTentative = false`) upon document flush.
- `reload.spec.ts`: Proves that persisted OPFS SQLite state survives full page reload across all active context frames.
