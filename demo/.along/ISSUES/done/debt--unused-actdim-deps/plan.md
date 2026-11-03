# Living Plan: unused-actdim-deps

## Revision 1 (2026-11-02T11:32:52Z, ExitPlanMode)

# Plan: remove unused @actdim deps from livestruct-demo

Execution Mode: Direct. Issue: livestruct-demo `debt--unused-actdim-deps` (already created and in progress).

## Context
`livestruct-demo/package.json` declares `@actdim/dynstruct` and `@actdim/msgmesh-store`, but nothing in `src/` imports them. The only `@actdim` imports are `@actdim/livestruct`, `@actdim/livestruct/engine`, `@actdim/msgmesh/contracts` and `@actdim/msgmesh/core`.

Because of the two unused entries, the Pages CI script (`scripts/ci-workspace.mjs`) also clones and builds dynstruct and msgmesh-store. The docs also suggest the demo uses them when it does not.

## Steps
1. **`package.json`**: remove `@actdim/dynstruct` and `@actdim/msgmesh-store` from `dependencies`. Keep `@actdim/utico`, because livestruct and msgmesh have it as a peer.
2. **Lockfile**: run `pnpm install` from mempart `src/` to update `src/pnpm-lock.yaml`.
3. **Docs**:
   - `docs/topic--setup-and-workflow.md`: change the list of linked workspace packages to livestruct, msgmesh and utico.
   - `.along/VISION.md`, roadmap: "exercise msgmesh-store directly" and "move the inspector onto dynstruct" stay as future work, worded as "add the dependency when used" rather than "instead of only declaring it".
   - Check the README sentence about dynstruct. It is context, not a dependency claim, so it stays unless it implies the demo uses dynstruct.
4. **KB**: run `along kb-sync <absolute path>` to rebuild `llms-full.txt`.
5. **Commit**:
   - In livestruct-demo, commit with `along commit -i unused-actdim-deps`, then `along wrap`.
   - In mempart root, commit the submodule pointer and `pnpm-lock.yaml`.

## Verification
- In livestruct-demo, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
- Run `scripts/ci-workspace.mjs` once from a fresh copy in the scratchpad. It should clone only utico, msgmesh and livestruct, and still build.

## Out of scope
Moving the demos into the dynstruct and livestruct repos. I'll answer that separately, and nothing changes until you decide.
