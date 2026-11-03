# Living Plan: demo-docs-into-lib

## Revision 1 (2026-11-03T15:35:27Z, ExitPlanMode)

The user approved one plan for dynstruct and livestruct together (ExitPlanMode, 2026-11-03). This record keeps only the livestruct part.

# Plan: demo docs go into the livestruct KB, and no Along files stay in demo/

Execution Mode: Direct.
Issue: `task--demo-docs-into-lib`.

## Context
The user wants everything about the demo described in the livestruct docs, and no Along remnants left in `demo/`.

Right now `demo/` still has its own Along context:
- `AGENTS.md`, `CLAUDE.md`;
- `.along/` (issues, sessions, VISION);
- `.claude/settings.json` (hooks);
- `.code-review-graph-ignore`, `.gitattributes`;
- `docs/`: INDEX, three topics, and `topic--along-protocol.md`;
- `llms.txt`, `llms-full.txt`.

## Steps
1. **Move the demo topics into `docs/`.**
   - `git mv demo/docs/topic--{architecture,domain-model,setup-and-workflow}.md docs/topic--demo-{architecture,domain-model,setup-and-workflow}.md`.
   - Front matter: new `slug` (`demo-architecture`, ...), titles prefixed "Demo:", `type: topic`.
   - Cross-links between them get the new names. `../README.md` becomes `../demo/README.md`.
2. **VISION.** Scope, Non-goals and Roadmap from `demo/.along/VISION.md` go into `.along/VISION.md`, as bullets prefixed "Demo:".
3. **Delete from `demo/`.**
   - `AGENTS.md`, `CLAUDE.md`, `.along/`, `.claude/`, `.code-review-graph-ignore`, `.gitattributes`, `docs/`, `llms.txt`, `llms-full.txt`.
   - What stays: the app, `README.md`, `.gitignore`, `LICENSE`.
4. **Links.**
   - Demo `README.md` links to `../docs/topic--demo-*.md`.
   - README and `AGENTS.md` link to the demo topics.
   - The VitePress sidebar gets a "Demo" group with the three topics and the live demo link.
5. **Sync.** Run `along kb-sync`, then grep for leftover `demo/docs`, `demo/AGENTS` and `demo/.along` references.
6. **Commit and wrap.** Nothing is pushed.

## Verification
- From mempart `src/`: `pnpm --filter @actdim/livestruct-demo typecheck`, `test` (63) and `build`.
- `pnpm run docs:build` passes, and the demo topics are in `.dist-docs`.
- `git ls-files demo` lists no Along files.
- `npm pack --dry-run` lists no `demo/` files.

## Deviation
The plan kept the demo sessions and closed issues only in git history. The `session-record-append-only` gate refused to delete committed session records, so they were moved (`git mv`) into this repository's `.along/SESSIONS/` and `.along/ISSUES/done/` instead.
