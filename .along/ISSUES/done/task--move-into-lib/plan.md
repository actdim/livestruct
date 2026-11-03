# Living Plan: move-into-lib

## Revision 1 (2026-11-03T14:54:11Z, plan approve --plan-file)

# Plan: move the demos into the library repos (dynstruct/demo, livestruct/demo)

Execution Mode: Direct.
Issues:
- root umbrella `task--demos-into-libs`;
- a child `task--host-demo` (`parent: task--demos-into-libs`) in dynstruct and in livestruct.

## Context
dynstruct-demo and livestruct-demo are separate repos. To build them on GitHub Pages without npm we needed `scripts/ci-workspace.mjs`, which clones the `@actdim` repos into a temporary workspace. You want each demo to sit as a plain folder inside its library repo, with a pnpm workspace there. Then the library comes from the folder, and the other `@actdim` packages come from npm.
- No `"private"` flag, as you asked. After the move, mempart `publish:all` (`pnpm -r --filter "./packages/*" publish`) only matches direct children of `packages/`, so it no longer picks up the demos. Today it does.
- The library tarball does not pick up `demo/`, because its `"files"` whitelist lists only dist, docs and the README and AI files.

## Steps (same pattern for both pairs)
1. **Move the folder.**
   - Copy the demo's tracked files (`git ls-files`) into `<lib>/demo/`.
   - Do not copy `scripts/ci-workspace.mjs`, `.github/` or the `.ci-ws` and `dist` ignores.
   - History is not moved; it stays in the old demo repo.
   - The demo keeps its `.along/`, `AGENTS.md` and `docs/` as a nested context. Re-run `along init <abs>/demo` so its protocol block becomes a REF block pointing at the library.
2. **Wire the workspace.**
   - Library root gets `pnpm-workspace.yaml` (`packages: ['.', 'demo']`).
   - livestruct's workspace also gets a catalog with the mempart values: livestore 0.5.0, effect 4.0.3, @opentelemetry/api, @standard-schema/spec. Then `catalog:` resolves outside mempart too.
   - Library root also gets `.npmrc` with `link-workspace-packages=true` and `prefer-workspace-packages=true`, as in mempart.
   - In the demo, the dependency on its own library becomes `workspace:*`. The other `@actdim` deps keep `>=1.12.0` and come from npm.
   - dynstruct `eslint.config.mjs`: add `demo/**` to `ignores`. The tsconfig, vitest and jest include lists already cover only `src/` and `tests/`.
3. **Pages: one site per library.**
   - Docs stay at `/dynstruct/` and `/livestruct/`. The demos go to `/dynstruct/demo/` and `/livestruct/demo/`.
   - New workflow steps: `pnpm install`, then the docs build, then `pnpm --filter <demo> build` with `DEMO_BASE=/<lib>/demo/`, then copy the demo build into `.dist-docs/demo`.
   - The demo build step is `continue-on-error`. Until msgmesh, utico, dynstruct-mui and ui-core 1.12.x are on npm it fails, and the docs still deploy without the demo.
   - Add `demo/**` to the workflow path triggers.
4. **Links.**
   - livestruct README, VitePress nav and `topic--04-integration-guide.md`: `actdim.github.io/livestruct-demo/` becomes `/livestruct/demo/`.
   - Paths `src/packages/livestruct-demo` become `src/packages/livestruct/demo`.
   - Add a Demo link to the dynstruct README. I'll leave the dynstruct VitePress config alone: it has your uncommitted v-pre change.
   - Update the demos' own KB (setup-and-workflow without ci-workspace), `AGENTS.md` and README, and the libraries' `AGENTS.md`. Then `along kb-sync` in each.
5. **mempart.**
   - `src/pnpm-workspace.yaml`: add `packages/dynstruct/demo` and `packages/livestruct/demo`. Package names stay the same, so `dev:demo`, `--filter @actdim/*-demo` and the livestruct Playwright web server keep working.
   - `.claude/launch.json`: change the livestruct-demo paths.
   - Remove the `dynstruct-demo` and `livestruct-demo` submodules (`git submodule deinit` + `git rm`, plus their `.git/modules` entries), and update `pnpm-lock.yaml`.
   - Root `AGENTS.md` versioning list and `docs/topic--setup-and-workflow.md`: drop the demo submodules and describe the new location.
6. **Old demo repos.** One last commit in each, a README line "moved to github.com/actdim/<lib>/tree/main/demo". Archiving them on GitHub is your step.
7. **Commits.**
   - `along commit` in dynstruct and in livestruct (child issues), then wrap.
   - In mempart, commit the pointers, the workspace changes and the submodule removal, then wrap the umbrella issue.
   - Nothing is pushed.

## Verification
- From mempart `src/`:
  - `pnpm install`;
  - `pnpm --filter @actdim/dynstruct-demo typecheck` and `build`;
  - `pnpm --filter @actdim/livestruct-demo typecheck`, `test` (63) and `build`.
- dynstruct and livestruct own tests, typecheck and `docs:build` still pass, and `npm pack --dry-run` in each library lists no `demo/` files.
- Standalone check: copy the library repo (tracked files) to the scratchpad and run `pnpm install` plus the demo build there. Expected: it fails only on npm versions of the sibling `@actdim` packages, not on the library. livestruct's own package should resolve from the folder.
- Preview the built demo under `/livestruct/demo/` in the browser: no console errors, wasm and workers load.
