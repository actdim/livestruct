---
protocol: along
protocol_version: "4.5.4"
slug: test-coverage-and-naming
type: debt
status: in-progress
priority: low
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [tests, types]
blocked_by: [feat--transparent-lazy-commit, bug--engine-correctness-batch]
related: []
plan_status: approved
---
# Browser integration tests, no fixed sleeps, deprecated aliases, strict types

## Problem

tests rely on fixed sleeps, nothing exercises the real browser stack (OPFS, workers, multiple
contexts), legacy names remain, and `any`/loose `PatchPayload` weaken type safety.

Launch position: **9** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Requirements
- REQ-1: No test MAY use a fixed `setTimeout` sleep; use fake timers or awaited observables.
- REQ-2: A browser integration test (Playwright, Chrome) MUST cover: persisted adapter boot, two-context replication, overlay live values, reload persistence.
- REQ-3: Deprecated aliases (`LiveSqliteEngine`) MUST keep compiling and be marked `@deprecated`.
- REQ-4: No `any` in `src/` (eslint `no-explicit-any` as error); `PatchPayload<T>` recursive and strict with `patchUnchecked()` escape hatch.

## Acceptance Criteria
- [x] `grep -rn "setTimeout(resolve" tests` empty.
- [x] Playwright suite green locally (`pnpm test:browser`), documented in `docs/topic--setup-and-workflow.md`.
- [x] `pnpm lint` with `no-explicit-any: error` green; livestruct-demo and msgmesh-store compile against strict `PatchPayload`.

## Plan

## 9. livestruct: `debt--test-coverage-and-naming` (low, blocked by #3 and #5)

Problem: tests rely on fixed sleeps, nothing exercises the real browser stack (OPFS, workers, multiple
contexts), legacy names remain, and `any`/loose `PatchPayload` weaken type safety.

Requirements
- REQ-1: No test MAY use a fixed `setTimeout` sleep; use fake timers or awaited observables.
- REQ-2: A browser integration test (Playwright, Chrome) MUST cover: persisted adapter boot, two-context replication, overlay live values, reload persistence.
- REQ-3: Deprecated aliases (`LiveSqliteEngine`) MUST keep compiling and be marked `@deprecated`.
- REQ-4: No `any` in `src/` (eslint `no-explicit-any` as error); `PatchPayload<T>` recursive and strict with `patchUnchecked()` escape hatch.

Steps
1. REQ-1: replace every `await new Promise(resolve => setTimeout(resolve, N))` in `tests/collection.test.ts` and `tests/document.test.ts` with `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(commitDelayMs)` or `await doc.flush()` / `await firstValueFrom(obs$.pipe(filter(...)))`; add `tests/helpers.ts` with `nextEmission(obs$, predicate, timeoutMs)` that fails loudly instead of hanging.
2. REQ-2: add `@playwright/test` (pnpm catalog, devDependency), `playwright.config.ts` (Chromium only, `webServer` = livestruct-demo `vite build && vite preview` on port 4173), `tests/browser/*.spec.ts`:
   - `boot.spec.ts`: `store.storageMode === 'persisted'`, no console errors.
   - `replication.spec.ts`: host + 2 iframes, write in A visible in B and host within 500 ms.
   - `overlay.spec.ts`: 60 patches in A without flush -> B shows `isTentative` value; after flush -> committed, `isTentative` false.
   - `reload.spec.ts`: write, flush, reload page -> value restored in all three contexts.
   Script `test:browser` in package.json; excluded from the default `pnpm test` (Vitest node).
3. REQ-3: `LiveSqliteEngine` alias and any other renamed exports kept in `src/index.ts` with `/** @deprecated use LiveDocEngine */`; a type test `tests/types/deprecated.test-d.ts` (vitest `expectTypeOf`) proves they still compile.
4. REQ-4 types: `src/document/types.ts` `PatchPayload<T>` = recursive `{ [K in keyof T]?: T[K] extends object ? PatchPayload<T[K]> | null : T[K] | null }` (arrays replaced whole); `doc.patchUnchecked(patch: Record<string, unknown>)` escape hatch; `src/lens/pathTypes.ts` reuses it.
5. REQ-4 lint: `.eslintrc`/`eslint.config.*` `@typescript-eslint/no-explicit-any: error` for `src/`; fix every hit with `unknown` + narrowing.
6. Compile downstream: `pnpm --filter @actdim/livestruct-demo typecheck` and `pnpm --filter @actdim/msgmesh-store exec tsc -b`; fix call sites in those packages only by using `patchUnchecked` or correct types (list each change in the session log).
7. Docs: `docs/topic--setup-and-workflow.md` section "Browser tests" (install `pnpm exec playwright install chromium`, run `pnpm test:browser`).

Acceptance
- [x] `grep -rn "setTimeout(resolve" tests` empty.
- [x] Playwright suite green locally (`pnpm test:browser`), documented in `docs/topic--setup-and-workflow.md`.
- [x] `pnpm lint` with `no-explicit-any: error` green; livestruct-demo and msgmesh-store compile against strict `PatchPayload`.

## Ticket map and launch order

| Order | Package | Key | Prio | Blocked by |
|---|---|---|---|---|
| 1 | livestruct | `spike--livestore-integration` (new) | high | - |
| 2 | livestruct | `feat--livestore-engine` (renamed from `feat--worker-engine-lazy-sync`) | high | spike |
| 3 | livestruct | `feat--transparent-lazy-commit` (new) | high | livestore-engine |
| 4 | livestruct-demo | `bug--dnd-freeze-dual-iframe` | high | livestruct #2, #3 |
| 5 | livestruct | `bug--engine-correctness-batch` (rewritten: API-layer bugs only) | medium | transparent-lazy-commit |
| 6 | msgmesh-store | `bug--bridge-sync-correctness` | high | livestruct #2, #3 |
| 7 | msgmesh-store | `bug--worker-transport-lifecycle` | medium | #6 |
| 8 | msgmesh-store | `debt--perf-tests-and-types` | low | #6 |
| 9 | livestruct | `debt--test-coverage-and-naming` (rewritten) | low | #3, #5 |
| - | livestruct | `bug--cross-context-last-writer-wins` -> **superseded** by `feat--livestore-engine` (LiveStore leader worker is the single writer) | - | - |

Rules for every ticket:
- Start with `along start <slug>`, plan approval is already given by this plan; do not widen scope.
- Each acceptance item needs evidence in the ticket's session log: test name, command output, or measured numbers.
- A ticket is not done while any acceptance item is unchecked. No "partially done" wraps.
- Never weaken an existing test to make it pass; changed assertions must be listed with the reason.
- No `any`, no `@ts-ignore`, no `as unknown as` added in new code.
