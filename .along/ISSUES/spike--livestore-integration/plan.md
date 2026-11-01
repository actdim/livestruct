# Approved Plan: spike--livestore-integration

1. Branch spike/livestore-integration in the livestruct submodule; add deps to the pnpm catalog.
2. spikes/livestore/schema.ts: universal docs table + events.
3. Node tests for Q2, Q3, Q7 under spikes/livestore/*.test.ts.
4. Browser harness page in livestruct-demo (?spike=livestore) for Q4-Q6, Q8, Q9; measure with performance.now() and PerformanceObserver({ type: 'longtask' }).
5. Write results to docs/topic--livestore-integration.md and an ADR via along decision create and sync.
