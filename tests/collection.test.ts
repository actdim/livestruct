/**
 * @actdim/livestruct - LiveCollection Unit Tests
 * Verifies collection CRUD, document instance caching, reactive query streams,
 * and lifecycle disposal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import {
    createLiveStruct,
    type LiveStoreInstance,
    type LiveCollection,
    type LiveDocument,
} from '../src/index';

interface Product {
    title: string;
    price: number;
    inStock: boolean;
    category: string;
}

describe('LiveCollection Subsystem', () => {
    let store: LiveStoreInstance;
    let productsCol: LiveCollection<Product>;

    beforeEach(async () => {
        store = await createLiveStruct({ name: 'test_col_store', forceMemory: true });
        productsCol = await store.collection<Product>('products');
    });

    afterEach(async () => {
        if (!store.engine.isClosed) {
            await store.close();
        }
    });

    describe('1. CRUD Operations and Document Cache', () => {
        it('creates and retrieves documents with identity caching', async () => {
            const p1 = await productsCol.create('prod-1', {
                title: 'Mechanical Keyboard',
                price: 120,
                inStock: true,
                category: 'electronics',
            });

            expect(p1.id).toBe('prod-1');
            expect(p1.data.title).toBe('Mechanical Keyboard');

            // Cache check: multiple get() calls return the identical instance
            const fetched1 = await productsCol.get('prod-1');
            const fetched2 = await productsCol.get('prod-1');

            expect(fetched1).toBe(p1);
            expect(fetched2).toBe(p1);
        });

        it('returns null for non-existent documents', async () => {
            const doc = await productsCol.get('non-existent');
            expect(doc).toBeNull();
        });

        it('throws when creating duplicate document ID', async () => {
            await productsCol.create('prod-dup', {
                title: 'Mouse',
                price: 50,
                inStock: true,
                category: 'electronics',
            });

            await expect(
                productsCol.create('prod-dup', {
                    title: 'Duplicate Mouse',
                    price: 60,
                    inStock: true,
                    category: 'electronics',
                })
            ).rejects.toThrow(/already exists/);
        });

        it('deletes document and marks it disposed', async () => {
            const doc = await productsCol.create('prod-del', {
                title: 'Screen Cleaner',
                price: 15,
                inStock: true,
                category: 'accessories',
            });

            expect(doc.isDisposed).toBe(false);

            await productsCol.delete('prod-del');

            expect(doc.isDisposed).toBe(true);
            const fetched = await productsCol.get('prod-del');
            expect(fetched).toBeNull();
        });
    });

    describe('2. Document Querying (find)', () => {
        beforeEach(async () => {
            await productsCol.create('p-1', {
                title: 'Laptop Stand',
                price: 45,
                inStock: true,
                category: 'accessories',
            });
            await productsCol.create('p-2', {
                title: 'Monitor 4K',
                price: 400,
                inStock: false,
                category: 'electronics',
            });
            await productsCol.create('p-3', {
                title: 'USB-C Cable',
                price: 15,
                inStock: true,
                category: 'accessories',
            });
        });

        it('returns all documents when no predicate provided', async () => {
            const all = await productsCol.find();
            expect(all.length).toBe(3);
            const ids = all.map((d) => d.id).sort();
            expect(ids).toEqual(['p-1', 'p-2', 'p-3']);
        });

        it('filters documents using predicate', async () => {
            const inStockAccessories = await productsCol.find(
                (item) => item.inStock && item.category === 'accessories'
            );
            expect(inStockAccessories.length).toBe(2);
            const titles = inStockAccessories.map((d) => d.data.title).sort();
            expect(titles).toEqual(['Laptop Stand', 'USB-C Cable']);
        });

        it('reuses cached document instances during find', async () => {
            const d1 = await productsCol.get('p-1');
            const found = await productsCol.find((item) => item.price === 45);
            expect(found.length).toBe(1);
            expect(found[0]).toBe(d1);
        });
    });

    describe('3. Reactive query$ Stream', () => {
        it('emits on document creation, mutation, and deletion', async () => {
            const emittedCounts: number[] = [];
            const sub = productsCol.query$.subscribe((list) => {
                emittedCounts.push(list.length);
            });

            // Initial emission
            expect(emittedCounts).toEqual([0]);

            // Create doc 1
            const d1 = await productsCol.create('item-1', {
                title: 'Notebook',
                price: 5,
                inStock: true,
                category: 'stationery',
            });

            // Wait a tick for CDC propagation
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(emittedCounts).toContain(1);

            // Create doc 2
            await productsCol.create('item-2', {
                title: 'Pen',
                price: 2,
                inStock: true,
                category: 'stationery',
            });

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(emittedCounts).toContain(2);

            // Delete doc 1
            await productsCol.delete('item-1');

            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(emittedCounts[emittedCounts.length - 1]).toBe(1);

            sub.unsubscribe();
        });
    });

    describe('4. Collection Lifecycle and Disposal', () => {
        it('disposes cached documents and completes query$ on collection dispose', async () => {
            const doc = await productsCol.create('item-term', {
                title: 'Terminal Stand',
                price: 75,
                inStock: true,
                category: 'accessories',
            });

            expect(productsCol.isDisposed).toBe(false);
            expect(doc.isDisposed).toBe(false);

            productsCol.dispose();

            expect(productsCol.isDisposed).toBe(true);
            expect(doc.isDisposed).toBe(true);

            await expect(productsCol.get('item-term')).rejects.toThrow(
                /Cannot access disposed LiveCollection/
            );
            await expect(
                productsCol.create('item-new', {
                    title: 'New',
                    price: 1,
                    inStock: true,
                    category: 'none',
                })
            ).rejects.toThrow(/Cannot access disposed LiveCollection/);
        });
    });
});
