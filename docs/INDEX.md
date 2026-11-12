---
protocol: along
slug: INDEX
title: '@actdim/livestruct - Knowledge Base Topic Index'
type: index
created: 2026-10-30
updated: 2026-11-12
tags: [index, kb, topics, map]
---

# @actdim/livestruct - Knowledge Base Topic Index

Central entry point and cross-linked topic catalog for project documentation:

## Knowledge Graph & Topic Map

```mermaid
flowchart TD
    INDEX["Knowledge Base (INDEX)"]
    T_01_OVERVIEW_AND_ADVANTAGES["Overview & Key Advantages"]
    INDEX --> T_01_OVERVIEW_AND_ADVANTAGES
    T_02_CORE_CONCEPTS["Core Concepts"]
    INDEX --> T_02_CORE_CONCEPTS
    T_03_ARCHITECTURE_AND_WIRING["Architecture & Wiring"]
    INDEX --> T_03_ARCHITECTURE_AND_WIRING
    T_04_INTEGRATION_GUIDE["Integration Guide"]
    INDEX --> T_04_INTEGRATION_GUIDE
    T_05_API_REFERENCE["API Reference"]
    INDEX --> T_05_API_REFERENCE
    T_ARCHITECTURE["LiveStruct Architecture & Engine Design"]
    INDEX --> T_ARCHITECTURE
    T_DEMO_ARCHITECTURE["Demo: System Architecture & Flow"]
    INDEX --> T_DEMO_ARCHITECTURE
    T_DEMO_DOMAIN_MODEL["Demo: Domain Model & Entity Ecosystem"]
    INDEX --> T_DEMO_DOMAIN_MODEL
    T_DEMO_SETUP_AND_WORKFLOW["Demo: Setup, Build & Workflow"]
    INDEX --> T_DEMO_SETUP_AND_WORKFLOW
    T_DEPENDENCIES["Dependencies & AI Documentation for @actdim/livestruct"]
    INDEX --> T_DEPENDENCIES
    T_DOMAIN_MODEL["Domain Model & Entity Ecosystem"]
    INDEX --> T_DOMAIN_MODEL
    T_LICENSE["License"]
    INDEX --> T_LICENSE
    T_LIVESTORE_INTEGRATION["LiveStore 0.5.0 Integration & Architectural Spike"]
    INDEX --> T_LIVESTORE_INTEGRATION
    T_SETUP_AND_WORKFLOW["Setup, Installation & Agent Workflows"]
    INDEX --> T_SETUP_AND_WORKFLOW
    T_01_OVERVIEW_AND_ADVANTAGES -.->|references| T_02_CORE_CONCEPTS
    T_01_OVERVIEW_AND_ADVANTAGES -.->|references| T_LIVESTORE_INTEGRATION
    T_01_OVERVIEW_AND_ADVANTAGES -.->|references| T_04_INTEGRATION_GUIDE
    T_01_OVERVIEW_AND_ADVANTAGES -.->|references| T_05_API_REFERENCE
    T_02_CORE_CONCEPTS -.->|references| T_01_OVERVIEW_AND_ADVANTAGES
    T_02_CORE_CONCEPTS -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_02_CORE_CONCEPTS
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_04_INTEGRATION_GUIDE
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_ARCHITECTURE
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_LIVESTORE_INTEGRATION
    T_04_INTEGRATION_GUIDE -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_04_INTEGRATION_GUIDE -.->|references| T_05_API_REFERENCE
    T_04_INTEGRATION_GUIDE -.->|references| T_LIVESTORE_INTEGRATION
    T_05_API_REFERENCE -.->|references| T_04_INTEGRATION_GUIDE
    T_ARCHITECTURE -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_ARCHITECTURE -.->|references| T_DOMAIN_MODEL
    T_ARCHITECTURE -.->|references| T_LIVESTORE_INTEGRATION
    T_ARCHITECTURE -.->|references| T_05_API_REFERENCE
    T_DEMO_ARCHITECTURE -.->|references| T_DEMO_DOMAIN_MODEL
    T_DEMO_ARCHITECTURE -.->|references| T_DEMO_SETUP_AND_WORKFLOW
    T_DEMO_DOMAIN_MODEL -.->|references| T_DEMO_ARCHITECTURE
    T_DEMO_DOMAIN_MODEL -.->|references| T_DEMO_SETUP_AND_WORKFLOW
    T_DEMO_SETUP_AND_WORKFLOW -.->|references| T_DEMO_ARCHITECTURE
    T_DEMO_SETUP_AND_WORKFLOW -.->|references| T_DEMO_DOMAIN_MODEL
    T_DOMAIN_MODEL -.->|references| T_02_CORE_CONCEPTS
    T_DOMAIN_MODEL -.->|references| T_05_API_REFERENCE
    T_LIVESTORE_INTEGRATION -.->|references| T_ARCHITECTURE
    T_LIVESTORE_INTEGRATION -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_SETUP_AND_WORKFLOW -.->|references| T_04_INTEGRATION_GUIDE
```

