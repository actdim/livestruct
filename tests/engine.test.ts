/**
 * Test suite for @actdim/livestruct engine, storage adapters, RFC 7396 merge patch,
 * binary BLOBs, CDC streams, and raw SQL query/commit interfaces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, toArray, take } from 'rxjs';
import {
    createLiveEngine,
    createLiveStruct,
    LiveSqliteEngine,
    MemoryStorageAdapter,
    jsonMergePatch,
    serializeBlobs,
    deserializeBlobs,
    type DocumentRecord,
    type BlobMap,
} from '../src/index';

describe('LiveStruct Core Engine & SQLite Subsystem', () => {
    describe('1. Storage Adapters & Initialization', () => {
        it('initializes with memory fallback adapter when in non-browser environment', async () => {
            const engine = await createLiveEngine({ name: 'test_db', forceMemory: true });
            expect(engine).toBeInstanceOf(LiveSqliteEngine);
            expect(engine.storage.mode).toBe('memory');
            await engine.close();
        });

        it('stores and reloads state across engine instances using shared adapter', async () => {
            const storage = new MemoryStorageAdapter();
            const config = { name: 'shared_db', storagePath: 'shared.db' };

            const engine1 = new LiveSqliteEngine(config, storage);
            await engine1.init();
            await engine1.insertDoc('items', 'item-1', { title: 'First Item', count: 10 });
            await engine1.close();

            const engine2 = new LiveSqliteEngine(config, storage);
            await engine2.init();
            const doc = await engine2.getDoc('items', 'item-1');
            expect(doc).not.toBeNull();
            expect(doc?.data).toEqual({ title: 'First Item', count: 10 });
            expect(doc?.rev).toBe(1);
            await engine2.close();
        });
    });

    describe('2. RFC 7396 JSON Merge Patch', () => {
        it('merges shallow and nested properties cleanly', () => {
            const target = { a: 'b', c: { d: 'e', f: 'g' } };
            const patch = { a: 'z', c: { f: 'h' } };
            const result = jsonMergePatch(target, patch);

            expect(result).toEqual({ a: 'z', c: { d: 'e', f: 'h' } });
            // Verifies immutability of original target
            expect(target.a).toBe('b');
        });

        it('deletes keys when patch value is null', () => {
            const target = { a: 'b', c: { d: 'e', f: 'g' } };
            const patch = { a: null, c: { d: null } };
            const result = jsonMergePatch(target, patch);

            expect(result).toEqual({ c: { f: 'g' } });
            expect('a' in result).toBe(false);
        });

        it('replaces arrays entirely instead of merging elements per RFC 7396', () => {
            const target = { tags: ['alpha', 'beta'] };
            const patch = { tags: ['gamma'] };
            const result = jsonMergePatch(target, patch);

            expect(result).toEqual({ tags: ['gamma'] });
        });

        it('replaces target when patch is primitive or array', () => {
            expect(jsonMergePatch({ a: 1 }, 'string-patch')).toBe('string-patch');
            expect(jsonMergePatch({ a: 1 }, [1, 2, 3])).toEqual([1, 2, 3]);
        });
    });

    describe('3. Binary BLOB Serialization & Deserialization', () => {
        it('serializes and deserializes Float32Array geometry and Uint8Array buffers', () => {
            const vertices = new Float32Array([0.0, 1.5, -2.5, 3.14159, 100.25]);
            const rawBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);

            const originalBlobs: BlobMap = {
                mesh_coords: vertices,
                texture_mask: rawBytes,
            };

            const serialized = serializeBlobs(originalBlobs);
            expect(serialized).not.toBeNull();
            expect(serialized instanceof Uint8Array).toBe(true);

            const restored = deserializeBlobs(serialized);
            expect(restored.mesh_coords).toBeInstanceOf(Float32Array);
            expect(restored.texture_mask).toBeInstanceOf(Uint8Array);

            const restoredVertices = restored.mesh_coords as Float32Array;
            expect(restoredVertices.length).toBe(vertices.length);
            for (let i = 0; i < vertices.length; i++) {
                expect(restoredVertices[i]).toBeCloseTo(vertices[i], 5);
            }

            expect(Array.from(restored.texture_mask as Uint8Array)).toEqual(Array.from(rawBytes));
        });

        it('handles empty or null blob input gracefully', () => {
            expect(serializeBlobs(null)).toBeNull();
            expect(serializeBlobs({})).toBeNull();
            expect(deserializeBlobs(null)).toEqual({});
            expect(deserializeBlobs(new Uint8Array([]))).toEqual({});
        });
    });

    describe('4. Document CRUD & Engine Operations', () => {
        let engine: LiveSqliteEngine;

        beforeEach(async () => {
            engine = await createLiveEngine({ name: 'crud_test', forceMemory: true });
        });

        afterEach(async () => {
            await engine.close();
        });

        it('inserts and retrieves documents', async () => {
            const doc = await engine.insertDoc('parts', 'part-1', {
                name: 'Wing Bracket',
                mass: 12.5,
            });

            expect(doc.id).toBe('part-1');
            expect(doc.collection).toBe('parts');
            expect(doc.rev).toBe(1);
            expect(doc.data.name).toBe('Wing Bracket');

            const retrieved = await engine.getDoc('parts', 'part-1');
            expect(retrieved).not.toBeNull();
            expect(retrieved?.data).toEqual({ name: 'Wing Bracket', mass: 12.5 });
        });

        it('throws when inserting duplicate document id', async () => {
            await engine.insertDoc('parts', 'p-dup', { name: 'Original' });
            await expect(engine.insertDoc('parts', 'p-dup', { name: 'Duplicate' })).rejects.toThrow(
                /already exists/
            );
        });

        it('applies atomic patch mutations with revision increments', async () => {
            await engine.insertDoc('parts', 'part-patch', {
                name: 'Initial',
                color: 'blue',
                meta: { stage: 1, active: true },
            });

            const patched = await engine.patchDoc('parts', 'part-patch', {
                color: 'red',
                meta: { stage: 2 },
            });

            expect(patched.rev).toBe(2);
            expect(patched.data).toEqual({
                name: 'Initial',
                color: 'red',
                meta: { stage: 2, active: true },
            });
        });

        it('deletes documents cleanly', async () => {
            await engine.insertDoc('parts', 'part-del', { name: 'To be deleted' });
            const deleted = await engine.deleteDoc('parts', 'part-del');
            expect(deleted).toBe(true);

            const doc = await engine.getDoc('parts', 'part-del');
            expect(doc).toBeNull();

            const deleteNonExistent = await engine.deleteDoc('parts', 'part-del');
            expect(deleteNonExistent).toBe(false);
        });

        it('stores binary geometry BLOBs alongside documents', async () => {
            const coords = new Float32Array([1.0, 2.0, 3.0]);
            await engine.insertDoc('geometries', 'geom-1', { type: 'mesh' }, { coords });

            const retrieved = await engine.getDoc('geometries', 'geom-1');
            expect(retrieved).not.toBeNull();
            expect(retrieved?.blobs.coords).toBeInstanceOf(Float32Array);
            expect(Array.from(retrieved!.blobs.coords as Float32Array)).toEqual([1.0, 2.0, 3.0]);
        });
    });

    describe('5. Change Data Capture (CDC) Observable Streams', () => {
        let engine: LiveSqliteEngine;

        beforeEach(async () => {
            engine = await createLiveEngine({ name: 'cdc_test', forceMemory: true });
        });

        afterEach(async () => {
            await engine.close();
        });

        it('emits verified insert, update, and delete events in order', async () => {
            const access = engine.getEngineAccess<{ name: string; color?: string }>('shapes');
            const events: Array<{ type: string; id: string; delta: any }> = [];

            const sub = access.cdc$.subscribe((evt) => {
                events.push(evt);
            });

            await engine.insertDoc('shapes', 's-1', { name: 'Square', color: 'blue' });
            await engine.patchDoc('shapes', 's-1', { color: 'green' });
            await engine.deleteDoc('shapes', 's-1');

            expect(events.length).toBe(3);
            expect(events[0]).toEqual({
                type: 'insert',
                id: 's-1',
                delta: { name: 'Square', color: 'blue' },
            });
            expect(events[1]).toEqual({
                type: 'update',
                id: 's-1',
                delta: { color: 'green' },
            });
            expect(events[2]).toEqual({
                type: 'delete',
                id: 's-1',
                delta: {},
            });

            sub.unsubscribe();
        });

        it('filters CDC events strictly by collection', async () => {
            const accessA = engine.getEngineAccess('collectionA');
            const accessB = engine.getEngineAccess('collectionB');

            const eventsA: any[] = [];
            const eventsB: any[] = [];

            const subA = accessA.cdc$.subscribe((e) => eventsA.push(e));
            const subB = accessB.cdc$.subscribe((e) => eventsB.push(e));

            await engine.insertDoc('collectionA', 'a1', { value: 100 });
            await engine.insertDoc('collectionB', 'b1', { value: 200 });

            expect(eventsA.length).toBe(1);
            expect(eventsA[0].id).toBe('a1');

            expect(eventsB.length).toBe(1);
            expect(eventsB[0].id).toBe('b1');

            subA.unsubscribe();
            subB.unsubscribe();
        });
    });

    describe('6. Raw SQL Query & Commit Interfaces', () => {
        let engine: LiveSqliteEngine;

        beforeEach(async () => {
            engine = await createLiveEngine({ name: 'raw_test', forceMemory: true });
        });

        afterEach(async () => {
            await engine.close();
        });

        it('executes raw SELECT queries with parameters', async () => {
            await engine.insertDoc('nodes', 'n1', { label: 'Node Alpha', priority: 1 });
            await engine.insertDoc('nodes', 'n2', { label: 'Node Beta', priority: 2 });

            const results = await engine.queryRaw<any>('SELECT * FROM nodes WHERE id = ?', ['n1']);
            expect(results.length).toBe(1);
            expect(results[0].id).toBe('n1');
            expect(results[0].rev).toBe(1);
            expect(JSON.parse(results[0].data)).toEqual({ label: 'Node Alpha', priority: 1 });
        });

        it('executes SELECT COUNT(*) correctly', async () => {
            await engine.insertDoc('devices', 'd1', { status: 'online' });
            await engine.insertDoc('devices', 'd2', { status: 'offline' });

            const countResult = await engine.queryRaw<any>('SELECT COUNT(*) FROM devices');
            expect(countResult.length).toBe(1);
            expect(countResult[0].count).toBe(2);
        });

        it('executes commitRaw for insert, update, patch, and delete', async () => {
            const access = engine.getEngineAccess('sensors');

            await access.commitRaw({
                type: 'insert',
                id: 'sensor-1',
                data: { temp: 21.5, unit: 'C' },
            });

            let doc = await engine.getDoc('sensors', 'sensor-1');
            expect(doc?.data).toEqual({ temp: 21.5, unit: 'C' });

            await access.commitRaw({
                type: 'patch',
                id: 'sensor-1',
                data: { temp: 22.0 },
            });

            doc = await engine.getDoc('sensors', 'sensor-1');
            expect(doc?.data).toEqual({ temp: 22.0, unit: 'C' });

            await access.commitRaw({
                type: 'delete',
                id: 'sensor-1',
            });

            doc = await engine.getDoc('sensors', 'sensor-1');
            expect(doc).toBeNull();
        });
    });

    describe('7. High-Level LiveStruct & LiveCollection Ergonomics', () => {
        it('supports reactive document streams and collection queries', async () => {
            const store = await createLiveStruct({ name: 'high_level_test', forceMemory: true });
            const parts = await store.collection<{ name: string; color: string }>('parts');

            const doc = await parts.create('p-1', { name: 'Gear', color: 'gray' });
            expect(doc.id).toBe('p-1');
            expect(doc.data.name).toBe('Gear');

            const observedSnapshots: Array<{ name: string; color: string }> = [];
            const sub = doc.$.subscribe((snap) => {
                observedSnapshots.push({ ...snap });
            });

            await doc.patch({ color: 'golden' });
            expect(doc.data.color).toBe('golden');

            expect(observedSnapshots.length).toBe(2);
            expect(observedSnapshots[0].color).toBe('gray');
            expect(observedSnapshots[1].color).toBe('golden');

            const found = await parts.find();
            expect(found.length).toBe(1);
            expect(found[0].id).toBe('p-1');

            await store.close();
            expect(doc.isDisposed).toBe(true);
            expect(parts.isDisposed).toBe(true);
        });
    });
});
