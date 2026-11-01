import { describe, it, expect } from 'vitest';
import { makeInMemoryAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from './schema';

describe('Embedding Defaults & Storage Mode Fallback (Q8)', () => {
    it('confirms confirmUnsavedChanges: false does not attach beforeunload handler', async () => {
        // Track addEventListener calls
        let beforeUnloadAttached = false;
        const fakeWindow = {
            addEventListener: (type: string) => {
                if (type === 'beforeunload') beforeUnloadAttached = true;
            },
            removeEventListener: () => {},
        };

        const originalWindow = globalThis.window;
        // @ts-expect-error Mocking window in node
        globalThis.window = fakeWindow;

        try {
            const store = await createStorePromise({
                schema,
                storeId: 'defaults-test',
                adapter: makeInMemoryAdapter(),
                confirmUnsavedChanges: false,
                disableDevtools: true,
            });

            // Commit a change to create pending state
            store.commit(events.docCreated({
                id: 'doc-def',
                body: '{}',
                mutationId: 'm-def',
                origin: 'test',
            }));

            expect(beforeUnloadAttached).toBe(false);
            expect(store.storageMode).toBe('in-memory');

            await store.shutdown();
        } finally {
            globalThis.window = originalWindow;
        }
    });

    it('verifies storageMode is in-memory for ephemeral sessions and fallback paths', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'storage-mode-test',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        expect(store.storageMode).toBe('in-memory');

        await store.shutdown();
    });
});
