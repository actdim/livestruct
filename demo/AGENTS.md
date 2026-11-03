<!-- BEGIN ALONG-PROTOCOL ref=../AGENTS.md (managed by along-init - do not edit by hand) -->
This folder belongs to a repository that uses the ALONG structure. The full working
guidance + agent-context protocol live once in the nearest ancestor `AGENTS.md` (`../AGENTS.md`) -
read it there. This folder keeps its OWN `.along/` state; use the nearest one.
Only this folder's specifics follow.
<!-- END ALONG-PROTOCOL -->

## Project specifics

<!-- BEGIN ALONG-RULES -->
See the following engineering guidelines:
- `[languages/typescript.md](.along/rules/languages/typescript.md)`
- `[platforms/web.md](.along/rules/platforms/web.md)`
<!-- END ALONG-RULES -->

- **What it is**: Vite + React 19 SPA showcasing `@actdim/livestruct` (LiveStore SQLite in OPFS via `src/livestore/worker.ts` plus the adapter-web shared worker) and `@actdim/msgmesh`; one CAD document `cad_documents/doc-default` driven by `src/cad/store.ts` (`CadStore`). Not published to npm.
- **Commands**: `pnpm dev` (port 4173), `pnpm build`, `pnpm test` (Vitest in Node, in-memory store), `pnpm typecheck`; inside mempart run them from `src/` with `pnpm --filter @actdim/livestruct-demo <script>`.
- **Entry modes**: `?split=dual` (two isolated same-origin iframes), `?viewport=A|B|native` (child viewport), `?spike=livestore` (raw LiveStore benchmark).
- **Location and workspace**: `demo/` of the livestruct repository (mempart: `src/packages/livestruct/demo`). `@actdim/livestruct` is `workspace:*`; outside mempart the livestruct `pnpm-workspace.yaml` (packages `.` and `demo`, catalog) links it, and `msgmesh` / `utico` come from npm.
- **CI/Pages**: the livestruct `.github/workflows/pages.yml` builds the library, then the demo with `DEMO_BASE=/livestruct/demo/`, and deploys it next to the docs at https://actdim.github.io/livestruct/demo/ (step is `continue-on-error` until the `@actdim` siblings 1.12.x are on npm).
- **Knowledge base**: start at `docs/INDEX.md` (architecture, domain model, setup and workflow); library internals live on the livestruct and msgmesh-store sites.
- **Versioning**: the version is unified across the mempart monorepo; change it only via `pnpm run version:sync <version>` from mempart `src/`, never in this `package.json` alone.
