---
protocol: along
protocol_version: "4.6.0"
slug: unused-actdim-deps
type: debt
status: done
completed: 2026-11-02
priority: low
created: 2026-11-02
updated: 2026-11-02
agent: claude-code
tags: [dependencies]
blocked_by: []
related: []
plan_status: approved
---

# Drop unused @actdim/dynstruct and @actdim/msgmesh-store dependencies

`package.json` declares `@actdim/dynstruct` and `@actdim/msgmesh-store`, but no file under `src/` imports either package. The only `@actdim` imports are `@actdim/livestruct`, `@actdim/livestruct/engine`, `@actdim/msgmesh/contracts` and `@actdim/msgmesh/core`. The unused entries make the demo install and build two extra libraries (locally and in the Pages CI, which clones every declared `@actdim` dependency), and the README and KB imply the demo exercises them when it does not.

## Requirements
- REQ-1: `package.json` MUST NOT list `@actdim/dynstruct` or `@actdim/msgmesh-store` while no source file imports them.
- REQ-2: The KB (`docs/topic--setup-and-workflow.md`), `AGENTS.md` and `.along/VISION.md` MUST describe the remaining dependency set; the roadmap keeps adding them back as future work (bus-driven store via msgmesh-store, inspector on dynstruct).

## Acceptance Criteria
- [x] Both entries removed from `package.json`; mempart `src/pnpm-lock.yaml` updated.
- [x] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [x] Docs updated; `along kb-sync` re-run.
