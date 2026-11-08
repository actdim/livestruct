---
protocol: along
protocol_version: "4.6.1"
slug: adopt-dev-config
type: task
status: done
completed: 2026-11-08
priority: medium
created: 2026-11-06
updated: 2026-11-08
agent: antigravity
parent: task--shared-lint-tsconfig
tags: [tooling, lint, typescript, dev-config]
blocked_by: []
related: []
plan_status: approved
---

# Adopt @actdim/dev-config shared presets

## Problem Statement
Migrate local ESLint, Prettier, and TypeScript compiler configurations to `@actdim/dev-config`.

## Phase 2b Recipe
1. Baseline: ESLint findings, print-config of 2 files, showConfig of `tsconfig.build.json` and `tsconfig.dev.json`, `prettier --check`.
2. Add devDependency `"@actdim/dev-config": ">=1.12.2"`.
3. ESLint config:
   - `msgmesh`, `utico`, `msgmesh-remote`, `msgmesh-store`: use `base()` with existing `noExplicitAny` setting.
   - `dynstruct`: use `base({ indent: 'off' })` + `react()`.
   - `dynstruct-mui`: use `base()` + `react()`.
   - `livestruct`: use `legacyRoot()` plus local `no-explicit-any: error` block.
4. Prettier config: `{ ...base, jsxSingleQuote: false, trailingComma: 'all' }` unless check list stays equal without overrides.
5. tsconfig: extend `["@actdim/dev-config/tsconfig/base.json", "@actdim/dev-config/tsconfig/loose.json"]` plus differing options. Intentional diffs: drop decorator flags, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `isolatedModules: true`.
6. Drop unused plugin devDependencies.
7. Verify standalone: `pnpm install && pnpm lint && pnpm typecheck` in a standalone clone.
8. Commit in submodule, push to remote, and bump pointer in Mempart root.

## Outcome (2026-11-08)
- Recipe correction: there was no local ESLint config; `pnpm lint` (`npx eslint src`) only worked inside Mempart through the root `src/eslint.config.mjs` (`legacyRoot()` + a livestruct `no-explicit-any: error` block) and failed in a standalone clone. Added a local `eslint.config.mjs` with the same content and devDependencies `eslint`, `@actdim/dev-config`.
- `lib` stays `["ESNext", "DOM", "DOM.Iterable"]` (`Symbol.dispose` and other ESNext APIs are used; ES2022 would break).
- `prettier.config.js` = `@actdim/dev-config/prettier` (previously resolved Mempart `src/prettier.config.js`). Prettier `--check` list unchanged. `prettier` devDependency raised to `^3.9.6` (dev-config peer).
- ESLint: 81 findings before and after, identical lists; `--print-config` rule sets of 2 files identical.
- `--showConfig` diffs (build, dev): decorator flags removed, `isolatedModules: true` (+ implied `preserveConstEnums`), `dom.iterable` added. Nothing else.
- In Mempart and in a standalone clone: typecheck, build and 12 test files pass; standalone lint now exits 0 (was exit 2 at HEAD `4f3b580`).

## Acceptance Criteria
- [x] Submodule builds and passes lint and typecheck standalone.
- [x] No regression in finding sets and effective compiler options.
