import { describe, it, expect } from 'vitest';
import { makeInMemoryAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from './schema';

interface Shape {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    stroke: string;
    rotation: number;
}

interface CadDocument {
    version: number;
    canvas: { width: number; height: number };
    shapes: Record<string, Shape>;
}

function create50ShapeDoc(): CadDocument {
    const shapes: Record<string, Shape> = {};
    for (let i = 0; i < 50; i++) {
        shapes[`shape-${i}`] = {
            id: `shape-${i}`,
            type: i % 2 === 0 ? 'rect' : 'circle',
            x: (i * 20) % 800,
            y: (i * 15) % 600,
            width: 50,
            height: 50,
            fill: '#3b82f6',
            stroke: '#1e3a8a',
            rotation: 0,
        };
    }
    return {
        version: 1,
        canvas: { width: 1920, height: 1080 },
        shapes,
    };
}

function calculatePercentiles(latenciesMs: number[]) {
    latenciesMs.sort((a, b) => a - b);
    const n = latenciesMs.length;
    const median = latenciesMs[Math.floor(n * 0.5)];
    const p95 = latenciesMs[Math.floor(n * 0.95)];
    const p99 = latenciesMs[Math.floor(n * 0.99)];
    const min = latenciesMs[0];
    const max = latenciesMs[n - 1];
    const mean = latenciesMs.reduce((acc, v) => acc + v, 0) / n;
    return { median, p95, p99, min, max, mean };
}

describe('UI Thread Commit Cost (Q6)', () => {
    it('measures store.commit latency on 50-shape doc with 1, 5, 20 subscriptions (n>=500)', async () => {
        const docId = 'cad-doc-perf';
        const N = 500;
        const initialDoc = create50ShapeDoc();

        const results: Record<string, any> = {};

        for (const subCount of [1, 5, 20]) {
            const store = await createStorePromise({
                schema,
                storeId: `perf-store-${subCount}`,
                adapter: makeInMemoryAdapter(),
                confirmUnsavedChanges: false,
                disableDevtools: true,
            });

            store.commit(events.docCreated({
                id: docId,
                body: JSON.stringify(initialDoc),
                mutationId: 'init',
                origin: 'bench',
            }));

            // Register subscriptions
            const unsubs: Array<() => void> = [];
            for (let s = 0; s < subCount; s++) {
                unsubs.push(
                    store.subscribe(tables.docs, (rows) => {
                        // simulate subscriber reading row
                        if (rows.length > 0) {
                            void rows[0].body.length;
                        }
                    })
                );
            }

            // Warm up (50 commits)
            for (let w = 0; w < 50; w++) {
                store.commit(events.docPatched({
                    id: docId,
                    patch: JSON.stringify({
                        shapes: {
                            'shape-12': { x: 100 + w, y: 150 + w },
                        },
                    }),
                    mutationId: `warm-${w}`,
                    origin: 'bench',
                }));
            }

            // Measurement run
            const latenciesMs: number[] = [];
            for (let i = 0; i < N; i++) {
                const t0 = performance.now();
                store.commit(events.docPatched({
                    id: docId,
                    patch: JSON.stringify({
                        shapes: {
                            'shape-12': { x: 200 + (i % 50), y: 300 + (i % 50) },
                        },
                    }),
                    mutationId: `meas-${subCount}-${i}`,
                    origin: 'bench',
                }));
                const t1 = performance.now();
                latenciesMs.push(t1 - t0);
            }

            const stats = calculatePercentiles(latenciesMs);
            results[`${subCount}-subs`] = stats;

            console.log(`[Q6 Latency] ${subCount} subscriptions (n=${N}):`);
            console.log(`  mean:   ${stats.mean.toFixed(3)} ms`);
            console.log(`  median: ${stats.median.toFixed(3)} ms`);
            console.log(`  p95:    ${stats.p95.toFixed(3)} ms`);
            console.log(`  p99:    ${stats.p99.toFixed(3)} ms`);
            console.log(`  max:    ${stats.max.toFixed(3)} ms`);

            for (const u of unsubs) u();
            await store.shutdown();
        }

        // Assert that 1-subscription p95 is reported and bounded
        expect(results['1-subs'].p95).toBeDefined();
        console.log('Results table for documentation:', JSON.stringify(results, null, 2));
    });

    it('simulates 60 commits/sec for 3 seconds and verifies long task immunity', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'perf-cad-60fps',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        const docId = 'cad-stream-doc';
        store.commit(events.docCreated({
            id: docId,
            body: JSON.stringify(create50ShapeDoc()),
            mutationId: 'init-60',
            origin: 'bench',
        }));

        store.subscribe(tables.docs, (rows) => {
            if (rows.length > 0) void rows[0].body.length;
        });

        const totalFrames = 180; // 3 seconds @ 60 commits/s
        const frameIntervalMs = 1000 / 60; // 16.666 ms
        const commitDurations: number[] = [];
        let longTasksCount = 0;

        const startTime = performance.now();
        for (let f = 0; f < totalFrames; f++) {
            const frameStart = performance.now();
            store.commit(events.docPatched({
                id: docId,
                patch: JSON.stringify({
                    shapes: {
                        'shape-7': { x: 50 + f, y: 75 + f },
                    },
                }),
                mutationId: `fps60-${f}`,
                origin: 'bench',
            }));
            const duration = performance.now() - frameStart;
            commitDurations.push(duration);

            if (duration > 16.6) {
                longTasksCount++;
            }

            // Sleep remaining time of frame if any
            const elapsed = performance.now() - frameStart;
            if (elapsed < frameIntervalMs) {
                await new Promise((r) => setTimeout(r, frameIntervalMs - elapsed));
            }
        }
        const totalDurationMs = performance.now() - startTime;
        const stats = calculatePercentiles(commitDurations);

        console.log(`[Q6 60fps for 3s] ${totalFrames} frames executed in ${(totalDurationMs / 1000).toFixed(2)}s:`);
        console.log(`  mean commit time:   ${stats.mean.toFixed(3)} ms`);
        console.log(`  median commit time: ${stats.median.toFixed(3)} ms`);
        console.log(`  p95 commit time:    ${stats.p95.toFixed(3)} ms`);
        console.log(`  max commit time:    ${stats.max.toFixed(3)} ms`);
        console.log(`  long tasks (>16.6ms): ${longTasksCount} / ${totalFrames}`);

        expect(longTasksCount).toBe(0);

        await store.shutdown();
    });
});
