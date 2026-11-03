---
protocol: along
protocol_version: "4.5.4"
slug: pages-deploy
type: task
status: done
completed: 2026-11-01
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [ci, pages]
parent: docs--lib-docs-demo-pages
blocked_by: []
related: []
---

# Build and publish the demo to GitHub Pages from CI

The demo has no CI. It depends on unpublished `@actdim/livestruct` / `@actdim/msgmesh-store` and on
pnpm `catalog:` versions, so a standalone `pnpm install` fails outside the mempart monorepo.

## Requirements
- REQ-1: A CI script MUST assemble a pnpm workspace with the demo and its `@actdim/*` sibling repositories cloned from GitHub, including the catalog the demo uses.
- REQ-2: The Vite build MUST honour a base path supplied by CI (`/livestruct-demo/`) and stay `/` for local dev.
- REQ-3: `.github/workflows/pages.yml` MUST build and deploy `dist` to GitHub Pages on push to `main` and on manual dispatch.

## Acceptance Criteria
- [x] Running the CI script locally against fresh clones produces `dist/index.html` referencing `/livestruct-demo/` assets.
- [x] `pnpm dev` inside mempart is unaffected.
- [x] Workflow file present and valid YAML.
