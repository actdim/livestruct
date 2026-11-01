---
protocol: along
protocol_version: "4.5.4"
slug: kb-parity-and-pages
type: docs
status: in-progress
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [docs, pages]
parent: docs--lib-docs-demo-pages
blocked_by: []
related: []
---

# Knowledge base, llms.txt and VitePress Pages site at dynstruct parity

The livestruct KB has architecture and LiveStore integration topics but lacks the reader-facing
set that `@actdim/dynstruct` provides (overview and advantages, core concepts, integration guide,
API reference), has no documentation site, and `llms-full.txt` is not compiled from the full topic set.

## Requirements
- REQ-1: The KB MUST add overview, core concepts, integration and API reference topics grounded in `src/` exports.
- REQ-2: `llms.txt` and `llms-full.txt` MUST be regenerated from the KB via the Along KB pipeline.
- REQ-3: The repo MUST contain a VitePress config under `docs/.vitepress/` and a `docs:build` script that outputs `.dist-docs`.
- REQ-4: `.github/workflows/pages.yml` MUST deploy the site to GitHub Pages on push to `main`.

## Acceptance Criteria
- [ ] New topics exist, cross-linked from `docs/INDEX.md` and README; every API name cited exists in `src/`.
- [ ] `along kb-sync --check` reports no broken links.
- [ ] `pnpm run docs:build` succeeds locally.
- [ ] `pages.yml` mirrors the dynstruct workflow.
