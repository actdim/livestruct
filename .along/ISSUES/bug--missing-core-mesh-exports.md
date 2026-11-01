---
protocol: along
protocol_version: "4.6.0"
slug: missing-core-mesh-exports
type: bug
status: open
priority: high
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [exports, publish]
blocked_by: []
related: []
---

# package.json exports ./core and ./mesh without entry points

`package.json` declares `./core` (`dist/core.es.js`) and `./mesh` (`dist/mesh.es.js`) exports, but there is no `src/core.ts` or `src/mesh.ts`, so the build emits neither file. Consumers importing `@actdim/livestruct/core` or `/mesh` fail to resolve. Must be fixed before the first npm publish.

## Requirements
- REQ-1: Every subpath in `package.json` `exports` MUST resolve to a file emitted by `pnpm run build`.
- REQ-2: Either add `src/core.ts` / `src/mesh.ts` entry points with an intended public surface, or remove the two exports.

## Acceptance Criteria
- [ ] After `pnpm run build`, every `exports` target exists in `dist/`.
- [ ] A test or script asserts that all declared export targets exist.
- [ ] `docs/topic--05-api-reference.md` matches the final export list.
