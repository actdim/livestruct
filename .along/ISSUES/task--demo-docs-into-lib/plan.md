# Living Plan: demo-docs-into-lib

## Revision 1 (2026-11-03T15:35:27Z, ExitPlanMode)

# Plan: demo docs go into the library KB, and no Along files stay in demo/

Execution Mode: Direct.
Issue: `task--demo-docs-into-lib` in dynstruct and in livestruct. It is already created and bound.

## Context
You said that everything about the demo should be described in the docs of the project itself (dynstruct, livestruct), and that no Along remnants should stay in the `demo/` folders.

Right now each `demo/` still has its own Along context:
- `AGENTS.md`, `CLAUDE.md`;
- `.along/` (issues, sessions, VISION);
- `.claude/settings.json` (hooks);
- `.code-review-graph-ignore`, `.gitattributes`;
- `docs/`: INDEX, three topics, and `topic--along-protocol.md`, a copy of the Along protocol reference;
- `llms.txt`, `llms-full.txt`.

Old demo repos: you will delete them yourself, so I don't touch them.

## Steps (both libraries)
1. **Move the demo topics into the library `docs/`.**
   - `git mv demo/docs/topic--{architecture,domain-model,setup-and-workflow}.md docs/topic--demo-{architecture,domain-model,setup-and-workflow}.md`.
   - Front matter: new `slug` (`demo-architecture`, ...), titles prefixed "Demo:", `type: topic`, so they are not confused with the library's own architecture, domain-model and setup topics.
   - Cross-links between them get the new names. `../README.md` becomes `../demo/README.md`.
   - The rest of the content is unchanged.
2. **VISION.**
   - Scope, Non-goals and Roadmap from `demo/.along/VISION.md` go into the library `.along/VISION.md`, as bullets prefixed "Demo:". The library VISION is an empty skeleton today.
   - `GLOSSARY` is empty and the issues and sessions are history; they are not moved. Git history keeps them.
3. **Delete from `demo/`:**
   - `AGENTS.md`, `CLAUDE.md`, `.along/`, `.claude/`, `.code-review-graph-ignore`, `.gitattributes`;
   - `docs/` (INDEX plus `topic--along-protocol.md`), `llms.txt`, `llms-full.txt`.
   - dynstruct only: also delete `public/llms.txt` and `public/llms-full.txt`. The `/llms.txt` links in `Header.astro` and `Footer.astro` will point to the library site, `https://actdim.github.io/dynstruct/llms.txt`; the Pages workflow already copies `llms.txt` into the docs site.
   - What stays in `demo/`: the app, `README.md`, `.gitignore`, and `LICENSE` in livestruct.
4. **Links.**
   - Demo `README.md`: links to `../docs/topic--demo-*.md`.
   - Library README: the Demo line links to the topics.
   - Library `AGENTS.md`: the Demo line names the topics and says the demo has no Along context of its own.
   - VitePress sidebar: a "Demo" group with the three topics plus the live demo link.
   - In dynstruct `docs/.vitepress/config.ts` I edit only the sidebar and commit only my hunk via `git apply --cached`. Your uncommitted v-pre change stays uncommitted.
5. **Sync.** `along kb-sync` on both libraries (INDEX, llms.txt, llms-full.txt), then a grep check that no `demo/docs`, `demo/AGENTS` or `demo/.along` reference remains.
6. **Commits.**
   - Commit and wrap in each library.
   - In mempart, a commit that moves the two submodule pointers.
   - Nothing is pushed.

## Verification
- From mempart `src/`:
  - `pnpm --filter @actdim/dynstruct-demo typecheck` and `build`;
  - `pnpm --filter @actdim/livestruct-demo typecheck`, `test` (63) and `build`.
- `pnpm run docs:build` passes in both libraries, and the demo topics are in `.dist-docs`.
- `git ls-files demo` lists no Along files.
- `npm pack --dry-run`: the new `docs/topic--demo-*.md` are included in the tarball, because `"files"` includes `docs`; there are still no `demo/` files.
