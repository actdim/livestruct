---
protocol: along
protocol_version: "4.5.4"
date: 2026-11-01
slug: engine-correctness-batch
agent: antigravity
branch: main
commit: 7d41e92
summary: 'API-layer correctness batch: instance races, unhandled rejections, patchPath, replace, cloning'
issues_advanced: []
issues_completed: [bug--engine-correctness-batch]
decisions: []
---

# Session: Engine correctness batch

## Summary
API-layer correctness batch: instance races, unhandled rejections, patchPath, replace, cloning

## Decisions
- None (confirmed at wrap: no architectural decisions).

## Blackboard Record

Execution mode: direct; plan revision 1; approved: true.

Plan: kept with the issue (`plan/plan.md`, 1 revision(s)).

### Execution Trace

#### Execution Trace: engine-correctness-batch
- 2026-11-01T03:04:04Z plan approved (along start --approved; approved_via: cli-unverified)
- 2026-11-01T03:08:45Z step 1 re-verify against pre-fix code:
  - REQ-1: Reproduces (concurrent collection.get returns distinct instances; subscriptionCount missing).
  - REQ-2: Reproduces (void refreshQuery unhandled; observable setter needs reportAsync routing).
  - REQ-3: Reproduces (patchPath deep-merges { city: 'Paris', street: 'Baker St' } instead of replacing with { city: 'Paris' }).
  - REQ-4: Reproduces (doc.replace does not exist; replace does not rebase pending overlays).
  - REQ-5: Reproduces (doc.data nested objects are not frozen; CDC delta aliases caller patch object; createDocLens missing).
  - REQ-6: Reproduces (package.json has mobx in peerDependenciesMeta.optional).
  - REQ-7: Reproduces (Date / TypedArray / Map / Set / Function silently accepted; LiveStructValueError missing).
- 2026-11-01T03:20:49Z test pass (Pre-Commit Quality Gate)
