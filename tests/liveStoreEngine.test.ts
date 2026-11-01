/**
 * Tests for LiveDocEngine backed by LiveStore.
 * Validates built-in schema materialization, revision tracking, synchronous local CDC,
 * remote sync attribution, read-only raw SQL queries, content-addressed blobs, and v1 migration.
 */

import { describe, it, expect } from 'vitest';
import { createLiveEngine, LiveDocEngine } from '../src/engine/liveStoreEngine';
import { MemoryBlobStore } from '../src/engine/blobStore';
import { MemoryStorageAdapter } from '../src/engine/storage';
import { events } from '../src/engine/schema';

describe('LiveStore-Backed Engine (LiveDocEngine)', () => {
    it('materializes insert, patch, replace, and delete with correct rev increments and RFC 7396 semantics', async () => {
        const engine = await createLiveEngine({ name: 'crud_lifecycle', forceMemory: true });

        // 1. Insert
        const doc1 = await engine.insertDoc('shapes', 's-1', {
            type: 'rectangle',
            metrics: { width: 100, height: 50 },
            tags: ['cad', 'v1'],
            removable: 'yes',
        });
        expect(doc1.id).toBe('s-1');
        expect(doc1.rev).toBe(1);
        expect(doc1.data.metrics.width).toBe(100);

        interface ShapeData {
            type: string;
            metrics: { width: number; height: number };
            tags: string[];
            removable?: string | null;
        }

        // 2. Patch with nested update, null-delete, and array replacement
        const doc2 = await engine.patchDoc<ShapeData>('shapes', 's-1', {
            metrics: { width: 120 },
            tags: ['cad', 'v2'],
            removable: null,
        });
        expect(doc2.rev).toBe(2);
        expect(doc2.data.metrics.width).toBe(120);
        expect(doc2.data.metrics.height).toBe(50); // Preserved
        expect(doc2.data.tags).toEqual(['cad', 'v2']); // Replaced
        expect('removable' in doc2.data).toBe(false); // Null-deleted

        // Verify snapshot from getDoc
        const fetched = await engine.getDoc<{ metrics: { width: number; height: number }; tags: string[]; removable?: boolean }>('shapes', 's-1');
        expect(fetched?.rev).toBe(2);
        expect(fetched?.data.metrics.width).toBe(120);
        expect('removable' in fetched!.data).toBe(false);

        // 3. Replace document
        const doc3 = await engine.updateDoc('shapes', 's-1', {
            type: 'circle',
            radius: 40,
        });
        expect(doc3.rev).toBe(3);
        expect(doc3.data.type).toBe('circle');
        expect((doc3.data as any).metrics).toBeUndefined();

        // 4. Delete document
        const deleted = await engine.deleteDoc('shapes', 's-1');
        expect(deleted).toBe(true);

        const afterDelete = await engine.getDoc('shapes', 's-1');
        expect(afterDelete).toBeNull();

        await engine.close();
    });

    it('rejects duplicate insert without committing to SQLite', async () => {
        const engine = await createLiveEngine({ name: 'dup_test', forceMemory: true });

        await engine.insertDoc('parts', 'part-1', { name: 'Screw' });

        await expect(
            engine.insertDoc('parts', 'part-1', { name: 'Another Screw' })
        ).rejects.toThrow(/already exists/);

        // Verify only 1 record remains with rev 1
        const rows = await engine.queryRaw<any>('SELECT * FROM docs WHERE id = ?', ['part-1']);
        expect(rows.length).toBe(1);
        expect(rows[0].rev).toBe(1);

        await engine.close();
    });

    it('emits local CDC synchronously carrying mutationId and origin: local', async () => {
        const engine = await createLiveEngine({ name: 'local_cdc_test', forceMemory: true });
        const cdcEvents: any[] = [];

        const sub = engine.cdc$.subscribe((e) => {
            cdcEvents.push(e);
        });

        const customMutId = 'mut-sync-1001';
        await engine.insertDoc('items', 'it-1', { label: 'Item 1' }, undefined, customMutId);

        expect(cdcEvents.length).toBe(1);
        expect(cdcEvents[0]).toMatchObject({
            type: 'insert',
            kind: 'insert',
            collection: 'items',
            id: 'it-1',
            rev: 1,
            delta: { label: 'Item 1' },
            data: { label: 'Item 1' },
            mutationId: customMutId,
            origin: 'local',
        });

        sub.unsubscribe();
        await engine.close();
    });

    it('enforces read-only queryRaw (SELECT allowed, non-SELECT rejected)', async () => {
        const engine = await createLiveEngine({ name: 'query_raw_test', forceMemory: true });

        await engine.insertDoc('users', 'u1', { name: 'Alice', role: 'admin' });
        await engine.insertDoc('users', 'u2', { name: 'Bob', role: 'guest' });

        // SELECT query
        const selectRows = await engine.queryRaw<any>('SELECT id, body, rev FROM docs WHERE collection = ?', ['users']);
        expect(selectRows.length).toBe(2);
        expect(selectRows.map((r) => r.id).sort()).toEqual(['u1', 'u2']);

        // Non-SELECT queries must be rejected
        await expect(engine.queryRaw('UPDATE docs SET rev = 99')).rejects.toThrow(/only SELECT allowed/i);
        await expect(engine.queryRaw('DELETE FROM docs')).rejects.toThrow(/only SELECT allowed/i);
        await expect(engine.queryRaw('INSERT INTO docs (key) VALUES ("bad")')).rejects.toThrow(/only SELECT allowed/i);

        await engine.close();
    });

    it('stores binary blobs in content-addressed BlobStore with events carrying hashes only', async () => {
        const engine = await createLiveEngine({ name: 'blob_test', forceMemory: true });

        const coords = new Float32Array([10.5, 20.25, 30.125]);
        const header = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

        await engine.insertDoc('cad_items', 'cad-1', { title: 'Mesh Box' }, { coords, header });

        // Verify getDoc reconstructs exact Float32Array and Uint8Array instances
        const doc = await engine.getDoc('cad_items', 'cad-1');
        expect(doc).not.toBeNull();
        expect(doc?.blobs.coords).toBeInstanceOf(Float32Array);
        expect(Array.from(doc!.blobs.coords as Float32Array)).toEqual([10.5, 20.25, 30.125]);
        expect(doc?.blobs.header).toBeInstanceOf(Uint8Array);
        expect(Array.from(doc!.blobs.header as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef]);

        // Verify that the stored SQLite row contains only SHA-256 hashes
        const rows = await engine.queryRaw<any>('SELECT blobs FROM docs WHERE id = ?', ['cad-1']);
        expect(rows.length).toBe(1);
        const storedBlobs = JSON.parse(rows[0].blobs);
        expect(typeof storedBlobs.coords).toBe('string');
        expect(storedBlobs.coords.length).toBe(64); // SHA-256 hex string length
        expect(typeof storedBlobs.header).toBe('string');
        expect(storedBlobs.header.length).toBe(64);

        await engine.close();
    });

    it('migrates existing legacy v1 JSON database once and renames to .db.migrated', async () => {
        const storage = new MemoryStorageAdapter();
        const dbPath = 'legacy_migration.db';

        // Write a fake legacy v1 database file
        const legacyData = {
            version: 1,
            timestamp: Date.now(),
            documents: {
                'notes:n-1': {
                    collection: 'notes',
                    id: 'n-1',
                    rev: 1,
                    data: { text: 'Imported from v1' },
                    updatedAt: 1234567,
                },
                'notes:n-2': {
                    collection: 'notes',
                    id: 'n-2',
                    rev: 1,
                    data: { text: 'Second note' },
                    updatedAt: 1234568,
                },
            },
        };
        await storage.write(dbPath, new TextEncoder().encode(JSON.stringify(legacyData)));

        // Open engine with legacy storage
        const engine1 = new LiveDocEngine({ name: 'legacy_migration', storagePath: dbPath }, storage);
        await engine1.init();

        const note1 = await engine1.getDoc('notes', 'n-1');
        expect(note1).not.toBeNull();
        expect(note1?.data.text).toBe('Imported from v1');

        const note2 = await engine1.getDoc('notes', 'n-2');
        expect(note2).not.toBeNull();
        expect(note2?.data.text).toBe('Second note');

        // Verify .db was renamed to .db.migrated
        expect(await storage.exists(dbPath)).toBe(false);
        expect(await storage.exists(`${dbPath}.migrated`)).toBe(true);

        await engine1.close();

        // Second open: should not fail or re-migrate
        const engine2 = new LiveDocEngine({ name: 'legacy_migration', storagePath: dbPath }, storage);
        await engine2.init();
        expect(await storage.exists(dbPath)).toBe(false);
        await engine2.close();
    });

    it('supports two engines on a shared store seeing remote writes with origin: remote', async () => {
        const engine1 = await createLiveEngine({ name: 'sync_pair', forceMemory: true });
        // Engine 2 shares the same LiveStore store
        const engine2 = new LiveDocEngine({ name: 'sync_pair' }, engine1.store, engine1.blobStore);
        await engine2.init();

        const engine2RemoteEvents: any[] = [];
        const sub = engine2.cdc$.subscribe((e) => {
            if (e.origin === 'remote') {
                engine2RemoteEvents.push(e);
            }
        });

        // Write from engine 1
        await engine1.insertDoc('messages', 'msg-1', { content: 'Hello from peer' }, undefined, 'mut-remote-1');

        // Engine 2 receives change via table subscription
        expect(engine2RemoteEvents.length).toBe(1);
        expect(engine2RemoteEvents[0]).toMatchObject({
            type: 'insert',
            kind: 'insert',
            collection: 'messages',
            id: 'msg-1',
            origin: 'remote',
            delta: { content: 'Hello from peer' },
        });

        sub.unsubscribe();
        await engine2.close();
        await engine1.close();
    });
});
