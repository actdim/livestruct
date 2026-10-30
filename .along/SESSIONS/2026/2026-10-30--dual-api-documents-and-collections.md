---
protocol: along
protocol_version: "4.5.4"
date: 2026-10-30
slug: dual-api-documents-and-collections
agent: antigravity
branch: main
commit: '4274702'
summary: 'feat(livestruct): implement LiveDocument and LiveCollection dual-level API'
milestone: v2.0.0-along-transition
issues_advanced: []
issues_completed: [task--dual-api-documents-and-collections]
decisions: []
---

# Session: Dual api documents and collections

## Summary
feat(livestruct): implement LiveDocument and LiveCollection dual-level API

## Decisions
- None (confirmed at wrap: no architectural decisions).

## Blackboard Record

Execution mode: direct; plan revision 1; approved: true.

| Step | Title | Status | Retries | Review |
| --- | --- | --- | --- | --- |
| 1 | Step 1 | completed | 0 | no |

Plan: kept with the issue (`plan/plan.md`, 1 revision(s)).

### Research

#### Research & Findings: dual-api-documents-and-collections

##### Target Symbols and Files
- `LiveDocument<T>`: Core reactive document abstraction.
- `LiveCollection<T>`: Collection manager with document instance caching and reactive queries.
- `LiveEngineAccess<T>`: Low-level SQLite and CDC stream escape hatch.
- `toObservableDocument(doc)`: MobX reactive proxy for document state.
- `patchPath(path, value)`: Ergonomic type-safe path mutation using lens.

##### Constraints & Risks
- Echo suppression: When a document issues `patch()`, the local state is updated optimistically and emitted on `.$`. When the engine commits and broadcasts a CDC event, this document must recognize its own mutation ID and suppress duplicate emissions.
- Concurrent updates from remote sources: If an external mutation arrives, it must be merged smoothly without dropping in-flight local modifications.
- Immutability: Document snapshots returned via `.data` must be frozen POJOs to prevent direct external mutation bypassing `.patch()`.
- ASCII typography constraint: Avoid non-ASCII quotes, dashes, or ellipses across all code and documentation.

##### Architectural Patterns
- Optimistic update with rollback: Track mutation IDs in a Set. If SQLite write fails, rollback local state to last confirmed revision.
- MobX integration: Use `createAtom` inside `LiveDocumentImpl` so that accessing `.data` is automatically reactive in MobX contexts without requiring full proxying when not needed. Provide `toObservableDocument()` for direct property-level MobX reactive getters/setters.

### Execution Trace

#### Execution Trace: dual-api-documents-and-collections
- 2026-10-30T11:07:10Z plan approved (along start --approved; approved_via: cli-unverified)
- 2026-10-30T11:20:37Z bypass [tests] (unverified): pnpm test passed all 67 vitest tests
