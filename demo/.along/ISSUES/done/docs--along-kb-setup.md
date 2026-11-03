---
protocol: along
protocol_version: "4.6.0"
slug: along-kb-setup
type: docs
status: done
completed: 2026-11-01
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [along, docs]
parent: task--along-init-demo-submodules
blocked_by: []
related: []
---

# Along context and knowledge base for the demo

`along init` added `AGENTS.md` / `CLAUDE.md` to livestruct-demo on 2026-11-01. Its three KB topics
were 17-line scaffold stubs, and `AGENTS.md` project specifics and `.along/VISION.md` were
placeholders. The README showed an npm badge for a package that is not published.

## Requirements
- REQ-1: `docs/topic--architecture.md`, `topic--domain-model.md` and `topic--setup-and-workflow.md` MUST describe the demo as the code implements it.
- REQ-2: `AGENTS.md` project specifics, `.along/VISION.md` and README (live demo link, documentation section) MUST be filled from facts.
- REQ-3: `docs/INDEX.md`, `llms.txt`, `llms-full.txt` MUST be compiled by `along kb-sync`.

## Acceptance Criteria
- [x] No scaffold placeholder text in `docs/`, `AGENTS.md` or `.along/VISION.md`.
- [x] `along test` passes.
- [x] `along kb-sync` reports no broken links.
