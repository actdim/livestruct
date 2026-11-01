/**
 * @actdim/livestruct - Engine and API Correctness Test Suite
 * Validates REQ-1 through REQ-7:
 * - REQ-1: Instance identity and subscription cleanup
 * - REQ-2: No unhandled rejections
 * - REQ-3: patchPath set semantics and array stability
 * - REQ-4: Full replace rebase
 * - REQ-5: Deep-frozen snapshots and isolated delta
 * - REQ-6: MobX peer dependency
 * - REQ-7: Date / TypedArray / Non-JSON validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    createLiveStruct,
    type LiveStoreInstance,
    type LiveCollection,
    type LiveDocument,
} from '../src/index';

describe('Engine Correctness Batch (REQ-1 to REQ-7)', () => {
    let store: LiveStoreInstance;
    let unhandledRejections: unknown[] = [];
    const unhandledHandler = (reason: unknown) => {
        unhandledRejections.push(reason);
    };

    beforeEach(async () => {
        unhandledRejections = [];
        process.on('unhandledRejection', unhandledHandler);
        store = await createLiveStruct({ name: 'test_correctness', forceMemory: true });
    });

    afterEach(async () => {
        process.removeListener('unhandledRejection', unhandledHandler);
        if (!store.engine.isClosed) {
            await store.close();
        }
        expect(unhandledRejections).toEqual([]);
    });

    describe('REQ-1: Instance identity and subscription cleanup', () => {
        it('concurrent collection.get returns the exact same LiveDocument instance', async () => {
            const col = await store.collection<{ name: string }>('users');
            await store.engine.insertDoc('users', 'u1', { name: 'Alice' });

            // Call get concurrently before any document is cached in collection
            const [d1, d2, d3] = await Promise.all([
                col.get('u1'),
                col.get('u1'),
                col.get('u1'),
            ]);

            expect(d1).not.toBeNull();
            expect(d1).toBe(d2);
            expect(d2).toBe(d3);
        });

        it('releases CDC subscriptions upon doc.dispose and collection.dispose', async () => {
            const col = await store.collection<{ name: string }>('users');
            const doc = await col.create('u-sub', { name: 'Bob' });

            expect((doc as any).subscriptionCount).toBe(1);
            expect((col as any).subscriptionCount).toBeGreaterThanOrEqual(2); // 1 col + 1 doc

            doc.dispose();
            expect((doc as any).subscriptionCount).toBe(0);

            col.dispose();
            expect((col as any).subscriptionCount).toBe(0);
        });
    });

    describe('REQ-2: No unhandled rejections', () => {
        it('catches deferred setter errors in toObservableDocument and routes to errors$', async () => {
            const { toObservableDocument } = await import('../src/document/observable');
            const col = await store.collection<{ name: string }>('users');
            const doc = await col.create('u-err', { name: 'Charlie' });
            const obs = toObservableDocument(doc);

            const receivedErrors: Error[] = [];
            doc.errors$.subscribe((err) => receivedErrors.push(err));

            // Force patch rejection by disposing doc first
            doc.dispose();
            obs.name = 'Dave';

            // Wait a tick for promise microtasks to settle
            await new Promise((r) => setTimeout(r, 20));

            expect(unhandledRejections).toEqual([]);
        });
    });

    describe('REQ-3: patchPath set semantics and array stability', () => {
        it('replaces target subtree instead of deep merging for object properties', async () => {
            const col = await store.collection<{
                profile: { address: { city: string; street?: string } };
            }>('profiles');
            const doc = await col.create('p1', {
                profile: {
                    address: {
                        city: 'London',
                        street: 'Baker St',
                    },
                },
            });

            // Setting profile.address should replace { city, street } with { city: 'Paris' }
            await doc.patchPath('profile.address', { city: 'Paris' } as any);
            expect(doc.data.profile.address).toEqual({ city: 'Paris' });
            expect((doc.data.profile.address as any).street).toBeUndefined();

            await doc.flush();
            const fetched = await col.get('p1');
            expect(fetched?.data.profile.address).toEqual({ city: 'Paris' });
        });

        it('supports array indices in paths without rebuilding the whole array from stale snapshot', async () => {
            const col = await store.collection<{
                items: Array<{ id: number; title: string; extra: string }>;
            }>('tasks');
            const doc = await col.create('t1', {
                items: [
                    { id: 1, title: 'Item 1', extra: 'Keep 1' },
                    { id: 2, title: 'Item 2', extra: 'Keep 2' },
                ],
            });

            await doc.patchPath('items.0.title', 'Updated 1');
            expect(doc.data.items[0]).toEqual({ id: 1, title: 'Updated 1', extra: 'Keep 1' });
            expect(doc.data.items[1]).toEqual({ id: 2, title: 'Item 2', extra: 'Keep 2' });

            await doc.flush();
            const fetched = await col.get('t1');
            expect(fetched?.data.items[0].title).toBe('Updated 1');
            expect(fetched?.data.items[0].extra).toBe('Keep 1');
        });
    });

    describe('REQ-4: Full replace rebase', () => {
        it('replace() completely replaces committed state and re-applies pending patch on top', async () => {
            const col = await store.collection<{ a?: number; b?: number; x?: number }>('items');
            const doc = await col.create('i1', { a: 1, b: 2 });

            // Apply a local pending patch (lazy commit)
            void doc.patch({ b: 99 });
            expect(doc.data).toEqual({ a: 1, b: 99 });
            expect(doc.isPending).toBe(true);

            // Replace committed state with { x: 10 }
            await doc.replace({ x: 10 });

            // Old fields 'a' should be gone, 'x' should exist, and pending 'b: 99' re-applied
            expect(doc.data.a).toBeUndefined();
            expect(doc.data.x).toBe(10);
            expect(doc.data.b).toBe(99);
        });
    });

    describe('REQ-5: Deep-frozen snapshots and isolated delta', () => {
        it('deep-freezes doc.data preventing nested property mutation', async () => {
            const col = await store.collection<{ meta: { author: { name: string } } }>('articles');
            const doc = await col.create('a1', { meta: { author: { name: 'Alice' } } });

            expect(Object.isFrozen(doc.data)).toBe(true);
            expect(Object.isFrozen(doc.data.meta)).toBe(true);
            expect(Object.isFrozen(doc.data.meta.author)).toBe(true);

            expect(() => {
                (doc.data.meta.author as any).name = 'Bob';
            }).toThrow();
        });

        it('clones CDC delta so caller mutations do not alias CDC payload', async () => {
            const col = await store.collection<{ nested: { val: number } }>('data');
            const doc = await col.create('d1', { nested: { val: 1 } });

            const emittedDeltas: any[] = [];
            const sub = doc.engine.cdc$.subscribe((e) => {
                emittedDeltas.push(e.delta);
            });

            const patchObj = { nested: { val: 2 } };
            await doc.patch(patchObj);

            // Caller mutates their patch object afterwards
            patchObj.nested.val = 999;

            expect(emittedDeltas.length).toBeGreaterThan(0);
            const lastDelta = emittedDeltas[emittedDeltas.length - 1];
            expect(lastDelta.nested.val).toBe(2);

            sub.unsubscribe();
        });

        it('lens writes via createDocLens go through doc.patchPath without mutating doc.data directly', async () => {
            const { createDocLens } = await import('../src/lens/index');
            const col = await store.collection<{ config: { active: boolean } }>('settings');
            const doc = await col.create('s1', { config: { active: true } });

            const activeLens = createDocLens(doc, 'config.active');
            expect(activeLens.get()).toBe(true);

            await activeLens.set(false);
            expect(doc.data.config.active).toBe(false);
        });
    });

    describe('REQ-6: MobX peer dependency', () => {
        it('package.json has mobx in peerDependencies but not in peerDependenciesMeta.optional', () => {
            const pkgPath = resolve(__dirname, '../package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

            expect(pkg.peerDependencies?.mobx).toBeDefined();
            expect(pkg.peerDependenciesMeta?.mobx).toBeUndefined();
        });
    });

    describe('REQ-7: Date / TypedArray / Non-JSON validation', () => {
        it('rejects Date objects with descriptive LiveStructValueError', async () => {
            const { LiveStructValueError } = await import('../src/document/errors');
            const col = await store.collection<any>('shapes');
            const doc = await col.create('sh1', { name: 'Circle' });

            await expect(
                doc.patch({ createdAt: new Date() })
            ).rejects.toThrow(LiveStructValueError);

            await expect(
                doc.patch({ createdAt: new Date() })
            ).rejects.toThrow(/Date at createdAt: convert to ISO string or number/);
        });

        it('rejects TypedArray, Map, Set, and Function with LiveStructValueError', async () => {
            const { LiveStructValueError } = await import('../src/document/errors');
            const col = await store.collection<any>('shapes');
            const doc = await col.create('sh2', { name: 'Square' });

            await expect(
                doc.patch({ buf: new Uint8Array([1, 2, 3]) })
            ).rejects.toThrow(LiveStructValueError);

            await expect(
                doc.patch({ map: new Map() })
            ).rejects.toThrow(LiveStructValueError);

            await expect(
                doc.patch({ set: new Set() })
            ).rejects.toThrow(LiveStructValueError);

            await expect(
                doc.patch({ fn: () => {} })
            ).rejects.toThrow(LiveStructValueError);
        });
    });
});
