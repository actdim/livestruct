/**
 * @actdim/livestruct - LiveDocument Unit Tests
 * Verifies synchronous snapshot, RxJS observable stream, RFC 7396 merge patch,
 * type-safe patchPath, optimistic updates, echo suppression, MobX reactivity,
 * and low-level engine escape hatches.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autorun } from 'mobx';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
    createLiveStruct,
    toObservableDocument,
    type LiveStoreInstance,
    type LiveCollection,
    type LiveDocument,
} from '../src/index';

interface UserProfile {
    name: string;
    age: number;
    contact: {
        email: string;
        phone?: string;
    };
    tags: string[];
    bio?: string | null;
}

describe('LiveDocument Subsystem', () => {
    let store: LiveStoreInstance;
    let usersCol: LiveCollection<UserProfile>;
    let doc: LiveDocument<UserProfile>;

    beforeEach(async () => {
        store = await createLiveStruct({ name: 'test_doc_store', forceMemory: true });
        usersCol = await store.collection<UserProfile>('users');
        doc = await usersCol.create('u-1', {
            name: 'Alice',
            age: 30,
            contact: {
                email: 'alice@example.com',
            },
            tags: ['admin', 'developer'],
        });
    });

    afterEach(async () => {
        if (!store.engine.isClosed) {
            await store.close();
        }
    });

    describe('1. Synchronous Snapshot and Immutability', () => {
        it('exposes frozen synchronous data snapshot', () => {
            expect(doc.id).toBe('u-1');
            expect(doc.collectionName).toBe('users');
            expect(doc.data.name).toBe('Alice');
            expect(doc.data.age).toBe(30);
            expect(doc.data.contact.email).toBe('alice@example.com');
            expect(doc.data.tags).toEqual(['admin', 'developer']);
            expect(Object.isFrozen(doc.data)).toBe(true);
        });

        it('prevents direct mutation of data snapshot in strict mode', () => {
            expect(() => {
                (doc.data as any).name = 'Hacked';
            }).toThrow();
        });
    });

    describe('2. RxJS Observable Stream .$', () => {
        it('emits current snapshot immediately on subscription', async () => {
            const initial = await firstValueFrom(doc.$);
            expect(initial.name).toBe('Alice');
            expect(initial.age).toBe(30);
        });

        it('emits updated snapshot when patched', async () => {
            const snapshots: Array<UserProfile> = [];
            const sub = doc.$.subscribe((snap) => {
                snapshots.push({ ...snap });
            });

            await doc.patch({ age: 31 });
            await doc.patch({ name: 'Alice Smith' });

            expect(snapshots.length).toBe(3);
            expect(snapshots[0].age).toBe(30);
            expect(snapshots[1].age).toBe(31);
            expect(snapshots[2].name).toBe('Alice Smith');

            sub.unsubscribe();
        });
    });

    describe('3. RFC 7396 JSON Merge Patch', () => {
        it('merges shallow and nested fields', async () => {
            await doc.patch({
                age: 32,
                contact: { email: 'new_alice@example.com', phone: '+123456789' },
            });

            expect(doc.data.age).toBe(32);
            expect(doc.data.contact.email).toBe('new_alice@example.com');
            expect(doc.data.contact.phone).toBe('+123456789');
            // Unchanged fields remain
            expect(doc.data.name).toBe('Alice');
            expect(doc.data.tags).toEqual(['admin', 'developer']);
        });

        it('removes keys when patched with null', async () => {
            await doc.patch({ bio: 'Engineer' });
            expect(doc.data.bio).toBe('Engineer');

            await doc.patch({ bio: null });
            expect(doc.data.bio).toBeUndefined();
        });

        it('replaces array values entirely per RFC 7396', async () => {
            await doc.patch({ tags: ['superadmin'] });
            expect(doc.data.tags).toEqual(['superadmin']);
        });
    });

    describe('4. Type-Safe patchPath Mutations', () => {
        it('mutates shallow fields via dot path', async () => {
            await doc.patchPath('name', 'Bob');
            expect(doc.data.name).toBe('Bob');
        });

        it('mutates nested properties via dot path', async () => {
            await doc.patchPath('contact.email', 'bob@work.com');
            expect(doc.data.contact.email).toBe('bob@work.com');
            // Sibling contact fields and top-level fields preserved
            expect(doc.data.name).toBe('Alice');
        });

        it('mutates array elements via index path', async () => {
            await doc.patchPath('tags.1', 'lead');
            expect(doc.data.tags).toEqual(['admin', 'lead']);
        });
    });

    describe('5. Optimistic Updates and Echo Suppression', () => {
        it('applies local patch optimistically and suppresses engine CDC echo', async () => {
            const emittedSnapshots: Array<string> = [];
            const sub = doc.$.subscribe((snap) => {
                emittedSnapshots.push(snap.name);
            });

            // Initial emission
            expect(emittedSnapshots).toEqual(['Alice']);

            // Execute patch
            await doc.patch({ name: 'Charlie' });

            // Exactly 2 emissions: initial and local optimistic patch.
            // When engine broadcasts CDC event, echo suppression prevents 3rd emission.
            expect(emittedSnapshots).toEqual(['Alice', 'Charlie']);
            expect(doc.data.name).toBe('Charlie');

            sub.unsubscribe();
        });

        it('rolls back optimistic state on engine error', async () => {
            const emittedSnapshots: Array<number> = [];
            const sub = doc.$.subscribe((snap) => {
                emittedSnapshots.push(snap.age);
            });

            // Force engine failure by closing underlying storage
            await store.close();

            await expect(doc.patch({ age: 99 })).rejects.toThrow();

            // After failure, state rolled back to 30
            expect(doc.data.age).toBe(30);
            sub.unsubscribe();
        });
    });

    describe('6. Concurrent External Mutations Without Cursor Jumps', () => {
        it('merges external CDC events smoothly into local document state', async () => {
            const emittedSnapshots: Array<UserProfile> = [];
            const sub = doc.$.subscribe((snap) => {
                emittedSnapshots.push({ ...snap });
            });

            // Simulate external mutation from another tab/client via raw commit
            await doc.engine.commitRaw({
                type: 'patch',
                collection: 'users',
                id: 'u-1',
                data: {
                    age: 35,
                    contact: { email: 'external@example.com' },
                },
            });

            // Wait a tick for CDC propagation
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(doc.data.age).toBe(35);
            expect(doc.data.contact.email).toBe('external@example.com');
            // Preserves local fields
            expect(doc.data.name).toBe('Alice');

            sub.unsubscribe();
        });
    });

    describe('7. MobX Reactive Getters & toObservableDocument', () => {
        it('triggers MobX autorun on document patch via internal atom', async () => {
            const observedNames: string[] = [];
            const disposer = autorun(() => {
                observedNames.push(doc.data.name);
            });

            expect(observedNames).toEqual(['Alice']);

            await doc.patch({ name: 'Bob' });
            expect(observedNames).toEqual(['Alice', 'Bob']);

            await doc.patch({ name: 'Carol' });
            expect(observedNames).toEqual(['Alice', 'Bob', 'Carol']);

            disposer();
        });

        it('supports toObservableDocument proxy getters and setters', async () => {
            const obsDoc = toObservableDocument(doc);
            expect(obsDoc.name).toBe('Alice');
            expect(obsDoc.age).toBe(30);

            const observedAges: number[] = [];
            const disposer = autorun(() => {
                observedAges.push(obsDoc.age);
            });

            expect(observedAges).toEqual([30]);

            // Mutate via proxy property setter
            obsDoc.age = 31;

            // Wait a microtask for patch resolution
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(obsDoc.age).toBe(31);
            expect(doc.data.age).toBe(31);
            expect(observedAges).toEqual([30, 31]);

            disposer();
        });

        it('returns cached proxy on multiple toObservableDocument calls', () => {
            const obs1 = toObservableDocument(doc);
            const obs2 = toObservableDocument(doc);
            expect(obs1).toBe(obs2);
        });
    });

    describe('8. Low-Level .engine Escape Hatch', () => {
        it('exposes tableName, raw SQL queries, and raw commits', async () => {
            expect(doc.engine.tableName).toBe('users');

            const rows = await doc.engine.queryRaw<any>(
                'SELECT * FROM users WHERE id = ?',
                ['u-1']
            );
            expect(rows.length).toBe(1);
            expect(rows[0].id).toBe('u-1');
            expect(JSON.parse(rows[0].data).name).toBe('Alice');
        });
    });

    describe('9. Lifecycle and Disposal', () => {
        it('disposes cleanly and disallows subsequent mutations', async () => {
            expect(doc.isDisposed).toBe(false);

            doc.dispose();
            expect(doc.isDisposed).toBe(true);

            await expect(doc.patch({ name: 'Disposed' })).rejects.toThrow(
                /Cannot patch disposed LiveDocument/
            );
            await expect(doc.patchPath('name', 'Disposed')).rejects.toThrow(
                /Cannot patch disposed LiveDocument/
            );
        });
    });
});