---

## Articles

- **[Overview & Key Advantages](./topic--01-overview-and-advantages.md)** (topic) `01-overview-and-advantages`, `overview`, `livestore`, `local-first`
- **[Core Concepts](./topic--02-core-concepts.md)** (topic) `02-core-concepts`, `document`, `collection`, `lens`, `cdc`, `overlays`
- **[Architecture & Wiring](./topic--03-architecture-and-wiring.md)** (topic) `03-architecture-and-wiring`, `topology`, `worker`, `shared-worker`, `data-flow`
- **[Integration Guide](./topic--04-integration-guide.md)** (topic) `04-integration-guide`, `setup`, `vite`, `worker`, `react`, `mobx`, `msgmesh`, `vitest`
- **[API Reference](./topic--05-api-reference.md)** (topic) `05-api-reference`, `api`, `contracts`, `exports`
- **[LiveStruct Architecture & Engine Design](./topic--architecture.md)** (architecture) `architecture`, `livestore`, `opfs`, `worker`, `schema`, `blobs`
- **[Demo: System Architecture & Flow](./topic--demo-architecture.md)** (topic) `architecture`, `livestruct`, `msgmesh`, `opfs`, `worker`, `shared-worker`, `multi-tab`, `undo-redo`
- **[Demo: Domain Model & Entity Ecosystem](./topic--demo-domain-model.md)** (topic) `domain-model`, `cad`, `shapes`, `livestore`, `schema`, `msgmesh`, `telemetry`
- **[Demo: Setup, Build & Workflow](./topic--demo-setup-and-workflow.md)** (topic) `setup`, `workflow`, `vite`, `vitest`, `opfs`, `github-pages`, `ci`, `monorepo`
- **[Dependencies & AI Documentation for @actdim/livestruct](./topic--dependencies.md)** (topic) `dependencies`, `subproject`, `ai-context`, `rules`
- **[Domain Model & Entity Ecosystem](./topic--domain-model.md)** (domain-model) `domain-model`, `entities`, `schemas`, `document`, `collection`, `cdc`, `events`
- **[License](./topic--license.md)** (license) `license`, `mit`
- **[LiveStore 0.5.0 Integration & Architectural Spike](./topic--livestore-integration.md)** (topic) `livestore-integration`
- **[Setup, Installation & Agent Workflows](./topic--setup-and-workflow.md)** (setup-workflow) `setup`, `workflow`, `installation`, `lifecycle`, `quality-gates`, `playwright`, `testing`

---

## Related Context

- [AGENTS.md](../AGENTS.md): Active protocol conventions and rules.
- [Decisions (ADRs)](./decisions/INDEX.md): Architectural Decision Records.
- [Domain Model & Entity Ecosystem](./topic--domain-model.md): Specifications for active issues and project history.
