import { describe, it, expect } from 'vitest';
import { makeInMemoryAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from './schema';

describe('LiveStore Node Environment & In-Memory Adapter (Q2)', () => {
    it('creates store, commits, queries synchronously, and receives subscription updates', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'node-test-store',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        expect(store).toBeDefined();
        expect(store.storeId).toBe('node-test-store');

        // Initial state is empty
        const initialRows = store.query(tables.docs);
        expect(initialRows).toEqual([]);

        // Set up subscription
        const observedStates: Array<readonly { id: string; body: string }[]> = [];
        const unsubscribe = store.subscribe(tables.docs, (rows) => {
            observedStates.push(rows);
        });

        // First emission should be the initial empty state
        expect(observedStates.length).toBe(1);
        expect(observedStates[0]).toEqual([]);

        // Synchronous commit
        store.commit(events.docCreated({
            id: 'doc-node-1',
            body: JSON.stringify({ name: 'Document 1', count: 0 }),
            mutationId: 'mut-1',
            origin: 'session-node-1',
        }));

        // Query synchronously right after commit
        const rowsAfterCreate = store.query(tables.docs);
        expect(rowsAfterCreate.length).toBe(1);
        expect(rowsAfterCreate[0].id).toBe('doc-node-1');
        expect(JSON.parse(rowsAfterCreate[0].body)).toEqual({ name: 'Document 1', count: 0 });

        // Subscription should have received synchronous or immediate notification
        expect(observedStates.length).toBe(2);
        expect(observedStates[1].length).toBe(1);
        expect(observedStates[1][0].id).toBe('doc-node-1');

        // Synchronous commit of patch
        store.commit(events.docPatched({
            id: 'doc-node-1',
            patch: JSON.stringify({ count: 42, active: true }),
            mutationId: 'mut-2',
            origin: 'session-node-1',
        }));

        const rowsAfterPatch = store.query(tables.docs);
        expect(rowsAfterPatch.length).toBe(1);
        expect(JSON.parse(rowsAfterPatch[0].body)).toEqual({
            name: 'Document 1',
            count: 42,
            active: true,
        });

        expect(observedStates.length).toBe(3);

        unsubscribe();

        // Cleanup
        await store.shutdown();
    });
});
