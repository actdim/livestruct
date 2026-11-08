---
protocol: along
protocol_version: "4.6.1"
slug: dependencies
title: Dependencies & AI Documentation for @actdim/livestruct
type: topic
created: 2026-11-06
updated: 2026-11-06
tags: [dependencies, subproject, ai-context, rules]
---

# Dependencies & AI Documentation for `@actdim/livestruct`

> [!NOTE]
> This document maintains a localized registry of internal workspace dependencies and third-party libraries for `@actdim/livestruct`.
> Consult linked guidelines when developing, refactoring, or integrating components.

## Internal Workspace Dependencies

| Internal Package | Relative Path | AI Documentation & Context |
| :--- | :--- | :--- |
| **`@actdim/msgmesh`** | [`../../../../scratch/07-ci/ci-clone/src/packages/msgmesh`](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh) | [AGENTS.md](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/AGENTS.md) <br> [CLAUDE.md](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/CLAUDE.md) <br> [llms-full.txt](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/llms-full.txt) <br> [llms.txt](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/llms.txt) <br> [.along/](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/.along) <br> [docs/](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/docs) |
| **`@actdim/utico`** | [`../../../../scratch/07-ci/ci-clone/src/packages/utico`](../../../../scratch/07-ci/ci-clone/src/packages/utico) | [AGENTS.md](../../../../scratch/07-ci/ci-clone/src/packages/utico/AGENTS.md) <br> [CLAUDE.md](../../../../scratch/07-ci/ci-clone/src/packages/utico/CLAUDE.md) <br> [llms-full.txt](../../../../scratch/07-ci/ci-clone/src/packages/utico/llms-full.txt) <br> [llms.txt](../../../../scratch/07-ci/ci-clone/src/packages/utico/llms.txt) <br> [.along/](../../../../scratch/07-ci/ci-clone/src/packages/utico/.along) <br> [docs/](../../../../scratch/07-ci/ci-clone/src/packages/utico/docs) |

## Declared External Dependencies with AI Guidelines

| Package | Ecosystem | Version | AI Guidelines / Instructions |
| :--- | :--- | :--- | :--- |
| **`effect`** | `npm` | `4.0.3` | [AGENTS.md](../../../node_modules/.pnpm/effect@4.0.3/node_modules/effect/AGENTS.md) <br> [CLAUDE.md](../../../node_modules/.pnpm/effect@4.0.3/node_modules/effect/CLAUDE.md) |

## Transitive Dependency Guidelines & Invariants

No exported invariants detected across current dependencies.

## Usage in Agent Sessions
When working on features involving any of the modules or external libraries above:
1. **Internal Submodules**: Follow conventions in the linked package `AGENTS.md` or package `docs/`.
2. **Third-Party Libraries**: Read the linked instruction files directly for framework-specific patterns and best practices.
