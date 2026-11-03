---
protocol: along
protocol_version: "4.6.0"
slug: move-into-lib
type: task
status: done
completed: 2026-11-03
priority: medium
created: 2026-11-03
updated: 2026-11-03
agent: claude-code
tags: [demo, workspace, pages]
blocked_by: []
related: []
parent: task--demos-into-libs
plan_status: approved
---

# Live in demo/ of the livestruct repo

The demo moved from its own repository (mempart submodule `src/packages/livestruct-demo`) into `demo/` of the livestruct repository. `@actdim/livestruct` now resolves from the repository workspace (`workspace:*`); `@actdim/msgmesh` and `@actdim/utico` come from npm. `scripts/ci-workspace.mjs` and the demo's own Pages workflow are gone: the livestruct workflow builds the demo into `/livestruct/demo/`. Parent: root `task--demos-into-libs`.

## Requirements
- REQ-1: The demo docs, `AGENTS.md`, `README.md` and config comments MUST describe the new location, workspace and Pages path `/livestruct/demo/`.
- REQ-2: The demo MUST still typecheck, test and build from mempart `src/`.

## Acceptance Criteria
- [x] Docs, AGENTS, README, `vite.config.ts` comment and `package.json` repository links updated; along kb-sync run.
- [x] Typecheck, tests and build pass from mempart `src/`.
