---
protocol: along
protocol_version: "4.6.0"
slug: demo-live-links
type: docs
status: done
completed: 2026-11-04
priority: medium
created: 2026-11-04
updated: 2026-11-04
agent: antigravity
tags: [docs, demo, github-pages, links]
blocked_by: []
related: []
plan_status: approved
---

# Add live demo and documentation links to README and docs

Add direct links and badges to the deployed GitHub Pages interactive demo (https://actdim.github.io/livestruct/demo/) and documentation (https://actdim.github.io/livestruct/) across README.md and documentation articles.

## Requirements
- REQ-1: README.md MUST include badges and direct links at the top to https://actdim.github.io/livestruct/ and https://actdim.github.io/livestruct/demo/.
- REQ-2: demo/README.md MUST include badges and direct links to the live demo and docs.
- REQ-3: docs/topic--01-overview-and-advantages.md and related docs MUST include direct links to the live interactive demo.
- REQ-4: docs/.vitepress/config.ts nav bar MUST clearly label the live demo link.

## Acceptance Criteria
- [x] README.md contains top badges and direct links to the live demo and documentation site
- [x] demo/README.md contains direct links to the live demo and documentation site
- [x] docs/topic--01-overview-and-advantages.md contains direct link to the live demo site
- [x] docs/.vitepress/config.ts nav bar labels the live demo clearly
