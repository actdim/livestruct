# Execution Plan: bug--engine-correctness-batch

## Overview
Implement and verify 7 API-layer correctness requirements for @actdim/livestruct:
- REQ-1: LiveCollection instance identity deduplication and subscription cleanup.
- REQ-2: Zero unhandled rejections across the suite.
- REQ-3: patchPath SET semantics and array stability.
- REQ-4: Full replace (replace(value) / updateDoc) rebase without merging into pending overlay.
- REQ-5: Deep-frozen snapshots (doc.data, getDoc, queryDocs), non-aliasing CDC delta, and lens writes through doc.patchPath().
- REQ-6: mobx moved from peerDependenciesMeta.optional to required peer dependency in package.json.
- REQ-7: Date / TypedArray / Non-JSON validation throwing LiveStructValueError.

## Steps
1. Re-verify: write failing tests in tests/engineCorrectness.test.ts.
2. REQ-1: LiveCollection in-flight loads Map and subscription tracking.
3. REQ-2: reportAsync helper routing to errors$.
4. REQ-3: setAtPath and DocPathSet SQLite json_set paths.
5. REQ-4: doc.replace(value) rebasing pending patches.
6. REQ-5: deepFreeze helper on doc.data and queryDocs, cloned CDC deltas, createDocLens via patchPath.
7. REQ-6: mobx peer dependency in package.json.
8. REQ-7: assertJsonSafe throwing LiveStructValueError.
9. Verify all 12 test files pass, typecheck, build, and update CHANGELOG.md.
