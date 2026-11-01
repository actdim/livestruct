/**
 * @actdim/livestruct - Transparent Lazy Commits and Real-Time Overlays Test Suite
 * Validates REQ-1 through REQ-8: instant local mutations, debounced coalesced commits,
 * bounded wait windows, flush lifecycles, remote rebasing, BroadcastChannel tentative overlays,
 * and deferred commit error rollbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autorun } from 'mobx';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { createLiveStruct, type LiveStoreInstance } from '../src/index';

function calculatePercentiles(latenciesMs: number[]) {
    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const n = sorted.length;
    const median = sorted[Math.floor(n * 0.5)];
    const p95 = sorted[Math.floor(n * 0.95)];
    const p99 = sorted[Math.floor(n * 0.99)];
    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
    return { median, p95, p99, min, max, mean };
}

describe('Transparent Lazy Commits and Real-Time Live Overlays', () => {
    let store: LiveStoreInstance;
    let storeId: string;

    beforeEach(async () => {
        storeId = `test_lazy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        store = await createLiveStruct({
            name: storeId,
            forceMemory: true,
            commitDelayMs: 100,
            maxCommitWaitMs: 500,
            overlayTtlMs: 300,
        });
    });

    afterEach(async () => {
        await store.close();
    });

    describe('REQ-1: Instant Local Mutation & No Synchronous store.commit', () => {
        it('updates doc.data, emits on doc.$ and MobX atom, and emits local CDC immediately without store.commit in call stack', async () => {
            const col = await store.collection<{ x: number; y: number; title: string }>('canvas');
            const doc = await col.create('shape-1', { x: 0, y: 0, title: 'Box' });

            let inPatchCallStack = false;
            const origCommit = store.engine.store.commit;
            let commitCallCount = 0;

            const commitSpy = vi.spyOn(store.engine.store, 'commit').mockImplementation((...args: any[]) => {
                commitCallCount++;
                if (inPatchCallStack) {
                    throw new Error('store.commit MUST NOT be called synchronously inside doc.patch() call stack!');
                }
                return origCommit.apply(store.engine.store, args);
            });

            // Track MobX autorun reactivity
            const mobxValues: number[] = [];
            const disposer = autorun(() => {
                mobxValues.push(doc.data.x);
            });
            expect(mobxValues).toEqual([0]);

            // Track doc.$ observable emissions
            const observableValues: number[] = [];
            const sub = doc.$.subscribe((val) => {
                observableValues.push(val.x);
            });
            expect(observableValues).toEqual([0]);

            // Track local CDC stream emission
            const cdcPromise = firstValueFrom(
                doc.engine.cdc$.pipe(filter((e) => e.id === 'shape-1' && e.type === 'update'))
            );

            // Execute patch under call stack guard
            inPatchCallStack = true;
            const patchPromise = doc.patch({ x: 42 });
            inPatchCallStack = false;

            // Synchronous verification: snapshot, MobX, and $ updated immediately
            expect(doc.data.x).toBe(42);
            expect(doc.isPending).toBe(true);
            expect(mobxValues).toEqual([0, 42]);
            expect(observableValues).toEqual([0, 42]);
            expect(commitCallCount).toBe(0); // 0 store.commit calls synchronously

            // Local CDC emitted before promise resolves
            const cdcEvent = await cdcPromise;
            expect(cdcEvent.id).toBe('shape-1');
            expect(cdcEvent.delta).toEqual({ x: 42 });

            // Awaiting patchPromise resolves after background commit window
            await patchPromise;
            expect(commitCallCount).toBe(1);
            expect(doc.isPending).toBe(false);

            disposer();
            sub.unsubscribe();
            commitSpy.mockRestore();
        });

        it('supports type-safe patchPath mutations with instant local feedback', async () => {
            const col = await store.collection<{ config: { theme: string; size: number } }>('settings');
            const doc = await col.create('s-1', { config: { theme: 'light', size: 12 } });

            await doc.patchPath('config.theme', 'dark');
            expect(doc.data.config.theme).toBe('dark');
            expect(doc.data.config.size).toBe(12);

            await doc.flush();
            const fetched = await col.get('s-1');
            expect(fetched?.data.config.theme).toBe('dark');
        });
    });

    describe('REQ-2: Coalesced Commits & Bounded Max Wait Window', () => {
        it('coalesces 1000 patch calls in one tick into exactly 1 background commit', async () => {
            const col = await store.collection<{ counter: number }>('counters');
            const doc = await col.create('c-1', { counter: 0 });

            let commitCalls = 0;
            const origCommit = store.engine.store.commit;
            const commitSpy = vi.spyOn(store.engine.store, 'commit').mockImplementation((...args: any[]) => {
                commitCalls++;
                return origCommit.apply(store.engine.store, args);
            });

            const promises: Promise<void>[] = [];
            for (let i = 1; i <= 1000; i++) {
                promises.push(doc.patch({ counter: i }));
                expect(doc.data.counter).toBe(i); // synchronous snapshot
            }

            expect(commitCalls).toBe(0); // 0 commits synchronously

            // Wait for all 1000 promises to resolve together
            await Promise.all(promises);

            expect(commitCalls).toBe(1); // exactly 1 commit to SQLite
            expect(doc.data.counter).toBe(1000);
            expect(doc.isPending).toBe(false);

            commitSpy.mockRestore();
        });

        it('bounds commits during continuous dragging to <= 4 commits for 3 seconds of continuous updates', async () => {
            // Configure store with commitDelayMs: 150, maxCommitWaitMs: 1000
            const dragStore = await createLiveStruct({
                name: `drag_test_${Date.now()}`,
                forceMemory: true,
                commitDelayMs: 150,
                maxCommitWaitMs: 1000,
            });

            const col = await dragStore.collection<{ x: number }>('drag');
            const doc = await col.create('drag-doc', { x: 0 });

            let commitCount = 0;
            const origCommit = dragStore.engine.store.commit;
            const commitSpy = vi.spyOn(dragStore.engine.store, 'commit').mockImplementation((...args: any[]) => {
                commitCount++;
                return origCommit.apply(dragStore.engine.store, args);
            });

            // Simulate continuous dragging for 3000ms:
            // An update every 15ms (~66Hz), keeping trailing debounce continuously reset.
            // maxCommitWaitMs (1000ms) will force commits at ~1000ms, ~2000ms, ~3000ms, + trailing.
            const startTime = Date.now();
            let step = 0;
            while (Date.now() - startTime < 3000) {
                step++;
                void doc.patch({ x: step });
                await new Promise((resolve) => setTimeout(resolve, 15));
            }

            // Flush remaining trailing debounce
            await doc.flush();

            // Total commits for 3s continuous dragging MUST be <= 4
            expect(commitCount).toBeLessThanOrEqual(4);
            expect(commitCount).toBeGreaterThanOrEqual(2);
            expect(doc.data.x).toBe(step);

            commitSpy.mockRestore();
            await dragStore.close();
        });
    });

    describe('REQ-3 & REQ-4: Flush Semantics & Promise Resolution', () => {
        it('resolves patch Promises only when SQLite commit is complete', async () => {
            const col = await store.collection<{ status: string }>('jobs');
            const doc = await col.create('j-1', { status: 'idle' });

            let committedOnEngine = false;
            const origCommit = store.engine.store.commit;
            const commitSpy = vi.spyOn(store.engine.store, 'commit').mockImplementation((...args: any[]) => {
                committedOnEngine = true;
                return origCommit.apply(store.engine.store, args);
            });

            const patchPromise = doc.patch({ status: 'running' });
            expect(committedOnEngine).toBe(false);

            await patchPromise;
            expect(committedOnEngine).toBe(true);

            commitSpy.mockRestore();
        });

        it('flushes pending patches synchronously and resolves on doc.flush(), collection.flush(), store.flush()', async () => {
            const col = await store.collection<{ val: number }>('items');
            const docA = await col.create('a', { val: 1 });
            const docB = await col.create('b', { val: 2 });

            void docA.patch({ val: 10 });
            void docB.patch({ val: 20 });

            expect(docA.isPending).toBe(true);
            expect(docB.isPending).toBe(true);

            await store.flush();

            expect(docA.isPending).toBe(false);
            expect(docB.isPending).toBe(false);
            expect(docA.data.val).toBe(10);
            expect(docB.data.val).toBe(20);
        });

        it('flushes all pending patches before store.close() shuts down', async () => {
            const tempStore = await createLiveStruct({
                name: `close_flush_${Date.now()}`,
                forceMemory: true,
                commitDelayMs: 5000,
            });

            const col = await tempStore.collection<{ active: boolean }>('flags');
            const doc = await col.create('f-1', { active: false });

            let committed = false;
            const origCommit = tempStore.engine.store.commit;
            const commitSpy = vi.spyOn(tempStore.engine.store, 'commit').mockImplementation((...args: any[]) => {
                committed = true;
                return origCommit.apply(tempStore.engine.store, args);
            });

            const patchPromise = doc.patch({ active: true });
            expect(doc.isPending).toBe(true);
            expect(committed).toBe(false);

            // store.close() MUST flush all pending patches before shutting down
            await tempStore.close();

            expect(committed).toBe(true);
            expect(doc.isPending).toBe(false);
            await patchPromise;

            commitSpy.mockRestore();
        });
    });

    describe('REQ-5: Remote CDC Rebase & Notification Suppression', () => {
        it('rebases remote committed base under local pending patches', async () => {
            const col = await store.collection<{ a: number; b: number; c?: number }>('records');
            const doc = await col.create('rec-1', { a: 1, b: 1 });

            // Apply local pending patch: { a: 10 }
            void doc.patch({ a: 10 });
            expect(doc.data).toEqual({ a: 10, b: 1 });

            // Simulate remote committed change arriving from another tab: { b: 99, c: 500 }
            await doc.engine.commitRaw({
                type: 'patch',
                collection: 'records',
                id: 'rec-1',
                data: { b: 99, c: 500 },
            });

            // Wait a tick for CDC propagation
            await new Promise((resolve) => setTimeout(resolve, 25));

            // View rebase: remote base { a: 1, b: 99, c: 500 } + local pending { a: 10 }
            // Result: { a: 10, b: 99, c: 500 }
            expect(doc.data).toEqual({ a: 10, b: 99, c: 500 });
            expect(doc.isPending).toBe(true);

            // Flush local pending patches
            await doc.flush();
            expect(doc.data).toEqual({ a: 10, b: 99, c: 500 });
            expect(doc.isPending).toBe(false);
        });

        it('suppresses subscriber notifications when remote change does not alter computed view (structural equality)', async () => {
            const col = await store.collection<{ a: number; b: number }>('records');
            const doc = await col.create('rec-2', { a: 1, b: 2 });

            // Local pending patch overrides 'a' to 10
            void doc.patch({ a: 10 });

            const emissions: any[] = [];
            const sub = doc.$.subscribe((val) => {
                emissions.push({ ...val });
            });
            expect(emissions.length).toBe(1); // initial subscription emission: { a: 10, b: 2 }

            // Remote commit changes 'a' to 5 in the base, but local pending { a: 10 } overrides it
            // Computed view remains { a: 10, b: 2 }
            await doc.engine.commitRaw({
                type: 'patch',
                collection: 'records',
                id: 'rec-2',
                data: { a: 5 },
            });

            await new Promise((resolve) => setTimeout(resolve, 25));

            // Structural equality check prevented redundant notification!
            expect(emissions.length).toBe(1);
            expect(doc.data.a).toBe(10);

            sub.unsubscribe();
        });
    });

    describe('REQ-6 & REQ-7: OverlayChannel Real-Time Tentative Values', () => {
        it('transmits tentative overlay to another store instance sharing the same storeId via BroadcastChannel', async () => {
            const sharedStoreId = `overlay_sync_${Date.now()}`;

            const storeA = await createLiveStruct({
                name: sharedStoreId,
                forceMemory: true,
                commitDelayMs: 500, // delay commit to observe tentative overlay
            });

            const storeB = await createLiveStruct({
                name: sharedStoreId,
                forceMemory: true,
                commitDelayMs: 500,
            });

            const colA = await storeA.collection<{ x: number; y: number }>('shapes');
            const colB = await storeB.collection<{ x: number; y: number }>('shapes');

            // Open document on both viewports
            const docA = await colA.create('rect-1', { x: 10, y: 10 });
            const docB = await colB.create('rect-1', { x: 10, y: 10 });

            expect(docB.data.x).toBe(10);
            expect(docB.isTentative).toBe(false);

            // Mutate docA with lazy patch without flushing
            void docA.patch({ x: 200, y: 300 });

            // Wait a tick for animation frame / BroadcastChannel message delivery
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Viewport B sees tentative overlay in real time before commit
            expect(docB.data.x).toBe(200);
            expect(docB.data.y).toBe(300);
            expect(docB.isTentative).toBe(true);

            // Commit docA and drop tentative overlay
            await docA.flush();

            await storeA.close();
            await storeB.close();
        });

        it('drops tentative overlay when overlayTtlMs expires without updates', async () => {
            const ttlStoreId = `ttl_test_${Date.now()}`;

            const storeA = await createLiveStruct({
                name: ttlStoreId,
                forceMemory: true,
                overlayTtlMs: 120,
            });

            const storeB = await createLiveStruct({
                name: ttlStoreId,
                forceMemory: true,
                overlayTtlMs: 120,
            });

            const colA = await storeA.collection<{ title: string }>('notes');
            const colB = await storeB.collection<{ title: string }>('notes');

            const docA = await colA.create('n-1', { title: 'Committed Title' });
            const docB = await colB.create('n-1', { title: 'Committed Title' });

            expect(docB.data.title).toBe('Committed Title');
            expect(docB.isTentative).toBe(false);

            // Send tentative update from docA without committing
            void docA.patch({ title: 'Tentative Title' });

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(docB.data.title).toBe('Tentative Title');
            expect(docB.isTentative).toBe(true);

            // Wait for TTL (120ms) to expire
            await new Promise((resolve) => setTimeout(resolve, 250));

            // Tentative overlay dropped after TTL
            expect(docB.isTentative).toBe(false);
            expect(docB.data.title).toBe('Committed Title');

            await storeA.close();
            await storeB.close();
        });
    });

    describe('REQ-8: Deferred Commit Error Rollback & errors$ Stream', () => {
        it('rejects pending Promises, rolls back affected patches, and emits on errors$', async () => {
            const col = await store.collection<{ balance: number }>('accounts');
            const doc = await col.create('acc-1', { balance: 100 });

            // Spy on engine commit to simulate SQLite or validation failure
            const commitSpy = vi.spyOn(store.engine, 'commitBatchedPatches').mockRejectedValueOnce(
                new Error('Simulated SQLite disk write failure')
            );

            const receivedErrors: Error[] = [];
            const errSub = doc.errors$.subscribe((err) => {
                receivedErrors.push(err);
            });

            // Patch balance to 500
            const patchPromise = doc.patch({ balance: 500 });
            expect(doc.data.balance).toBe(500); // optimistic local

            // Awaiting patchPromise MUST reject with the commit error
            await expect(patchPromise).rejects.toThrow('Simulated SQLite disk write failure');

            // State rolled back to committed base (100)
            expect(doc.data.balance).toBe(100);
            expect(doc.isPending).toBe(false);

            // Error emitted on doc.errors$
            expect(receivedErrors.length).toBe(1);
            expect(receivedErrors[0].message).toContain('Simulated SQLite disk write failure');

            errSub.unsubscribe();
            commitSpy.mockRestore();
        });
    });

    describe('Micro-Benchmark: doc.patch Call Duration (50-shape doc, 3 subscribers)', () => {
        it('achieves p99 <= 0.3ms and max <= 1ms across 2000 iterations on a 50-shape document', async () => {
            const col = await store.collection<{ shapes: Record<string, { id: string; x: number; y: number }> }>('cad');

            const shapes: Record<string, { id: string; x: number; y: number }> = {};
            for (let i = 0; i < 50; i++) {
                shapes[`shape-${i}`] = { id: `shape-${i}`, x: i * 10, y: i * 10 };
            }

            const doc = await col.create('cad-doc-bench', { shapes });
            await store.flush();

            // 3 active subscribers on doc.$
            let sub1Hits = 0;
            let sub2Hits = 0;
            let sub3Hits = 0;
            const s1 = doc.$.subscribe(() => { sub1Hits++; });
            const s2 = doc.$.subscribe(() => { sub2Hits++; });
            const s3 = doc.$.subscribe(() => { sub3Hits++; });

            // JIT warm-up (500 iterations)
            for (let i = 0; i < 500; i++) {
                void doc.patch({ shapes: { 'shape-0': { id: 'shape-0', x: i, y: i } } });
            }

            // Measured benchmark (2000 iterations)
            const N = 2000;
            const latenciesMs: number[] = new Array(N);

            for (let i = 0; i < N; i++) {
                const t0 = performance.now();
                void doc.patch({ shapes: { 'shape-0': { id: 'shape-0', x: i + 1000, y: i + 1000 } } });
                const t1 = performance.now();
                latenciesMs[i] = t1 - t0;
            }

            const stats = calculatePercentiles(latenciesMs);
            console.log(`\n[doc.patch Micro-Benchmark Results (50 shapes, 3 subscribers, n=${N})]:`);
            console.log(`  mean:   ${stats.mean.toFixed(4)} ms`);
            console.log(`  median: ${stats.median.toFixed(4)} ms`);
            console.log(`  p95:    ${stats.p95.toFixed(4)} ms`);
            console.log(`  p99:    ${stats.p99.toFixed(4)} ms`);
            console.log(`  max:    ${stats.max.toFixed(4)} ms\n`);

            // Assertions from Acceptance Criteria
            expect(stats.p99).toBeLessThanOrEqual(0.3);
            expect(stats.max).toBeLessThanOrEqual(1.0);

            s1.unsubscribe();
            s2.unsubscribe();
            s3.unsubscribe();
        });
    });
});
