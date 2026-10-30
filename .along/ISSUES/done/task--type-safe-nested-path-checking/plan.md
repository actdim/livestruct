# Living Plan: Type-Safe Nested Property Path Checking with Recursion Limits

Status: Approved
Date: 2026-10-30
Milestone: v2.0.0-along-transition
Issue: task--type-safe-nested-path-checking
Execution Mode: Direct

## 1. Objectives & Requirements
- REQ-1: The type helper MUST validate dot-separated paths against document schemas at compile-time.
- REQ-2: The type helper MUST limit recursion depth (max 4-5 levels) to prevent TypeScript compiler stalls.
- REQ-3: Runtime path lens MUST safely resolve nested values without throwing on undefined segments.

## 2. Architecture & File Layout
- `src/lens/pathTypes.ts`:
  - `NestedPath<T, Depth>`: Generates union of valid string dot paths (e.g. "layer", "layer.features", "layer.features.0", "layer.features.0.color"). Strict depth guard tuple preventing compiler recursion freezes.
  - Leaf types guard: `Primitive`, `Function`, `Date`, `RegExp`, `Uint8Array`, `Float32Array`, `Blob`, `Map`, `Set` treated as leaf nodes (no recursion).
  - `PathValue<T, P>`: Resolves exact property type at path `P` traversing segment-by-segment.
- `src/lens/lens.ts`:
  - `getNestedPath<T, P extends NestedPath<T>>(obj: T, path: P): PathValue<T, P> | undefined`: Safely walks path segments without throwing on null/undefined.
  - `hasNestedPath<T>(obj: T, path: string): boolean`: Checks if property path exists.
  - `setNestedPath<T, P extends NestedPath<T>>(obj: T, path: P, value: PathValue<T, P>): T`: Immutably clones and updates object at path, creating intermediate objects/arrays when necessary.
  - `deleteNestedPath<T, P extends NestedPath<T>>(obj: T, path: P): T`: Immutably clones and deletes property at path.
- `src/lens/index.ts`: Unified lens module exports.
- `src/lens.ts`: Lens submodule export alias.
- `src/index.ts`: Re-exports lens module from package entry.
- `tests/lens.test.ts`: Vitest test suite with compile-time type assertions and runtime traversal/mutation tests.

## 3. Step-by-Step Implementation Steps
1. Create `src/lens/pathTypes.ts` with depth-guarded `NestedPath` and `PathValue`.
2. Create `src/lens/lens.ts` implementing `getNestedPath`, `hasNestedPath`, `setNestedPath`, `deleteNestedPath`.
3. Create `src/lens/index.ts` and `src/lens.ts` exporting lens functionality.
4. Export lens utilities in `src/index.ts`.
5. Implement unit tests in `tests/lens.test.ts` covering compile-time type guards, runtime traversal, immutability, arrays, and edge cases.
6. Verify with `pnpm --filter @actdim/livestruct test`, `typecheck`, and `build`.
7. Verify clean ASCII typography and wrap issue with `along wrap`.
8. Commit and push in submodule and root repository.
