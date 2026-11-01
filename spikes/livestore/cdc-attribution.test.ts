import { describe, it, expect } from 'vitest';
import { makeInMemoryAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from './schema';

describe('Remote Change Attribution & CDC Semantics (Q7)', () => {
    it('recovers mutationId and origin synchronously via table query', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'cdc-query-test',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        const expectedMutationId = 'mut-cdc-9876';
        const expectedOrigin = 'peer-iframe-beta';

        store.commit(events.docCreated({
            id: 'doc-cdc-1',
            body: JSON.stringify({ layer: 'base', visible: true }),
            mutationId: expectedMutationId,
            origin: expectedOrigin,
        }));

        const rows = store.query(tables.docs.where({ id: 'doc-cdc-1' }));
        expect(rows.length).toBe(1);
        expect(rows[0].mutation_id).toBe(expectedMutationId);
        expect(rows[0].origin).toBe(expectedOrigin);

        // Next mutation updates attribution
        store.commit(events.docPatched({
            id: 'doc-cdc-1',
            patch: JSON.stringify({ visible: false }),
            mutationId: 'mut-cdc-9877',
            origin: 'peer-host-alpha',
        }));

        const patchedRow = store.query(tables.docs.where({ id: 'doc-cdc-1' }))[0];
        expect(patchedRow.mutation_id).toBe('mut-cdc-9877');
        expect(patchedRow.origin).toBe('peer-host-alpha');

        await store.shutdown();
    });

    it('recovers mutationId and origin via table subscriptions for reactive CDC', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'cdc-sub-test',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        const capturedChanges: Array<{ id: string; mutationId: string; origin: string }> = [];

        const unsubscribe = store.subscribe(tables.docs, (rows) => {
            for (const r of rows) {
                capturedChanges.push({
                    id: r.id,
                    mutationId: r.mutation_id,
                    origin: r.origin,
                });
            }
        });

        store.commit(events.docCreated({
            id: 'doc-sub-1',
            body: JSON.stringify({ count: 1 }),
            mutationId: 'm-sub-1',
            origin: 'origin-sub-alpha',
        }));

        expect(capturedChanges.length).toBeGreaterThanOrEqual(1);
        const last1 = capturedChanges[capturedChanges.length - 1];
        expect(last1.id).toBe('doc-sub-1');
        expect(last1.mutationId).toBe('m-sub-1');
        expect(last1.origin).toBe('origin-sub-alpha');

        store.commit(events.docPatched({
            id: 'doc-sub-1',
            patch: JSON.stringify({ count: 2 }),
            mutationId: 'm-sub-2',
            origin: 'origin-sub-beta',
        }));

        const last2 = capturedChanges[capturedChanges.length - 1];
        expect(last2.id).toBe('doc-sub-1');
        expect(last2.mutationId).toBe('m-sub-2');
        expect(last2.origin).toBe('origin-sub-beta');

        unsubscribe();
        await store.shutdown();
    });
});
