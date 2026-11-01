---
protocol: along
slug: INDEX
title: '@actdim/livestruct - Knowledge Base Topic Index'
type: index
created: 2026-10-30
updated: 2026-11-01
tags: [index, kb, topics, map]
---

# @actdim/livestruct - Knowledge Base Topic Index

Central entry point and cross-linked topic catalog for project documentation:

## Knowledge Graph & Topic Map

```mermaid
flowchart TD
    INDEX["Knowledge Base (INDEX)"]
    T_ALONG_PROTOCOL["Along Protocol Reference"]
    INDEX --> T_ALONG_PROTOCOL
    T_ARCHITECTURE["LiveStruct Architecture & Engine Design"]
    INDEX --> T_ARCHITECTURE
    T_DOMAIN_MODEL["Domain Model & Entity Ecosystem"]
    INDEX --> T_DOMAIN_MODEL
    T_LIVESTORE_INTEGRATION["LiveStore 0.5.0 Integration & Architectural Spike"]
    INDEX --> T_LIVESTORE_INTEGRATION
    T_SETUP_AND_WORKFLOW["Setup, Installation & Agent Workflows"]
    INDEX --> T_SETUP_AND_WORKFLOW
```

---

## Articles

- **[Along Protocol Reference](./topic--along-protocol.md)** (reference) `protocol`, `agents-md`, `checklist`, `routing`, `concurrency`, `along-team`, `conventions`
- **[LiveStruct Architecture & Engine Design](./topic--architecture.md)** (architecture) `architecture`, `livestore`, `opfs`, `worker`, `schema`, `blobs`
- **[Domain Model & Entity Ecosystem](./topic--domain-model.md)** (domain-model) `domain-model`, `entities`, `schemas`, `dag`, `metadata`
- **[LiveStore 0.5.0 Integration & Architectural Spike](./topic--livestore-integration.md)** (topic) `livestore-integration`
- **[Setup, Installation & Agent Workflows](./topic--setup-and-workflow.md)** (setup-workflow) `setup`, `workflow`, `installation`, `lifecycle`, `quality-gates`

---

## Related Context

- [AGENTS.md](../AGENTS.md): Active protocol conventions and rules.
- [Decisions (ADRs)](./decisions/INDEX.md): Architectural Decision Records.
- [Domain Model & Entity Ecosystem](./topic--domain-model.md): Specifications for active issues and project history.
