---
protocol: along
protocol_version: "4.6.0"
slug: demo-docs-into-lib
type: task
status: in-progress
priority: medium
created: 2026-11-03
updated: 2026-11-03
agent: claude-code
tags: [demo, docs, along]
blocked_by: []
related: [task--host-demo]
plan_status: approved
---

# Demo docs into the library KB; no Along context in demo/

After the move into `demo/` the demo still carried its own Along context (`AGENTS.md`, `CLAUDE.md`, `.along/`, `.claude/`, `docs/` with INDEX and the protocol reference, `llms*.txt`). The demo is part of this repository, so its knowledge belongs in this library's `docs/` and `.along/VISION.md`, and `demo/` keeps only the app, its `README.md` and `LICENSE`.

## Requirements
- REQ-1: Demo architecture, domain model and setup MUST live in `docs/topic--demo-*.md` of this library and be linked from README, AGENTS and the VitePress sidebar.
- REQ-2: `demo/` MUST NOT contain Along files (`AGENTS.md`, `CLAUDE.md`, `.along/`, `.claude/`, `.code-review-graph-ignore`, `.gitattributes`, `docs/`, `llms*.txt`).
- REQ-3: The demo MUST still typecheck, test and build from mempart `src/`.

## Acceptance Criteria
- [x] Demo topics in `docs/`, demo scope and roadmap in `.along/VISION.md`; links updated; along kb-sync run.
- [x] No Along files left under `demo/`.
- [x] Demo typecheck, tests and build pass; docs:build passes.
