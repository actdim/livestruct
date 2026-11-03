---
protocol: along
protocol_version: "4.6.0"
slug: host-demo
type: task
status: in-progress
priority: medium
created: 2026-11-02
updated: 2026-11-03
agent: claude-code
tags: [demo, workspace, pages]
blocked_by: []
related: []
parent: task--demos-into-libs
plan_status: approved
---

# Host the demo app in demo/ with a pnpm workspace

The livestruct-demo app moves from its own repo (mempart submodule src/packages/livestruct-demo) into demo/ of this repo. A pnpm workspace here (packages: [".", "demo"]) links this library from the folder; the other @actdim packages come from npm. The Pages workflow builds the docs and the demo together: docs at /livestruct/, demo at /livestruct/demo/. The demo build step is continue-on-error until the sibling @actdim packages 1.12.x are on npm. Parent: root task--demos-into-libs.

## Requirements
- REQ-1: demo/ MUST hold the demo app, with its dependency on this library as workspace:*.
- REQ-2: The library build, tests, lint and npm tarball MUST NOT include demo/.
- REQ-3: The Pages workflow MUST deploy the demo under /livestruct/demo/ next to the docs.

## Acceptance Criteria
- [x] demo/ added; pnpm-workspace.yaml and .npmrc at the root.
- [x] Library tests and typecheck pass; npm pack --dry-run lists no demo/ files.
- [x] Demo typecheck and build pass from mempart src/.
- [x] Pages workflow, README and KB links updated; along kb-sync run.
