---
protocol: along
protocol_version: "4.6.0"
slug: pages-demo-deployment
type: task
status: done
completed: 2026-11-04
priority: medium
created: 2026-11-04
updated: 2026-11-04
agent: antigravity
tags: []
blocked_by: []
related: []
plan_status: approved
---

# Deploy docs and demo to GitHub Pages identically to dynstruct

Enable GitHub Pages workflow deployment on actdim/livestruct and align .github/workflows/pages.yml
with dynstruct so that both VitePress documentation and the interactive demo are published to GitHub Pages.

## Requirements
- REQ-1: GitHub Pages MUST be enabled on the actdim/livestruct repository using workflow build type.
- REQ-2: The .github/workflows/pages.yml workflow MUST install dependencies cleanly, build docs into .dist-docs, and build the demo into .dist-docs/demo.
- REQ-3: Peer dependencies for @actdim packages in package.json MUST be compatible with published npm packages.
- REQ-4: The demo MUST build with DEMO_BASE=/livestruct/demo/ and deploy to https://actdim.github.io/livestruct/demo/.

## Acceptance Criteria
- [x] GitHub Pages workflow runs and completes with green build and deploy jobs
- [x] Documentation site https://actdim.github.io/livestruct/ responds with 200 OK
- [x] Live demo https://actdim.github.io/livestruct/demo/ responds with 200 OK
